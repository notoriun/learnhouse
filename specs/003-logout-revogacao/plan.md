# Implementation Plan: Logout Coordenado e Revogação de Sessão

**Branch**: `003-logout-revogacao` | **Date**: 2026-08-03 | **Spec**: `specs/003-logout-revogacao/spec.md`

**Input**: Feature specification from `/specs/003-logout-revogacao/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Coordenar o encerramento de sessão entre a plataforma e o Keycloak: (1) o logout de sessões
federadas revoga a sessão local, invalida o refresh interno, limpa cookies nas variantes
host-only e domain-scoped e conduz o navegador ao `end_session_endpoint` do Keycloak
(RP-Initiated Logout com `id_token_hint` e `post_logout_redirect_uri` cadastrada); (2) um novo
endpoint back-channel recebe logout tokens do Keycloak, valida-os criptograficamente (JWKS,
claims `events`/`sid`/`sub`) e revoga idempotentemente as sessões locais vinculadas ao `sid`;
(3) o refresh interno de sessões federadas passa a validar/renovar a sessão upstream ANTES de
rotacionar o refresh local, distinguindo rejeição definitiva (`invalid_grant` → encerra) de
falha transitória (timeout/5xx → preserva e permite retry), com TTL máximo absoluto por
política.

Abordagem técnica: nova entidade **Sessão Upstream** (tabela `upstream_session` + migração
Alembic) vincula cada cadeia de sessão local (novo claim `usid` no JWT) à sessão do provedor
(`issuer` + `sid`), guardando o refresh upstream e o ID token cifrados (Fernet, chave fora do
banco — mesma abordagem do `client_secret` da feature 004). O enforcement no hot path reusa o
padrão Redis existente (`jwt_revoked_before:*`): chave `upstream_revoked:{usid}` verificada em
`get_current_user` e no `/auth/refresh`. Observabilidade segue o padrão de log estruturado com
conjunto fechado de outcomes já usado em `auth.refresh` (`_log_refresh_outcome`), mais eventos
de auditoria durável via `record_audit_event`. O logout nativo (e-mail/senha, Google, magic
link) permanece inalterado.

## Technical Context

**Language/Version**: Python 3.14 (`apps/api`), TypeScript / Next.js 16 + React 19 (`apps/web`)

**Primary Dependencies**: FastAPI 0.141, SQLModel 0.0.39, Alembic 1.18, PyJWT 2.13 (`[crypto]`),
`cryptography` 49.0 (Fernet — já instalada), `httpx` 0.28 (chamadas ao token endpoint), Redis
(`src/core/redis.get_redis_client`). Nenhuma dependência nova.

**Storage**: PostgreSQL (tabela nova `upstream_session`; auditoria em `user_audit_event`
existente); Redis (chaves de revogação por sessão `upstream_revoked:{usid}`, anti-replay de
logout token `backchannel_jti:{jti}`, reuso dos padrões `jwt_revoked_before:*`,
`refresh_used:*`, `refresh_grace:*`)

**Testing**: pytest (suíte `apps/api/src/tests/security/` — padrões em
`test_session_revocation.py`, `test_refresh_grace.py`, `test_remediation_auth_refresh.py`);
`bun test` para o BFF quando aplicável

**Target Platform**: Linux server (Docker); instâncias self-hosted e SaaS multi-tenant

**Project Type**: web application (backend FastAPI + BFF Next.js)

**Performance Goals**: o refresh federado adiciona no máximo 1 chamada ao token endpoint do
Keycloak por rotação (não por request; abas concorrentes são absorvidas pela grace window
existente); p95 do refresh federado < 2 s com provedor saudável; timeout upstream curto (5 s)
para que indisponibilidade não bloqueie o endpoint

**Constraints**: nenhum token do provedor transita pelo JavaScript da aplicação (ADR-03);
falha transitória do Keycloak NÃO pode derrubar sessões (SC-004: ≥95% das sessões sobrevivem a
10 min de indisponibilidade); revogação definitiva imediata via back-channel (SC-002); logout
nativo sem regressão (FR-010); registros sem tokens/segredos (FR-008)

**Scale/Scope**: mesma escala da plataforma atual; back-channel é tráfego server-to-server
esporádico (1 requisição por logout/revogação no realm); tabela `upstream_session` cresce 1
linha por login federado, com estados terminais e limpeza por retenção

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**I. Fronteiras entre Apps São Contratos — PASS.** Toda comunicação nova atravessa interfaces
publicadas: o BFF (`apps/web/app/api/auth/keycloak/logout/route.ts`) fala com a API somente
pelos endpoints REST (`POST /auth/keycloak/logout`); o Keycloak fala com a API pelo endpoint
back-channel (`POST /auth/keycloak/backchannel-logout`). Nenhum acesso direto a
PostgreSQL/Redis fora da API. Os contratos estão definidos ANTES da implementação em
`contracts/logout.md`.

**II. Backend API-First — PASS.** Revogação, validação do logout token, refresh upstream, TTL
e auditoria vivem em `apps/api` (FastAPI + SQLModel). O BFF apenas encaminha, limpa cookies e
redireciona (papel que já exerce hoje em `apps/web/app/api/auth/[...path]/route.ts`); o
frontend decide apenas QUAL rota de logout navegar, com base no método de autenticação da
sessão — dica de UX sem autoridade.

**III. Mudanças de Schema Exigem Migrações e Testes — PASS (com ação obrigatória).** Há
mudança de schema: nova tabela `upstream_session` (modelo em
`apps/api/src/db/upstream_sessions.py`). A migração Alembic
(`apps/api/migrations/versions/*_add_upstream_session.py`) DEVE acompanhar o mesmo PR do
modelo. As mudanças de comportamento do `/auth/refresh`, do logout e o endpoint back-channel
DEVEM chegar com testes na suíte da API (flag de cobertura `api`) — testes novos em
`apps/api/src/tests/security/` cobrindo os casos negativos do plano de testes (seção 15 do
documento-base).

**IV. Segurança Multi-Tenant É Inegociável — PASS (caminho de segurança, sem simplificação).**
Revogação é caminho de segurança: (a) o logout token do back-channel é validado integralmente
(assinatura via JWKS, `iss` cadastrado, `aud`, `iat`/`exp`, claim `events` correto, `sid`/`sub`
presentes, `nonce` proibido) — notificação inválida tem efeito zero (SC-005); (b) o refresh
upstream e o ID token são cifrados em repouso com chave fora do banco; (c) rejeição definitiva
NUNCA é reclassificada como transitória por conveniência; (d) consultas a `upstream_session`
são filtradas por `issuer` + `sid` (o `sid` só tem significado dentro do issuer da organização)
e por `user_id` nos caminhos autenticados; (e) nenhum teste ou atalho de dev desabilita a
validação criptográfica do logout token.

**V. Simplicidade e Reúso Primeiro — PASS.** Zero dependências novas. Reusos deliberados:
blocklist Redis (`revoke_user_sessions_before` / `_is_token_revoked_for_user`), rotação com
grace window (`_mark_refresh_jti_used` / `_store_refresh_grace`), limpeza de cookies em duas
variantes (`appendClearAuthCookies` no BFF), auditoria durável (`record_audit_event`), padrão
de telemetria por outcomes fechados (`_log_refresh_outcome`), claims de proveniência
(`session_context.py`, que já define `AUTH_METHOD_SSO = "sso"`), cliente Redis singleton
(`src/core/redis.py`), Fernet da `cryptography` já instalada. Não se introduz Prometheus nem
plataforma nova de métricas (a spec assume a infraestrutura existente).

**Re-check pós-Phase 1**: mantido PASS — o design final não adicionou projetos, dependências
ou abstrações com implementação única.

## Project Structure

### Documentation (this feature)

```text
specs/003-logout-revogacao/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── logout.md        # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/api/
├── migrations/versions/
│   └── xxxx_add_upstream_session.py        # NOVO — migração Alembic da tabela upstream_session
├── src/
│   ├── db/
│   │   └── upstream_sessions.py            # NOVO — modelo SQLModel UpstreamSession (+ estados)
│   ├── routers/
│   │   ├── keycloak_auth.py                # ALTERAR (criado na feature 001) — adicionar:
│   │   │                                   #   POST /auth/keycloak/logout (revoga + end_session_url)
│   │   │                                   #   POST /auth/keycloak/backchannel-logout
│   │   └── auth.py                         # ALTERAR — /auth/refresh: ramo federado
│   │                                       #   (upstream primeiro, transitório vs definitivo, TTL)
│   ├── security/
│   │   ├── auth.py                         # ALTERAR — get_current_user: rejeitar token com
│   │   │                                   #   usid presente em upstream_revoked:{usid}
│   │   └── session_context.py              # ALTERAR — novo claim USID_CLAIM ("usid"),
│   │                                       #   carregado por carry_session_claims na rotação
│   ├── services/auth/
│   │   ├── upstream_session.py             # NOVO — criar/consultar/revogar vínculo upstream;
│   │   │                                   #   cifragem Fernet; chaves Redis; TTL máximo
│   │   ├── keycloak_oidc.py                # ALTERAR (criado na feature 001) — validação do
│   │   │                                   #   logout token (JWKS já cacheado); refresh upstream
│   │   │                                   #   no token endpoint; classificação de erro
│   │   └── session.py                      # (sem mudança de contrato — chokepoint reutilizado)
│   ├── db/user_audit_events.py             # ALTERAR — novo tipo SESSION_REVOKED
│   └── tests/security/
│       ├── test_backchannel_logout.py      # NOVO — assinatura/claims/idempotência/replay
│       ├── test_upstream_refresh.py        # NOVO — ordem upstream-primeiro, invalid_grant,
│       │                                   #   transitório, TTL máximo, grace concorrente
│       └── test_rp_logout.py               # NOVO — revogação + end_session_url + auditoria

apps/web/
├── app/api/auth/
│   ├── keycloak/logout/route.ts            # NOVO — rota BFF de navegação top-level: revoga na
│   │                                       #   API, limpa cookies (2 variantes), 302 → Keycloak
│   └── [...path]/route.ts                  # ALTERAR (mínimo) — reexportar appendClearAuthCookies
│                                           #   (ou extrair helper) p/ a rota federada reusar
└── components/Contexts/AuthContext.tsx     # ALTERAR — signOut: sessão SSO navega para
                                            #   /api/auth/keycloak/logout; nativa inalterada
```

**Structure Decision**: Aplicação web no monorepo existente — backend em `apps/api` (FastAPI,
SQLModel, Alembic, testes pytest em `src/tests/security/`) e BFF/frontend em `apps/web`
(Next.js App Router, rotas em `app/api/auth/*`). Nenhum diretório novo de topo: a feature
estende os módulos de auth criados pelas features 001/002 (`routers/keycloak_auth.py`,
`services/auth/keycloak_oidc.py`) e os pontos reais de sessão de hoje (`routers/auth.py`,
`security/auth.py`, `app/api/auth/[...path]/route.ts`, `AuthContext.tsx`).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Sem violações — tabela não aplicável. (Registro de trade-off, não violação: o `id_token_hint`
transita na URL de navegação top-level do logout RP-Initiated; ver research.md, decisão R6 —
não é acessível ao JavaScript da aplicação e não é credencial reutilizável.)
