# Contratos: Fundação OIDC Keycloak

**Feature**: `001-fundacao-oidc-keycloak` | **Data**: 2026-08-03

Dois níveis de contrato, conforme o Princípio I da constituição:

1. **Rotas BFF (Next.js)** — consumidas pelo navegador; só fazem redirect e gravam cookies.
2. **Endpoints REST (FastAPI)** — consumidos exclusivamente pelo BFF, server-to-server.

Convenções: erros do FastAPI seguem o formato existente
`{"detail": {"code": "...", "message": "..."}}` com mensagens em pt-BR; nenhum payload de erro ou
log contém `code` (authorization code), tokens ou `client_secret` (FR-009/FR-010).

---

## 1. Rotas BFF (Next.js — `apps/web/app/api/auth/keycloak/`)

### GET `/api/auth/keycloak/authorize`

Inicia o fluxo. Navegação de topo (link/redirect do botão "Entrar com identidade corporativa").

**Query params**:

| Param | Obrigatório | Descrição |
|---|---|---|
| `org` | sim | Slug da organização da página de login |
| `redirect` | não | Caminho interno de destino pós-login (default `/`) |

**Comportamento**: chama `POST /api/v1/auth/keycloak/authorize` no FastAPI; em sucesso responde
`302 Location: {authorization_url do Keycloak}`.

**Respostas**:

| Status | Quando | Corpo/Location |
|---|---|---|
| 302 | Fluxo criado | `Location`: authorization_endpoint do Keycloak com `response_type=code`, `client_id`, `redirect_uri` exata, `scope=openid email profile`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256` |
| 302 | Provedor não configurado/inativo para a org, ou API indisponível | `Location: /login?org={org}&error={sso_nao_disponivel\|sso_indisponivel}` |

Sem corpo JSON exposto ao navegador. A rota nunca ecoa parâmetros de entrada não sanitizados.

### GET `/api/auth/keycloak/callback`

Redirect URI **exata** cadastrada no client Keycloak. Processamento 100% server-side (ADR-03).

**Query params** (definidos pelo Keycloak):

| Param | Descrição |
|---|---|
| `code` | Authorization code (presente em sucesso) |
| `state` | Valor opaco emitido no authorize |
| `error`, `error_description` | Presentes quando o usuário cancela ou o provedor falha |

**Comportamento**: se `error` presente → redirect de erro sem chamar a API (exceto auditoria
futura). Caso contrário chama `POST /api/v1/auth/keycloak/callback`; em sucesso grava cookies e
redireciona.

**Respostas**:

| Status | Quando | Efeito |
|---|---|---|
| 302 | Login validado | `Set-Cookie`: `LH_access` (httpOnly, Secure, SameSite=Lax), `LH_refresh` (idem), `LH_session=1` (marcador não-httpOnly, sem token) — mesmas opções do proxy `apps/web/app/api/auth/[...path]/route.ts`. `Location`: `redirect_to` interno sanitizado retornado pela API |
| 302 | Usuário cancelou no provedor (`error=access_denied`) | `Location: /login?org={org}&error=acesso_nao_concluido` — sem cookies |
| 302 | Qualquer falha de validação retornada pela API | `Location: /login?org={org}&error={codigo}` — sem cookies, sem sessão |

**Invariantes (US2)**: nenhuma resposta desta rota contém token (do provedor ou interno) em corpo,
URL ou fragmento; tokens internos só saem como cookies httpOnly; tokens do provedor nunca chegam ao
navegador.

Códigos de erro na query (mapeados para mensagens pt-BR na tela de login): `acesso_nao_concluido`,
`sessao_expirada` (state inválido/expirado/reutilizado), `login_invalido` (falha de validação do
token), `conta_nao_encontrada`, `sso_nao_disponivel`, `sso_indisponivel` (provedor fora do ar).
O código na URL é genérico por categoria — o detalhe fica nos logs de auditoria do backend.

---

## 2. Endpoints REST (FastAPI — `apps/api/src/routers/keycloak_auth.py`, prefixo `/api/v1/auth/keycloak`)

### GET `/api/v1/auth/keycloak/status`

Diz à tela de login se o botão deve aparecer para a org (FR-001). Público, sem autenticação, sem
dados sensíveis.

**Query params**: `org` (slug, obrigatório).

**Response 200**:

```json
{ "enabled": true }
```

`enabled` = config do provedor presente e ativa **e** método `sso` permitido na política da org.
Org desconhecida → `{"enabled": false}` (sem enumeração de orgs). Erros: nenhum além de 422 de
validação.

### POST `/api/v1/auth/keycloak/authorize`

Cria o fluxo (state/nonce/verifier no Redis) e monta a URL de autorização. Chamado apenas pelo BFF.

**Request** (JSON):

```json
{ "org_slug": "acme", "redirect_to": "/dash/cursos" }
```

**Response 200**:

```json
{ "authorization_url": "https://kc.exemplo.com/realms/plataforma/protocol/openid-connect/auth?...", "state": "opaco" }
```

`redirect_to` é sanitizado **aqui** (apenas caminho relativo interno: inicia com `/`, não inicia
com `//`, sem esquema/host); valor inválido é substituído por `/` — não é motivo de erro.

