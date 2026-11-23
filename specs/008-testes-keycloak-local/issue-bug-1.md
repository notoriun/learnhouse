# Issue pronta para publicar — BUG 1

Preenchida no formato de [`.github/ISSUE_TEMPLATE/bug.yml`](../../.github/ISSUE_TEMPLATE/bug.yml).
`gh` não está autenticado nesta máquina, então não foi possível abrir automaticamente. Abra em
https://github.com/notoriun/learnhouse/issues/new?template=bug.yml e cole campo a campo.

---

## Title

```
[Bug]: Recusa no login corporativo redireciona para /auth/login (404) e o motivo do erro nunca é exibido
```

## Labels

`bug`, `triage` — já vêm do template. Sugestão de acréscimo: `auth`, `keycloak`.

## Contact Details

```
diego.albino@notoriun.com.br
```

## What happened?

```markdown
## Resumo

Quando o login corporativo (Keycloak/OIDC) é recusado, a plataforma redireciona a pessoa para
`/auth/login?error=<motivo>`. Esse caminho responde **404** — o caminho servido é `/login`.

Resultado: a pessoa autentica com sucesso no provedor de identidade, volta para a plataforma e cai
numa página "Esta página não existe ou foi removida". O código do erro vai na barra de endereços e
**nunca é exibido**, porque a página que o leria não está naquele caminho.

Vale para **toda** causa de recusa: conta inexistente, e-mail não verificado, método SSO desligado
na organização. O mesmo erro de caminho existe em outros três pontos do `apps/web` — dois deles
fora do login corporativo (ver "Alcance" abaixo).

## O que eu esperava

Voltar para a tela de entrada com uma mensagem explicando por que o acesso foi recusado.

## O que acontece

Uma página 404. Nenhuma mensagem.

## Como reproduzir

Ambiente: `docker-compose.local.yml` (plataforma na porta 80, Keycloak 26.3 na 8080, realm `dev`).
Preparo em `docs/content/developers/contributing/keycloak-local.mdx`.

1. Abrir `http://localhost/login`
2. Clicar em **"Entrar com identidade corporativa"** / *"Sign in with corporate identity"*
3. Autenticar no Keycloak com `nao-verificado@example.com` / `teste123`
   (usuário de teste do realm, com `emailVerified: false`)
4. O Keycloak aceita a credencial e devolve para a plataforma
5. A plataforma recusa a admissão — corretamente — e redireciona
6. **Observado**: página 404. A URL é `http://localhost/auth/login?error=conta_nao_encontrada`

Para confirmar que o caminho é o problema, e não o fluxo:

- `http://localhost/login` → **200**, renderiza a tela de entrada
- `http://localhost/auth/login` → **404**

O caminho feliz funciona (`teste@example.com` / `teste123`, com conta local de mesmo e-mail para o
vínculo), o que isola o defeito no redirecionamento de recusa.

## Onde está

`apps/web/app/api/auth/keycloak/callback/route.ts:28`

```ts
const url = new URL('/auth/login', publicOrigin(request))
```

## Evidência — medida nos dois níveis

Testado via nginx (porta 80) e direto no servidor Next (porta 8000), para descartar o proxy:

| Caminho | via nginx | direto no Next |
|---|---|---|
| `/login` | 200 — título `Login — Default Organization` | 200 |
| `/auth/login` | 404 | 404 |
| `/orgs/default/auth/login` | — | 404 |

Snapshot de acessibilidade da página em `/auth/login?error=conta_nao_encontrada`:

```
heading "404" [level=1]
paragraph: Esta página não existe ou foi removida. Verifique o endereço ou volte ao início.
link "Voltar ao início"
```

## Causa-raiz

`/auth/login` **não é uma rota pública** — é destino interno de reescrita.

`apps/web/proxy.ts` (o proxy/middleware do Next) trata os caminhos públicos de autenticação e
reescreve para o segmento `/auth`, em `proxy.ts:345-376`:

```ts
const authPaths = ['/login', '/signup', '/reset', '/forgot', '/verify-email']
if (authPaths.includes(pathname)) {
  const resolved = await resolveTenant(req, instance)
  const requestHeaders = tenantRequestHeaders(req, resolved, instance)
  const response = NextResponse.rewrite(
    new URL(`/auth${pathname}${search}`, req.url),   // /login -> /auth/login
    { request: { headers: requestHeaders } },
  )
  setOrgCookies(response, resolved, instance)
  ...
```

Requisitar `/auth/login` **direto** não casa com `authPaths` (o caminho é `/auth/login`, não
`/login`), então cai no catch-all tenant-scoped do fim do arquivo, que reescreve para
`/orgs/{slug}/auth/login` — rota que não existe. Confirmado:

```
/orgs/default/auth/login -> 404
```

Além do 404, o acesso direto **não recebe** os cabeçalhos de tenant nem os cookies de organização
que a página depende — ou seja, mesmo que a rota existisse, o caminho interno não é utilizável de
fora.

**Conclusão: o caminho público canônico é `/login`.** `/auth/*` é detalhe de implementação atrás da
reescrita, e nenhum redirecionamento voltado ao navegador deveria apontar para lá.

## Alcance — são 4 lugares, não 1

O mesmo erro aparece em quatro pontos, e dois deles **não têm nada a ver com Keycloak**:

