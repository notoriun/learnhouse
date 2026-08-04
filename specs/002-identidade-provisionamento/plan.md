# Implementation Plan: Identidade Externa, Linking e Provisionamento

**Branch**: `002-identidade-provisionamento` | **Date**: 2026-08-03 | **Spec**: `specs/002-identidade-provisionamento/spec.md`

**Input**: Feature specification from `/specs/002-identidade-provisionamento/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Introduz a entidade `ExternalIdentity` (unicidade `issuer + subject` garantida por constraint
de banco), o serviço de provisionamento/linking que decide — na ordem localizar → verificar →
provisionar/vincular/negar/conflitar — o destino de cada primeiro acesso federado, e a emissão
da sessão federada pelo mesmo mecanismo interno já existente (cookies `LH_access`/`LH_refresh`
httpOnly, rotação de refresh com jti de uso único e janela de graça para concorrência).
A abordagem é de reúso máximo: criação de usuário via `create_user(..., is_oauth=True)`
(`apps/api/src/services/users/users.py`), sessão via `issue_session_or_challenge`
(`apps/api/src/services/auth/session.py`) com `amr="sso"` (constante já existente em
`apps/api/src/security/session_context.py`), auditoria via `record_audit_event`
(`apps/api/src/services/audit/audit.py`) com novos tipos de evento. O código novo se
concentra em dois arquivos: o modelo `external_identities.py` e o serviço `provisioning.py`,
mais uma migração Alembic no mesmo PR.

## Dependência entre Features

A política de provisionamento é lida exclusivamente pela interface `ProvisioningPolicy`,
cujo backing store é a tabela `oidc_provider_config`, criada pela migração de fundação da
feature 004 (que também descarta a tabela órfã `ssoconnection` — documentado lá). Em
execução real, a fundação da feature 004 DEVE preceder as fases de user story desta
feature. Os testes desta feature permanecem independentes: todos usam fixtures de
`ProvisioningPolicy` (contracts/provisioning.md), sem tocar o backing store. Ordem de
implementação entre features: **001 → 004 (fundação/tabela) → 002 → 003**.

## Technical Context

**Language/Version**: Python >=3.14.6 (`apps/api/pyproject.toml`)

**Primary Dependencies**: FastAPI 0.141, SQLModel 0.0.39, Alembic 1.18, PyJWT, Redis (jti de
refresh e janela de graça — já em uso em `apps/api/src/security/auth.py`)

**Storage**: PostgreSQL (tabela nova `externalidentity`; alteração em `user_audit_event`);
Redis para controles de rotação de refresh (existente)

**Testing**: pytest (suíte em `apps/api/src/tests/`, flag de cobertura `api`)

**Target Platform**: Linux server (Docker), instâncias gerenciadas pela CLI `learnhouse`

**Project Type**: web service (monorepo — toda a lógica desta feature vive em `apps/api`;
`apps/web` não muda: o proxy de cookies já existe)

**Performance Goals**: o passo de provisionamento adiciona no máximo 3–4 queries ao callback
de login federado (lookup da identidade, política, usuário por e-mail, inserções); sem
impacto nos endpoints existentes

**Constraints**: nenhum token, código ou segredo em logs/auditoria; decisão de
provisionamento atômica frente a logins concorrentes do mesmo `subject` (resolvida pela
constraint única do banco, não por lock de aplicação)

**Scale/Scope**: multi-tenant (várias organizações por instância); 1 tabela nova, 1 coluna
alterada, ~2 arquivos novos de código, ~4 arquivos tocados, testes para todos os caminhos de
decisão

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Resultado |
|-----------|-----------|-----------|
| I. Fronteiras entre Apps São Contratos | Nenhum canal novo entre apps. O serviço de provisionamento é interno à API e consumido pelo callback OIDC da feature 001. O contrato interno está documentado em `contracts/provisioning.md`; o navegador continua recebendo apenas cookies e redirects. | PASS |
| II. Backend API-First | Toda a lógica (política, linking, provisionamento, auditoria) vive em `apps/api/src/services/`. `apps/web` não duplica regra alguma — só repassa cookies como já faz hoje (`apps/web/services/auth/cookies.ts`). | PASS |
| III. Mudanças de Schema Exigem Migrações e Testes | Esta feature MUDA schema: cria `externalidentity` e torna `user_audit_event.user_id` anulável. A migração Alembic (em `apps/api/migrations/versions/`) DEVE acompanhar o mesmo PR, com `upgrade`/`downgrade` e testes pytest cobrindo todos os caminhos de decisão (SC-002/SC-003 exigem testes automatizados). | PASS (com obrigação explícita) |
| IV. Segurança Multi-Tenant É Inegociável | A política de provisionamento é por organização; toda consulta de vínculo/membership filtra por `org_id` (`UserOrganization`); conflito entre organizações NUNCA vincula automaticamente (FR-005); papel padrão é o de menor privilégio, nunca derivado de claims (FR-006); eventos de auditoria carregam `org_id`. A unicidade `issuer+subject` é global (identidade é do usuário, não da org) — decisão registrada em `research.md`. | PASS |
| V. Simplicidade e Reúso Primeiro | Zero dependências novas. Reúso: `create_user`, `issue_session_or_challenge`, rotação de refresh existente (FR-009/FR-010 já são satisfeitos pelo mecanismo atual — ver `research.md`), `record_audit_event`, constante `AUTH_METHOD_SSO` já existente. Unicidade por constraint de BD, não por código. | PASS |

Re-check pós-design (Phase 1): sem violações; nenhuma entrada em Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-identidade-provisionamento/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── provisioning.md  # Contrato interno do serviço + eventos de auditoria
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/api/
├── alembic.ini
├── migrations/versions/
│   └── <rev>_add_external_identity.py     # NOVO: tabela externalidentity +
│                                          #   user_audit_event.user_id anulável
│                                          #   (encadear no head atual; se houver
│                                          #   múltiplos heads, seguir o precedente
│                                          #   e6f7a8b9c0d1_merge_heads.py)
└── src/
    ├── db/
    │   ├── external_identities.py         # NOVO: modelo ExternalIdentity (SQLModel)
    │   ├── users.py                       # existente — inalterado (User)
    │   ├── user_organizations.py          # existente — inalterado (UserOrganization)
    │   ├── roles.py                       # existente — inalterado (Role)
    │   ├── organizations.py               # existente — inalterado (Organization)
    │   └── user_audit_events.py           # ALTERADO: user_id anulável + tipos de
    │                                      #   evento SSO (sso_provisioned, sso_linked,
    │                                      #   sso_login_denied, sso_conflict)
    ├── services/
    │   ├── auth/
    │   │   ├── provisioning.py            # NOVO: localizar → verificar → provisionar/
    │   │   │                              #   vincular/negar/conflitar + política
    │   │   ├── session.py                 # existente — reusado (issue_session_or_challenge)
    │   │   └── utils.py                   # existente — referência de padrão (signWithGoogle)
    │   ├── users/users.py                 # ALTERADO: create_user ganha parâmetro
    │   │                                  #   opcional role_id (default 4, comportamento
    │   │                                  #   atual preservado)
    │   └── audit/audit.py                 # ALTERADO: record_audit_event aceita eventos
    │                                      #   de identidade sem user_id
    ├── security/
    │   ├── auth.py                        # existente — reusado (rotação de refresh,
    │   │                                  #   jti, janela de graça, cookies)
    │   └── session_context.py             # existente — reusado (AUTH_METHOD_SSO)
    └── tests/
        └── services/
            └── test_provisioning.py       # NOVO: todos os caminhos de decisão
                                           #   (conforme, e-mail não verificado, domínio,
                                           #   auto-provision off, troca de e-mail,
                                           #   conflito, usuário desativado)
```

**Structure Decision**: feature contida em `apps/api` (backend API-first). O local do modelo
segue o padrão do diretório `apps/api/src/db/` (um arquivo por entidade, ex.:
`user_organizations.py`) e o caminho sugerido pelo documento-base (seção 6:
`apps/api/src/db/external_identities.py`). O serviço vive em
`apps/api/src/services/auth/provisioning.py`, ao lado de `session.py` e `utils.py`, que já
concentram os fluxos de sign-in. `apps/web` não é tocado: o callback BFF é escopo da feature
001 e os cookies já são gravados pelo mecanismo existente.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Nenhuma violação — tabela vazia.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
