# Issue pronta para publicar — BUG 2

Preenchida no formato de [`.github/ISSUE_TEMPLATE/bug.yml`](../../.github/ISSUE_TEMPLATE/bug.yml).
`gh` não está autenticado nesta máquina (`gh auth status` → *not logged into any GitHub hosts*),
então não foi possível abrir automaticamente. Abra em
https://github.com/notoriun/learnhouse/issues/new?template=bug.yml e cole campo a campo.

---

## Title

```
[Bug]: frontend_domain não cai para LEARNHOUSE_DOMAIN — login corporativo quebra em todo self-host community
```

## Labels

`bug`, `triage` — já vêm do template. Sugestão de acréscimo: `auth`, `keycloak`, `self-hosting`.

## Contact Details

```
diego.albino@notoriun.com.br
```

## What happened?

```markdown
## Resumo

A *redirect URI* do login corporativo (Keycloak/OIDC) é montada a partir de
`hosting_config.frontend_domain`. Esse valor **só** é sobrescrito por
`LEARNHOUSE_FRONTEND_DOMAIN` — ele **não** cai para `LEARNHOUSE_DOMAIN`, que é a variável que o
instalador configura e que todo operador define.

Sem `LEARNHOUSE_FRONTEND_DOMAIN`, o valor vem de `apps/api/config/config.yaml` como
`localhost:3000`. A URI enviada ao Keycloak fica divergente da registrada no client, e o login
corporativo quebra.

O agravante: **o template de ambiente da edição community nunca emite essa variável.** Só o
template Enterprise emite. Então qualquer instalação community que ligue o login corporativo nasce
neste estado.

## O que eu esperava

Configurar `LEARNHOUSE_DOMAIN=meudominio.com` e o login corporativo funcionar, sem precisar
descobrir uma segunda variável não documentada no guia de login corporativo.

## O que acontece

A `redirect_uri` sai como `http://localhost:3000/api/auth/keycloak/callback`, independente do
domínio configurado.

## Dois sintomas — e o que o cliente relata é o segundo

Verificado executando o fluxo completo nos dois estados:

| Ambiente | O que acontece | Quando |
|---|---|---|
| `localhost` (dev) | O Keycloak **aceita** a URI e autentica; o navegador então falha com `ERR_CONNECTION_REFUSED` em `localhost:3000` | Depois de autenticar |
| Domínio real (self-host) | O Keycloak **recusa**: *"Invalid parameter: redirect_uri"* | Antes de autenticar |

A diferença é a exceção de *loopback* da RFC 8252: o Keycloak ignora a porta para `localhost` e
`127.0.0.1`, então `localhost:3000` casa com o `localhost` registrado. Num domínio real a exceção
não se aplica.

Isso importa para triagem: quem tentar reproduzir só em `localhost` vê um erro de rede e pode
concluir que é problema de ambiente local.

## Como reproduzir

Ambiente: `docker-compose.local.yml` (plataforma na porta 80, Keycloak 26.3 na 8080, realm `dev`),
preparo em `docs/content/developers/contributing/keycloak-local.mdx`.

1. Garantir que **não** existe `LEARNHOUSE_FRONTEND_DOMAIN` no `.env` — o estado de uma instalação
   community recém-criada:
   ```bash
   sed -i '/^LEARNHOUSE_FRONTEND_DOMAIN=/d' .env
   docker compose -f docker-compose.local.yml up -d --force-recreate learnhouse-app keycloak-fwd
   until curl -sf http://localhost/api/v1/health >/dev/null; do sleep 5; done
   ```
2. Pedir a URL de autorização e olhar a `redirect_uri`:
   ```bash
   curl -s -X POST http://localhost/api/v1/auth/keycloak/authorize \
     -H "Content-Type: application/json" \
     -d '{"org_slug":"default","action":"login"}' | grep -o 'redirect_uri=[^&]*'
   ```
   **Observado**: `redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Fkeycloak%2Fcallback`
   — porta 3000, que não está configurada em lugar nenhum.
   **Esperado**: porta 80, coincidindo com a URI registrada no client do realm.