| Arquivo | Linha | Contexto |
|---|---|---|
| `apps/web/app/api/auth/keycloak/callback/route.ts` | 28 | Recusa do login corporativo |
| `apps/web/app/api/auth/keycloak/authorize/route.ts` | 13 | Falha ao iniciar o fluxo corporativo |
| `apps/web/proxy.ts` | 546 | Visitante **sem sessão** no host padrão |
| `apps/web/app/editor/playground/[playgrounduuid]/edit/page.tsx` | 26 | Editor de playground sem sessão |

`proxy.ts:546` é o mais amplo: ele monta `/auth/login${search}` como destino de **reescrita**
interna (`NextResponse.rewrite`), não de redirecionamento — nesse caso o caminho interno é
legítimo e provavelmente funciona. Os outros três são redirecionamentos voltados ao navegador
(`NextResponse.redirect` / `redirect()`), e **esses** levam a pessoa ao 404.

Sugestão de correção: trocar por `/login` nos três redirecionamentos, mantendo `proxy.ts:546` como
está (é reescrita interna), e acrescentar um teste que impeça a regressão.

## Consequência colateral

A API colapsa todos os motivos de recusa em `CONTA_NAO_ENCONTRADA`
(`apps/api/src/routers/keycloak_auth.py:325`), plausivelmente por anti-enumeração. Combinado com o
404, a pessoa não recebe orientação **nenhuma** — nem genérica. Vale decidir, junto da correção, se
a tela de entrada deve distinguir "e-mail não verificado" de "conta não encontrada"; se a resposta
for não, por segurança, a mensagem genérica precisa ao menos aparecer.

## Cobertura de teste

Reproduzido automaticamente pela suíte de aceitação adicionada em
`apps/e2e/features/keycloak/`, em `tests/us2-unverified.spec.ts`, passo *"a pessoa recebe o motivo
da recusa"*. A jornada permanece **falhando de propósito** até a correção — a suíte não foi ajustada
para aceitar o comportamento.

Para executar:

```bash
cd apps/e2e
E2E_BASE_URL=http://localhost \
E2E_ADMIN_EMAIL=<admin> E2E_ADMIN_PASSWORD=<senha> \
  bun run test:keycloak
```

## Por que os testes existentes não pegaram

A cobertura atual de Keycloak (`test_keycloak_auth_router.py`,
`test_keycloak_oidc_validation.py`, entre outros) simula o provedor de identidade e verifica no
nível da API. Este defeito só aparece com navegador, seguindo o redirecionamento até a página
final — que é onde o 404 acontece.
```

## Version

```
1.3.4
```

Reproduzido no commit `8216c120` (branch `008-testes-keycloak-local`, cujo código de aplicação é
idêntico ao da `dev` neste ponto — as alterações da branch são de teste e documentação).
`GET /api/v1/instance/info` reporta `version: 1.3.4`.

## What browsers are you seeing the problem on?

`Chrome` — reproduzido com Chromium 149 (Playwright). Não depende do navegador: o 404 vem do
servidor, confirmado também por `curl`.

## Relevant log output

```bash
# 1. Confirmação de que o caminho do redirecionamento não existe
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost/login
200
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost/auth/login
404

# 2. Direto no servidor Next, de dentro do contêiner (descarta o nginx)
$ docker exec learnhouse-app-local sh -c \
    'for p in /login /auth/login /orgs/default/auth/login; do
       printf "%-28s " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8000$p";
     done'
/login                       200
/auth/login                  404
/orgs/default/auth/login     404

# 3. Fluxo real: o Keycloak emite o código, a API recusa a admissão (403),
#    e o BFF redireciona para o caminho que não existe
redirect do provedor: http://localhost/api/auth/keycloak/callback?state=...&iss=http%3A%2F%2Flocalhost%3A8080%2Frealms%2Fdev&code=<REDIGIDO>
HTTP/1.1 307 Temporary Redirect
location: http://localhost/auth/login?error=conta_nao_encontrada

# 4. Log da API no mesmo instante
INFO:     127.0.0.1:0 - "POST /api/v1/auth/keycloak/callback HTTP/1.0" 403 Forbidden

# 5. A rota existe no build, o que descarta "página não compilada"
$ docker exec learnhouse-app-local sh -c 'ls /app/web/.next/server/app/auth'
callback  forgot  login  magic  reset  signup  sso  token-exchange  verify-email

# 6. Causa: o catch-all tenant-scoped do proxy manda /auth/login para
#    /orgs/{slug}/auth/login, que não existe
$ docker exec learnhouse-app-local sh -c \
    'curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/orgs/default/auth/login'
404

# 7. Os 4 pontos que apontam para /auth/login
$ grep -rn "'/auth/login'" apps/web --include="*.ts" --include="*.tsx" | grep -v node_modules
apps/web/proxy.ts:546:      const target = hasSession ? `/home${search}` : `/auth/login${search}`
apps/web/app/editor/playground/[playgrounduuid]/edit/page.tsx:26:    redirect('/auth/login')
apps/web/app/api/auth/keycloak/authorize/route.ts:13:  const url = new URL('/auth/login', publicOrigin(request))
apps/web/app/api/auth/keycloak/callback/route.ts:28:  const url = new URL('/auth/login', publicOrigin(request))

# 8. Saída da jornada automatizada que reproduz o defeito
Error: a pessoa deveria ver o motivo da recusa.
  URL: http://localhost/auth/login?error=conta_nao_encontrada
  motivo na URL: true, página existe: false
```

## Code of Conduct

Marcar `I agree to follow this project's Code of Conduct`.
