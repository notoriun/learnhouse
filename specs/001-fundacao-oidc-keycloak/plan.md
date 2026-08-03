# Implementation Plan: Login Corporativo via Keycloak (Fundação OIDC)

**Branch**: `001-fundacao-oidc-keycloak` | **Date**: 2026-08-03 | **Spec**: `specs/001-fundacao-oidc-keycloak/spec.md`

**Input**: Especificação da feature em `specs/001-fundacao-oidc-keycloak/spec.md`

## Summary

Adicionar login federado via Keycloak usando OIDC Authorization Code + PKCE S256, sem tocar no
modelo de sessão existente. O BFF (Next.js) expõe duas rotas server-side
(`/api/auth/keycloak/authorize` e `/api/auth/keycloak/callback`) que orquestram o redirect ao
Keycloak e a gravação de cookies; toda a lógica sensível — geração de state/nonce/verifier de uso
único no Redis, troca do código no token_endpoint, validação completa do ID token (assinatura via
JWKS, iss, aud/azp, exp/nbf/iat, nonce) e emissão da sessão interna — vive no FastAPI, em um novo
router (`apps/api/src/routers/keycloak_auth.py`) e serviço
(`apps/api/src/services/auth/keycloak_oidc.py`). Nenhum token do provedor transita pelo JavaScript
do navegador; o navegador recebe apenas redirects e os cookies httpOnly já usados pelo login nativo
(`LH_access`/`LH_refresh`). Sem mudança de schema: o fluxo é efêmero (Redis) e a configuração do
provedor é estática (env/config) nesta fase. Implementação exclusivamente com dependências já
instaladas (httpx, PyJWT[crypto], redis) — sem biblioteca OIDC nova.

## Technical Context

**Language/Version**: Python 3.14 (API, `requires-python >=3.14.6` em `apps/api/pyproject.toml`);
TypeScript / Next.js App Router (Web)

**Primary Dependencies**: FastAPI 0.141.1, SQLModel 0.0.39, Alembic 1.18.5, httpx 0.28.1,
PyJWT[crypto] 2.13.0 (JWKS via `jwt.PyJWKClient`), redis 8.1.0 (API); Next.js Route Handlers (Web).
Nenhuma dependência nova.

**Storage**: Redis (estado efêmero do fluxo: state/nonce/verifier, uso único, TTL curto — via
`src/core/redis.py::get_redis_client`). PostgreSQL não é alterado nesta feature (sem migração;
`ExternalIdentity` pertence à feature 002).

**Testing**: pytest 9.1.1 + pytest-asyncio, padrão existente em `apps/api/src/tests/routers/` e
`apps/api/src/tests/security/`; tokens de teste assinados com chave RSA gerada via `cryptography`
(já instalada); Redis e httpx substituídos por fakes/patches como nos testes de auth existentes.

**Target Platform**: Docker/Linux (deploy padrão via CLI `learnhouse`); dev local com
`npx learnhouse dev` + Keycloak em container.

**Project Type**: Web application (monorepo `apps/web` + `apps/api`)

**Performance Goals**: Login completo (escolha da opção → página de destino) < 15 s em rede normal
(SC-001); discovery e JWKS cacheados para não adicionar round-trips por login.

**Constraints**: Nenhum token do provedor em respostas visíveis ao navegador, URL fragment ou
storage (FR-004/SC-003); state/nonce/verifier de uso único com TTL ≤ 10 min (FR-003); tolerância de
clock skew limitada e configurável (default 30 s); indisponibilidade do Keycloak não afeta sessões
ativas nem o login nativo (FR-011/SC-005); falha de validação nunca cria sessão (SC-002).

**Scale/Scope**: 2 rotas BFF novas, 3 endpoints FastAPI novos, 1 serviço OIDC, 1 botão na tela de
login, ~2 arquivos de teste. Fora de escopo: provisionamento/ExternalIdentity (002), logout
coordenado (003), tela admin (004).

## Constitution Check

*GATE: aprovado antes da Fase 0; reavaliado após o design da Fase 1 — sem violações.*