3. No navegador: abrir `http://localhost/login`, clicar em **"Entrar com identidade corporativa"**,
   autenticar com `teste@example.com` / `teste123`. O Keycloak aceita e o navegador falha com
   `ERR_CONNECTION_REFUSED` em `localhost:3000`.

Correção do sintoma para confirmar a causa: acrescentar `LEARNHOUSE_FRONTEND_DOMAIN=localhost` ao
`.env`, recriar a aplicação, e a `redirect_uri` passa a sair correta.

## Causa-raiz

Montagem da URI — `apps/api/src/services/auth/keycloak_oidc.py:236-240`:

```python
def get_callback_redirect_uri() -> str:
    """Redirect URI exata cadastrada no client Keycloak (rota BFF do Next.js)."""
    hosting = get_learnhouse_config().hosting_config
    scheme = "https" if hosting.ssl else "http"
    return f"{scheme}://{hosting.frontend_domain}/api/auth/keycloak/callback"
```

Resolução do valor — `apps/api/config/config.py:372-374`:

```python
frontend_domain = env_frontend_domain or yaml_config.get("hosting_config", {}).get(
    "frontend_domain", "localhost:3000"
)
```

Não há fallback para `LEARNHOUSE_DOMAIN` (lido no mesmo arquivo, linha 231). E
`apps/api/config/config.yaml:24` fixa `frontend_domain: localhost:3000`.

## Por que atinge produção, e não só o ambiente de desenvolvimento

`LEARNHOUSE_FRONTEND_DOMAIN` é emitido **apenas** pelo template Enterprise
(`apps/cli/src/templates/ee.ts:136` e `:141`). O template da edição community
(`apps/cli/src/templates/env.ts`) **nunca** o emite, mesmo definindo `LEARNHOUSE_DOMAIN` com o
domínio real:

```ts
// apps/cli/src/templates/env.ts
`LEARNHOUSE_DOMAIN=${domainWithPort}`,   // presente
// LEARNHOUSE_FRONTEND_DOMAIN            // ausente
```

A documentação de variáveis de ambiente lista `LEARNHOUSE_FRONTEND_DOMAIN` com escopo
"API, EE CLI" e padrão `localhost:3000`
(`docs/content/self-hosting/configuration/environment-variables.mdx:29`) — coerente com o código,
mas o guia de login corporativo não menciona que ela é obrigatória para o fluxo funcionar.

Logo: `npx learnhouse setup` numa instalação community, com login corporativo ativo, produz uma
`redirect_uri` apontando para `localhost:3000`.

## Alcance — outros pontos que leem o mesmo valor

`frontend_domain` é usado em cinco lugares. Auditei cada um; **não** estou afirmando que todos
estão quebrados:

| Uso | Efeito com o valor errado |
|---|---|
| `services/auth/keycloak_oidc.py:240` — redirect URI do login | **Quebrado** — confirmado |
| `routers/keycloak_auth.py:392` — destino pós-logout (`{scheme}://{frontend_domain}/`) | **Provavelmente quebrado** — o RP-Initiated Logout devolveria a pessoa para `localhost:3000` |
| `services/email/utils.py:260-263` — URL base de links em e-mails | **Risco** — só é usado quando não há URL confiável derivada da requisição (`get_trusted_base_url_from_request` tem precedência) |
| `core/middleware/cors.py:35` | **Não afetado** — a regex também inclui `hosting_config.domain`, então o domínio real continua permitido |
| `routers/instance.py:85` — expõe `frontend_domain` | Informativo; reporta o valor errado |

Vale verificar o pós-logout e os links de e-mail junto da correção.

## Duas frentes de correção, com efeitos diferentes

| Abordagem | Corrige instalações existentes? |
|---|---|
| `frontend_domain` cair para `LEARNHOUSE_DOMAIN` quando não informado (`config.py:372`) | **Sim** — basta atualizar |
| Template community passar a emitir `LEARNHOUSE_FRONTEND_DOMAIN` (`env.ts`) | Não — só instalações novas |

Recomendação: **a primeira**, porque conserta quem já está quebrado sem exigir ação do operador. A
segunda é complementar e torna o valor explícito para quem lê o `.env`.

## Cobertura de teste

