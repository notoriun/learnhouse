# Plano de Implementação: Administração da Configuração OIDC

**Branch**: `004-admin-config-oidc` | **Data**: 2026-08-03 | **Spec**: `specs/004-admin-config-oidc/spec.md`

**Input**: Especificação da feature em `/specs/004-admin-config-oidc/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

CRUD administrativo, por organização, da configuração do provedor OIDC: nova tabela
`oidc_provider_config` (SQLModel + migração Alembic; a mesma migração faz o DROP da
tabela órfã `ssoconnection` — research.md §7), endpoints REST sob
`/api/v1/orgs/{org_id}/oidc-config` protegidos por `require_org_admin`
(`apps/api/src/security/org_auth.py`), segredo do cliente cifrado com Fernet
(biblioteca `cryptography` já instalada, chave derivada de env var — mesmo padrão de
`apps/api/src/services/webhooks/crypto.py`), validação anti-SSRF do issuer modelada
em `_validate_webhook_url` (`apps/api/src/services/webhooks/webhooks.py`), teste de
conexão via descoberta OIDC (`httpx`, já instalado), auditoria de toda mudança via
`record_audit_event` (`apps/api/src/services/audit/audit.py`) e componente React
`OrgEditAuthSettings` seguindo o padrão dos componentes `OrgEdit*` do dashboard.
A leitura administrativa retorna `secret_configured: true/false` e nunca o segredo;
a única operação sobre o segredo é a substituição. Esta tabela é o contrato de
política de provisionamento consumido pelas features `001` (login) e `002`
(identidade/provisionamento): esta feature fornece o backing store da interface
`ProvisioningPolicy` consumida pela feature `002` (ordem de implementação:
`001` → `004` fundação → `002` → `003`).

## Technical Context

**Language/Version**: Python (pinado em `>=3.14.6,<3.14.7` — `apps/api/pyproject.toml`) na API; TypeScript / React 19 / Next.js 16 no Web

**Primary Dependencies**: FastAPI 0.141.1, SQLModel 0.0.39, Alembic 1.18.5, `cryptography==49.0.0` (Fernet — já instalada), `httpx==0.28.1` (descoberta OIDC — já instalado); Radix UI + TailwindCSS + react-hot-toast no Web. Nenhuma dependência nova.

**Storage**: PostgreSQL — nova tabela `oidc_provider_config` (1 linha por organização no primeiro release); a mesma migração remove a tabela órfã `ssoconnection` (sem modelo nem consumidor no código — research.md §7). Redis apenas indiretamente (cache de discovery é responsabilidade da feature `001`).

**Testing**: pytest 9.1.1 + pytest-asyncio em `apps/api/src/tests/` (flag de cobertura `api`), seguindo os padrões de `tests/routers/`, `tests/services/` e `tests/security/`.

**Target Platform**: Docker/Linux (instâncias gerenciadas pela CLI `learnhouse`), desenvolvimento via `npx learnhouse dev`.

**Project Type**: Web application — monorepo `apps/web` (Next.js) + `apps/api` (FastAPI).

**Performance Goals**: teste de conexão com timeout total de 5 s; endpoints CRUD administrativos são de baixo tráfego (sem meta de throughput); a leitura da config ativa no fluxo de login (feature `001`) deve ser uma consulta indexada por `org_id`.

**Constraints**: segredo NUNCA presente em resposta, exportação, bundle ou log (SC-002); HTTPS obrigatório fora de `development_mode` (`LEARNHOUSE_DEVELOPMENT_MODE`, lido via `get_learnhouse_config().general_config.development_mode`); issuer não pode resolver para rede privada/loopback/link-local/reservada (SC-003); chave de cifragem fora do banco; máximo 1 provedor por organização no primeiro release.

**Scale/Scope**: 1 configuração por org; 4 endpoints REST; 1 tabela nova; 1 componente React; ~3 arquivos de teste novos na API.

## Constitution Check

*GATE: aprovado antes da Fase 0; reavaliado após o desenho da Fase 1.*

| Princípio | Avaliação | Resultado |
|---|---|---|
| **I. Fronteiras entre Apps São Contratos** | O contrato REST está definido em `contracts/admin-oidc-api.md` antes da implementação. O Web consome exclusivamente os endpoints REST via novo cliente `apps/web/services/auth/oidcAdmin.ts`. O sinal público "login corporativo disponível" chega à página de login pelo payload público da org (contrato com a feature `001`), no mesmo padrão de `apps/web/services/auth/authMethods.ts` — nenhum acesso direto a banco/Redis fora da API. | PASS |
| **II. Backend API-First** | Toda a lógica (cifragem, validação anti-SSRF, discovery, regras de ativação, auditoria) vive em `apps/api`. O componente `OrgEditAuthSettings` só faz UX (formulário, mensagens); nenhuma regra é duplicada no cliente. | PASS |
| **III. Mudanças de Schema Exigem Migrações e Testes** | Nova tabela ⇒ **migração Alembic obrigatória no mesmo PR** em `apps/api/migrations/versions/` (padrão dos arquivos existentes, ex.: `s8t9u0v1w2x3_add_webhook_tables.py`). Novos testes de router, serviço e segurança (SSRF, mascaramento do segredo) cobertos pela suíte da API. | PASS |
| **IV. Segurança Multi-Tenant É Inegociável** | Todo endpoint chama `require_org_admin(user_id, org_id, db_session)` de `apps/api/src/security/org_auth.py` — helper existente que já embute bypass de superadmin e `enforce_org_mfa` (políticas de sessão/MFA da org). Todas as queries filtram por `org_id`; um admin da org A nunca lê a config da org B (teste dedicado, no padrão de `tests/security/test_rbac_cross_org.py`). O segredo não existe no modelo Pydantic de leitura (padrão `has_secret` de `apps/api/src/db/webhooks.py` → aqui `secret_configured`), tornando o vazamento por serialização estruturalmente impossível. Validação anti-SSRF na fronteira de confiança (salvar e testar). Papel padrão de provisionamento não pode ser Admin/Maintainer (`ADMIN_OR_MAINTAINER_ROLE_IDS` de `src/security/rbac/constants.py`). | PASS |
| **V. Simplicidade e Reúso Primeiro** | Reúso máximo: cifragem Fernet do módulo de webhooks, validador SSRF modelado no de webhooks, forma router/serviço de `routers/webhooks.py` + `services/webhooks/webhooks.py`, auditoria via `record_audit_event` existente, formulário no padrão `OrgEdit*`. Zero dependências novas. Sem `FeatureGate`/`require_plan`: a feature nasce no núcleo AGPL, separada do SSO Enterprise. | PASS |

**Reavaliação pós-Fase 1**: decisões de `research.md` e `data-model.md` não introduzem violações — sem dependências novas, sem abstrações de implementação única, migração e testes contemplados. GATE mantido: PASS.

## Project Structure

### Documentation (this feature)

```text
specs/004-admin-config-oidc/
├── plan.md              # Este arquivo (saída do /speckit-plan)
├── research.md          # Fase 0 (/speckit-plan)
├── data-model.md        # Fase 1 (/speckit-plan)
├── quickstart.md        # Fase 1 (/speckit-plan)
├── contracts/
│   └── admin-oidc-api.md
└── tasks.md             # Fase 2 (/speckit-tasks — NÃO criado pelo /speckit-plan)
```

### Source Code (repository root)

```text
apps/api/
├── migrations/
│   └── versions/
│       └── <rev>_add_oidc_provider_config.py     # NOVA migração Alembic (mesmo PR):
│                                                 #   cria oidc_provider_config + DROP da
│                                                 #   órfã ssoconnection (research.md §7)
└── src/
    ├── db/
    │   └── oidc_provider_config.py               # NOVO — modelo SQLModel + schemas Pydantic (Read sem segredo)
    ├── routers/
    │   └── oidc_admin.py                         # NOVO — GET/PUT/DELETE config + POST test
    │                                             #   montado em src/router.py com prefix="/orgs"
    │                                             #   (padrão de routers/webhooks.py), SEM require_plan
    ├── services/
    │   ├── auth/
    │   │   └── oidc_config.py                    # NOVO — CRUD, cifragem, ativação, teste de conexão,
    │   │   │                                     #   get_active_oidc_config(org_id) p/ features 001/002
    │   └── security/
    │       └── url_validation.py                 # NOVO — validador anti-SSRF de issuer
    │                                             #   (extraído de services/webhooks/webhooks.py::_validate_webhook_url)
    ├── security/
    │   └── org_auth.py                           # EXISTENTE — require_org_admin (reusado, sem mudanças)
    └── tests/
        ├── routers/test_oidc_admin_router.py     # NOVO — CRUD, RBAC, segredo mascarado, auditoria
        ├── services/test_oidc_config_service.py  # NOVO — cifragem, substituição de segredo, ativação
        └── security/test_oidc_issuer_ssrf.py     # NOVO — SC-003: privado, loopback, link-local, metadata, HTTP

apps/web/
├── components/Dashboard/Pages/Org/
│   └── OrgEditAuthSettings/
│       └── OrgEditAuthSettings.tsx               # NOVO — formulário (padrão OrgEdit*; ver OrgEditSSO.tsx
│                                                 #   apenas como referência de forma — sem FeatureGate)
└── services/auth/
    └── oidcAdmin.ts                              # NOVO — cliente REST do contrato admin-oidc-api.md
```

**Structure Decision**: Web application no monorepo existente — backend em `apps/api`
(FastAPI/SQLModel/Alembic) e frontend em `apps/web` (Next.js). Nenhum diretório novo
de topo: o modelo entra em `apps/api/src/db/`, o router em `apps/api/src/routers/`
(montado sob `prefix="/orgs"` em `apps/api/src/router.py`, como `webhooks` e
`api_tokens`), a lógica em `apps/api/src/services/auth/`, e o componente segue a
convenção `apps/web/components/Dashboard/Pages/Org/OrgEdit*`. O validador SSRF nasce
em `apps/api/src/services/security/` (diretório existente, ex.: `rate_limiting.py`)
para reúso futuro pelos webhooks.

## Complexity Tracking

Nenhuma violação da constituição — tabela vazia.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