| Princípio | Veredito | Justificativa |
|---|---|---|
| I. Fronteiras entre Apps São Contratos | ✅ | Web fala com a API somente via REST: as rotas BFF chamam `POST /api/v1/auth/keycloak/{authorize,callback}` e `GET /api/v1/auth/keycloak/status`. Somente a API acessa Redis. Os contratos estão definidos em `contracts/api-oidc.md` antes da implementação. |
| II. Backend API-First | ✅ | Toda a lógica (flow state, troca de código, validação de claims, emissão de sessão, auditoria) vive no FastAPI. O BFF apenas redireciona e espelha cookies — mesmo papel que `apps/web/app/api/auth/[...path]/route.ts` já exerce hoje; nenhuma regra de servidor é duplicada no cliente. |
| III. Mudanças de Schema Exigem Migrações e Testes | ✅ | Nenhuma mudança de schema → nenhuma migração Alembic necessária (estado do fluxo é efêmero no Redis). O comportamento novo de endpoints vem com testes pytest no mesmo PR: fluxo feliz + testes negativos por claim (assinatura, iss, aud/azp, exp/nbf/iat, nonce, state reutilizado) — ver `research.md` §8. |
| IV. Segurança Multi-Tenant É Inegociável | ✅ | O fluxo é vinculado à organização desde o início (state carrega org e destino); o callback reaplica `enforce_login_auth_method` (`src/services/orgs/auth_policy.py`) com o método `sso`; redirect final sanitizado (apenas caminhos relativos internos — rejeita `//host` e esquemas externos); validação integral do ID token na fronteira de confiança; nenhum atalho de validação em dev/teste. |
| V. Simplicidade e Reúso Primeiro | ✅ | Zero dependências novas: httpx + PyJWT[crypto] (`PyJWKClient` para JWKS) + redis já instalados. Reúso direto de `mint_session_tokens` (`src/services/auth/session.py`), `AUTH_METHOD_SSO` (`src/security/session_context.py`), `record_audit_event`, `get_redis_client` e do padrão de uso único via Redis já provado em `magic_login._burn_jti`. Config estática (env) em vez de tabela nova especulativa — a tabela é da feature 004. |

**Nota — fronteira OSS/Enterprise (Princípio V, separação OSS/Enterprise)**: é **PERMITIDO**
alterar `apps/web/app/auth/login/login.tsx` (arquivo AGPL do repositório público) para coordenar a
exibição dos botões de login: quando o Keycloak OSS está habilitado, ele tem precedência sobre o
SSO Enterprise e apenas um botão de identidade corporativa aparece (ver Assumptions da spec). É
**PROIBIDO** reutilizar ou estender o fluxo SSO Enterprise (`@services/auth/sso`,
`auth/sso/callback`) — o caminho Keycloak é implementação nova e independente.

## Project Structure

### Documentation (this feature)

```text
specs/001-fundacao-oidc-keycloak/
├── plan.md              # Este arquivo
├── spec.md              # Especificação da feature
├── research.md          # Fase 0 — decisões técnicas
├── data-model.md        # Fase 1 — estruturas efêmeras (Redis)
├── quickstart.md        # Fase 1 — guia de validação
├── contracts/
│   └── api-oidc.md      # Fase 1 — contratos REST (FastAPI) e BFF (Next.js)
└── tasks.md             # Fase 2 (/speckit-tasks — não gerado pelo plan)
```

### Source Code (repository root)

```text
apps/api/
├── config/
│   └── config.py                                    # ALTERAR: bloco KeycloakConfig (issuer, client_id,
│                                                    #   client_secret, clock_skew, enabled) lido de env
├── src/
│   ├── router.py                                    # ALTERAR: include_router(keycloak_auth, prefix="/auth/keycloak")
│   ├── routers/
│   │   └── keycloak_auth.py                         # NOVO: POST /authorize, POST /callback, GET /status
│   ├── services/auth/
│   │   └── keycloak_oidc.py                         # NOVO: discovery+cache, flow state Redis (uso único),
│   │                                                #   troca de código (httpx), validação ID token (PyJWT/JWKS),
│   │                                                #   sanitização de redirect
│   └── tests/
│       ├── routers/
│       │   └── test_keycloak_auth_router.py         # NOVO: fluxo feliz, state reutilizado/expirado,
│       │                                            #   org sem provedor, provedor indisponível, redirect sanitizado
│       └── security/
│           └── test_keycloak_oidc_validation.py     # NOVO: testes negativos por claim (assinatura, iss,
│                                                    #   aud, azp, exp, nbf, iat, nonce, kid desconhecido)

apps/web/
├── app/
│   ├── api/auth/keycloak/
│   │   ├── authorize/route.ts                       # NOVO: GET ?org=&redirect= → chama API, 302 ao Keycloak
│   │   └── callback/route.ts                        # NOVO: GET ?code=&state= → chama API, grava cookies
│   │                                                #   httpOnly (padrão de app/api/auth/[...path]/route.ts),
│   │                                                #   302 interno; erro → /login?error=...
│   └── auth/login/
│       └── login.tsx                                # ALTERAR: botão "Entrar com identidade corporativa"
│                                                    #   (visível quando GET /api/v1/auth/keycloak/status → enabled)
```

**Structure Decision**: Estrutura de web application do monorepo existente — backend em `apps/api`
(router + serviço + testes, espelhando o par `routers/auth.py` / `services/auth/`) e frontend em
`apps/web` (rotas BFF em `app/api/auth/keycloak/`, ao lado do proxy de auth existente
`app/api/auth/[...path]/route.ts`, que já materializa o padrão de espelhar tokens do corpo da
resposta para cookies httpOnly). Nenhum diretório novo de topo; nenhuma mudança em `apps/collab` ou
`apps/cli`.

## Complexity Tracking

Sem violações da constituição — tabela vazia.