A suíte de aceitação adicionada em `apps/e2e/features/keycloak/` traz
`tests/us1-redirect-uri.spec.ts`, que compara a URI emitida com as **registradas no client**, lidas
da interface administrativa do realm — e não com uma constante derivada da mesma origem que gerou a
URI (derivá-la faria o teste concordar consigo mesmo e nunca detectar a divergência).

Ressalva honesta: o template `.env.local.example` entregue junto **já inclui**
`LEARNHOUSE_FRONTEND_DOMAIN`, então no ambiente local o defeito fica mascarado e essa jornada passa.
Ela existe para pegar a classe de defeito (URI emitida ≠ URI registrada), não para substituir a
correção. Um teste de unidade sobre a resolução de `frontend_domain` em `config.py` cobriria o caso
diretamente.

## Por que os testes existentes não pegaram

A cobertura atual de Keycloak simula o provedor de identidade, e o provedor simulado aceita
qualquer `redirect_uri`. A divergência só aparece contra um Keycloak real, que valida a URI contra
as registradas no client.
```

## Version

```
1.3.4
```

Reproduzido no commit `8216c120` (branch `008-testes-keycloak-local`; as alterações da branch são de
teste e documentação, o código de aplicação é o mesmo). `GET /api/v1/instance/info` reporta
`version: 1.3.4`.

## What browsers are you seeing the problem on?

`Chrome` — reproduzido com Chromium 149 (Playwright). Não depende do navegador: a `redirect_uri`
errada é observável por `curl`, sem navegador nenhum.

## Relevant log output

```bash
# 1. Sem LEARNHOUSE_FRONTEND_DOMAIN — redirect_uri aponta para a porta 3000
$ curl -s -X POST http://localhost/api/v1/auth/keycloak/authorize \
    -H "Content-Type: application/json" \
    -d '{"org_slug":"default","action":"login"}' | grep -o 'redirect_uri=[^&]*'
redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Fkeycloak%2Fcallback

# 2. A URI registrada no client do realm é a porta 80
$ python3 -c "import json; d=json.load(open('docker/keycloak/realm-dev.json'));
  print([c['redirectUris'] for c in d['clients'] if c['clientId']=='learnhouse'])"
[['http://localhost/api/auth/keycloak/callback']]

# 3. O valor vem do YAML, não do domínio configurado
$ docker exec learnhouse-app-local sh -c 'grep -n "frontend_domain" /app/api/config/config.yaml'
24:  frontend_domain: localhost:3000

$ grep -n "LEARNHOUSE_DOMAIN" .env
4:LEARNHOUSE_DOMAIN=localhost        # configurado, e ignorado para este fim

# 4. Fluxo completo: o Keycloak ACEITA (exceção de loopback da RFC 8252),
#    autentica, e redireciona para uma porta onde nada escuta
PARA ONDE O KEYCLOAK REDIRECIONA:
http://localhost:3000/api/auth/keycloak/callback?state=...&iss=http%3A%2F%2Flocalhost%3A8080%2Frealms%2Fdev&code=<REDIGIDO>

$ curl -s -o /dev/null --max-time 5 "http://localhost:3000/api/auth/keycloak/callback"
Failed to connect to localhost port 3000 after 0 ms: Couldn't connect to server

# 5. Com LEARNHOUSE_FRONTEND_DOMAIN=localhost, a URI passa a coincidir
$ curl -s -X POST http://localhost/api/v1/auth/keycloak/authorize \
    -H "Content-Type: application/json" \
    -d '{"org_slug":"default","action":"login"}' | grep -o 'redirect_uri=[^&]*'
redirect_uri=http%3A%2F%2Flocalhost%2Fapi%2Fauth%2Fkeycloak%2Fcallback

# 6. A variável só é emitida pelo template Enterprise
$ grep -rn "FRONTEND_DOMAIN" apps/cli/src/
apps/cli/src/templates/ee.ts:136:      LEARNHOUSE_FRONTEND_DOMAIN: \${AGENCY_DOMAIN}
apps/cli/src/templates/ee.ts:141:      LEARNHOUSE_FRONTEND_DOMAIN: \${DOMAIN}
# (nenhuma ocorrência em apps/cli/src/templates/env.ts — o template community)
```

## Code of Conduct

Marcar `I agree to follow this project's Code of Conduct`.