**Erros**:

| Status | `code` | Quando |
|---|---|---|
| 404 | `SSO_NAO_CONFIGURADO` | Config ausente/inativa ou método `sso` não permitido para a org |
| 503 | `SSO_INDISPONIVEL` | Discovery falhou / Redis indisponível (fail closed) — mensagem genérica, sem detalhe técnico |

### POST `/api/v1/auth/keycloak/callback`

Consome o fluxo, troca o código, valida o ID token e emite a sessão interna. Chamado apenas pelo
BFF, server-to-server (contrato de tokens-no-corpo idêntico a `POST /api/v1/auth/login`, que o BFF
espelha em cookies).

**Request** (JSON):

```json
{ "code": "<authorization code>", "state": "<state do callback>" }
```

**Processamento (ordem obrigatória)**:

1. `GETDEL oidc_flow:{state}` — ausente/expirado/reutilizado → 410, sem sessão.
2. Troca do código no `token_endpoint` (httpx, com `code_verifier`; client confidencial) — recusa
   (`invalid_grant` etc.) → 401, sem sessão.
3. Validação integral do ID token: assinatura via JWKS (rebusca em `kid` desconhecido), `iss`
   esperado, `aud`/`azp` do client, `exp`/`nbf`/`iat` com leeway configurado, `nonce` igual ao do
   fluxo — qualquer falha → 401, sem sessão, com evento de auditoria.
4. Resolução do usuário local (interina — ver `research.md` §6): `email` com
   `email_verified=true` → `User` existente; senão → 403, sem sessão.
5. `enforce_login_auth_method(org, "sso")` → 403 se a org desativou o método.
6. `mint_session_tokens(email, amr="sso", org_id=...)` + `record_audit_event(LOGIN, metadata={"method": "sso", "provider": "keycloak"})`.

**Response 200**:

```json
{
  "user": { "...": "UserRead" },
  "tokens": { "access_token": "...", "refresh_token": "...", "expiry": 1770000000000 },
  "redirect_to": "/dash/cursos"
}
```

`redirect_to` é o destino sanitizado recuperado do fluxo (re-sanitizado no consumo). Os tokens são
os **internos** da plataforma; tokens do Keycloak (access/refresh/ID) nunca aparecem em resposta.

**Erros**:

| Status | `code` | Quando |
|---|---|---|
| 410 | `FLUXO_INVALIDO` | `state` desconhecido, expirado ou já consumido (replay) |
| 401 | `CODIGO_RECUSADO` | token_endpoint recusou o código/verifier (expirado, reutilizado, PKCE incorreto) |
| 401 | `TOKEN_INVALIDO` | Qualquer falha de validação do ID token (assinatura, iss, aud/azp, exp/nbf/iat, nonce) — o claim que falhou vai para o log de auditoria, não para a resposta |
| 403 | `CONTA_NAO_ENCONTRADA` | ID token válido mas sem usuário local correspondente (provisionamento é a feature 002) |
| 403 | `METODO_NAO_PERMITIDO` | Política da org não permite `sso` |
| 503 | `SSO_INDISPONIVEL` | Keycloak/Redis indisponível durante a troca — falha transitória, usuário pode reiniciar o login |

**Auditoria (FR-010)**: eventos registrados em início de fluxo (authorize), callback recebido,
sucesso e cada categoria de falha — nunca contendo `code`, tokens, `code_verifier` ou
`client_secret`.

---

## 3. Configuração (env — sem endpoint nesta fase)

| Variável | Descrição |
|---|---|
| `LEARNHOUSE_KEYCLOAK_ENABLED` | Liga/desliga o provedor no deployment |
| `LEARNHOUSE_KEYCLOAK_ISSUER` | Issuer HTTPS do realm (ex.: `https://kc.exemplo.com/realms/plataforma`) |
| `LEARNHOUSE_KEYCLOAK_CLIENT_ID` | Client OIDC confidencial |
| `LEARNHOUSE_KEYCLOAK_CLIENT_SECRET` | Segredo do client — somente env; nunca em resposta de API, log ou bundle |
| `LEARNHOUSE_KEYCLOAK_CLOCK_SKEW` | Leeway em segundos para `exp`/`nbf`/`iat` (default `30`) |

A administração por organização (tabela `OIDCProviderConfig`, segredo criptografado,
`secret_configured=true`) é a feature `004-admin-config-oidc`.
