# Como reproduzir os dois bugs no seu navegador

**Ambiente**: já está de pé na sua máquina agora. Se tiver sido derrubado, veja "Se o ambiente
estiver desligado" no fim.

**Credenciais do ambiente atual** (do `.env` gerado):

| Papel | Identificador | Senha |
|---|---|---|
| Administrador da plataforma | `admin@e2e-tests.com` | `LocalDevAdmin!234` |
| Keycloak — e-mail **verificado** | `teste@example.com` | `teste123` |
| Keycloak — e-mail **não** verificado | `nao-verificado@example.com` | `teste123` |
| Console admin do Keycloak (`http://localhost:8080`) | `admin` | `admin` |

---

## BUG 1 — Recusa cai num 404 (1 minuto, sem mexer em nada)

Este é o mais direto: você não precisa alterar configuração nenhuma.

1. Abra **http://localhost/login**
2. Confirme que aparece o botão **"Sign in with corporate identity"**
   *(a interface está em inglês neste ambiente)*
3. Clique nele — você vai para a tela do Keycloak, em `localhost:8080`
4. Entre com **`nao-verificado@example.com`** / **`teste123`**
5. O Keycloak aceita e devolve você para a plataforma

**O que você deveria ver**: a tela de entrada, com uma mensagem explicando que o acesso foi
recusado porque o e-mail não está verificado.

**O que você vai ver**: uma página **404** — "Esta página não existe ou foi removida."

6. Olhe a barra de endereços. Ela vai estar em:

```
http://localhost/auth/login?error=conta_nao_encontrada
```

O motivo da recusa está ali, no parâmetro `error`, e nunca é exibido — porque `/auth/login` não
existe. Compare abrindo os dois à mão:

- **http://localhost/login** → funciona
- **http://localhost/auth/login** → 404

Isso é o bug: o callback do login corporativo redireciona para o caminho errado.

### Variação — mesmo efeito com outra causa de recusa

Para ver que não é específico do e-mail não verificado, force uma recusa diferente: no console
admin do Keycloak (`http://localhost:8080`, `admin`/`admin`), realm **dev** → *Users* → crie um
usuário qualquer com e-mail verificado e senha, e entre com ele pelo login corporativo. Ele não tem
conta local, então a admissão recusa — e o desfecho é o mesmo 404.

### Contraste — o caminho que funciona

Para ver que o login corporativo em si está funcional:

1. Abra uma janela anônima em **http://localhost/login**
2. Clique em **"Sign in with corporate identity"**
3. Entre com **`teste@example.com`** / **`teste123`**
4. Você volta autenticado, sem 404

*(Funciona porque existe uma conta local com esse mesmo e-mail, e o vínculo por e-mail a
reconhece. É a pré-condição descrita no quickstart.)*

---

## BUG 2 — `redirect_uri` errada (5 minutos, exige reverter uma variável)

Este está **mascarado no ambiente atual**, de propósito: o `.env` que geramos já traz a variável
que falta na maioria das instalações. Para ver o bug, é preciso removê-la — que é exatamente o
estado de um self-host community recém-instalado.

### Ver o valor correto primeiro

Rode isto e guarde a saída:

```bash
curl -s -X POST http://localhost/api/v1/auth/keycloak/authorize \
  -H "Content-Type: application/json" \
  -d '{"org_slug":"default","action":"login"}' | grep -o 'redirect_uri=[^&]*'
```

Esperado agora: `redirect_uri=http%3A%2F%2Flocalhost%2Fapi%2Fauth%2Fkeycloak%2Fcallback`
(porta 80 — correto).

### Reproduzir o defeito

```bash
cd /home/yakov/Documentos/GitHub/learnhouse

# 1. Remove a variável que a maioria das instalações não tem
sed -i '/^LEARNHOUSE_FRONTEND_DOMAIN=/d' .env

# 2. Recria a aplicação E o sidecar juntos (o sidecar fica órfão se você
#    recriar só o app — e o sintoma disfarça de "provedor fora do ar")
docker compose -f docker-compose.local.yml up -d --force-recreate learnhouse-app keycloak-fwd

# 3. Espera a aplicação subir
until curl -sf http://localhost/api/v1/health >/dev/null; do sleep 5; done

# 4. Olha a redirect_uri agora
curl -s -X POST http://localhost/api/v1/auth/keycloak/authorize \
  -H "Content-Type: application/json" \
  -d '{"org_slug":"default","action":"login"}' | grep -o 'redirect_uri=[^&]*'
```

Agora a saída traz **`localhost%3A3000`** — porta 3000, que ninguém configurou em lugar nenhum.

### Ver o efeito no navegador

1. Abra **http://localhost/login** em janela anônima
2. Clique em **"Sign in with corporate identity"** — a tela do Keycloak **carrega normalmente**
3. Entre com **`teste@example.com`** / **`teste123`** — o Keycloak **aceita**
4. O navegador tenta ir para `http://localhost:3000/api/auth/keycloak/callback` e falha com
   **`ERR_CONNECTION_REFUSED`** — não há nada servindo a porta 3000

A pessoa autentica com sucesso e cai numa página de erro do navegador. Verificado:
`Failed to connect to localhost port 3000`.

> **Por que o Keycloak não recusa a URI aqui.** Era o que eu esperava, e não é o que acontece: o
> Keycloak aplica a exceção de *loopback* da RFC 8252 e **ignora a porta** para `localhost` e
> `127.0.0.1`. Então `localhost:3000` casa com o `localhost` registrado. Em um domínio real essa
> exceção não vale, e aí o Keycloak recusa antes de autenticar, com *"Invalid parameter:
> redirect_uri"*.
>
> Ou seja: **o mesmo defeito tem dois sintomas**. Em `localhost` você vê conexão recusada depois de
> autenticar; num self-host com domínio real você vê a recusa do provedor antes de autenticar. O
> segundo é o que os clientes vão relatar.

### Restaurar

```bash
cd /home/yakov/Documentos/GitHub/learnhouse
grep -q LEARNHOUSE_FRONTEND_DOMAIN .env || \
  sed -i 's|^LEARNHOUSE_DOMAIN=localhost$|LEARNHOUSE_DOMAIN=localhost\nLEARNHOUSE_FRONTEND_DOMAIN=localhost|' .env
docker compose -f docker-compose.local.yml up -d --force-recreate learnhouse-app keycloak-fwd
until curl -sf http://localhost/api/v1/health >/dev/null; do sleep 5; done
```

### Por que isso importa fora do seu laptop

O template de ambiente da edição community
([`apps/cli/src/templates/env.ts`](../../apps/cli/src/templates/env.ts)) **nunca** emite
`LEARNHOUSE_FRONTEND_DOMAIN` — só o template Enterprise emite. Então qualquer cliente que rode
`npx learnhouse setup` e ligue o login corporativo cai neste estado, com o domínio real
configurado em `LEARNHOUSE_DOMAIN` e a `redirect_uri` apontando para `localhost:3000`.

---

## Se o ambiente estiver desligado

```bash
cd /home/yakov/Documentos/GitHub/learnhouse
docker compose -f docker-compose.local.yml up -d
until curl -sf http://localhost/api/v1/health >/dev/null; do sleep 5; done
```

Se você tiver dado `down -v` (apaga os volumes), a conta local de vínculo desaparece e o caminho
feliz passa a recusar. Recrie-a:

```bash
curl -s -X POST http://localhost/api/v1/users/1 -H "Content-Type: application/json" \
  -d '{"username":"teste","email":"teste@example.com","password":"Senha!123",
       "first_name":"Teste","last_name":"Local"}'
```

> **Não recrie só o contêiner do Keycloak.** Ele guarda os dados em memória: recriar gera novos
> `subject` e invalida os vínculos federados já gravados, e **toda** entrada corporativa passa a dar
> 403. A recusa é correta (a plataforma não revincula identidade por coincidência de e-mail), mas
> parece que tudo quebrou. Se precisar reimportar o realm, recrie os dois lados:
> `docker compose -f docker-compose.local.yml down -v && docker compose -f docker-compose.local.yml up -d`

## Rodar a suíte que encontrou os dois

```bash
cd /home/yakov/Documentos/GitHub/learnhouse/apps/e2e
E2E_BASE_URL=http://localhost \
E2E_ADMIN_EMAIL=admin@e2e-tests.com E2E_ADMIN_PASSWORD='LocalDevAdmin!234' \
  bun run test:keycloak
```

Esperado: `26 passed | 1 failed | 3 skipped`. A falha é o BUG 1, e é intencional — ela fica
vermelha até a correção.

Para ver os detalhes com capturas de tela e vídeo:

```bash
bunx playwright show-report
```
