# Tasks: Administração da Configuração OIDC

**Input**: Documentos de design em `/specs/004-admin-config-oidc/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/admin-oidc-api.md, quickstart.md

**Tests**: OBRIGATÓRIOS nesta feature — o Princípio III da constituição exige testes para toda mudança
de comportamento da API, e os critérios SC-002/SC-003 da spec exigem auditoria automatizada de
não-vazamento do segredo e de rejeição anti-SSRF. Testes são escritos ANTES da implementação em cada
story e devem FALHAR antes do código correspondente.

**Organization**: Tarefas agrupadas por user story para permitir implementação e teste independentes
de cada story.

## Format: `[ID] [P?] [Story] Descrição`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependências)
- **[Story]**: A qual user story a tarefa pertence (US1, US2, US3) — apenas nas fases de story
- Caminho de arquivo exato em toda descrição

## Path Conventions

Monorepo web app (plan.md): backend em `apps/api/` (FastAPI/SQLModel/Alembic, testes em
`apps/api/src/tests/`), frontend em `apps/web/` (Next.js). Nenhum diretório novo de topo.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirmar pré-requisitos — a feature não introduz dependências nem env vars novas (Princípio V).

- [X] T001 Verificar pré-requisitos em `apps/api/pyproject.toml`: `cryptography==49.0.0` e `httpx==0.28.1` já pinados (nenhuma dependência nova) e `LEARNHOUSE_AUTH_JWT_SECRET_KEY` presente no ambiente de dev (chave de cifragem Fernet, fora do banco)
- [X] T002 [P] Rodar a suíte existente da API (`pytest` em `apps/api/src/tests/`) para estabelecer baseline verde antes das mudanças

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tabela, modelo e validador anti-SSRF — infraestrutura que TODAS as stories consomem.

**⚠️ CRITICAL**: Nenhuma story pode começar antes desta fase terminar.

- [X] T003 [P] Extrair o validador anti-SSRF de `_validate_webhook_url` (`apps/api/src/services/webhooks/webhooks.py:40-71`) para novo módulo `apps/api/src/services/security/url_validation.py`: `urlparse` → `socket.getaddrinfo` → `ipaddress.ip_address` rejeitando `is_private | is_loopback | is_link_local | is_reserved | is_multicast | is_unspecified`; HTTPS obrigatório salvo `general_config.development_mode`; mensagens de erro em pt-BR sem ecoar endereços resolvidos internos (research.md §2)
- [X] T004 [P] Criar modelo SQLModel `OIDCProviderConfig` e schemas Pydantic em `apps/api/src/db/oidc_provider_config.py` conforme data-model.md: tabela `oidc_provider_config` (org_id UNIQUE FK CASCADE, issuer_url, client_id, client_secret_encrypted, scopes, enabled, allowed_email_domains, auto_provision_users, default_role_id, required_acr, clock_skew_seconds 0–300, created_by_user_id, timestamps timestamptz); `OIDCProviderConfigRead` SEM campo de segredo + `secret_configured: bool`; `OIDCProviderConfigWrite` com `client_secret` write-only; `OIDCConnectionTestResult` (status/detail/discovered_endpoints)
- [X] T005 Criar migração Alembic em `apps/api/migrations/versions/<rev>_add_oidc_provider_config.py` (mesmo PR — Princípio III): cria `oidc_provider_config` (UNIQUE em `org_id`, FKs para organization/role/user, timestamptz) e faz DROP da tabela órfã `ssoconnection` (criada por `apps/api/migrations/versions/a1b2c3d4e5f6_add_sso_connection.py`, sem modelo SQLModel nem consumidor no código — descarte conforme research.md §7; o `downgrade()` recria ambas as estruturas)

**Checkpoint**: Fundação pronta — as user stories podem começar.

---

## Phase 3: User Story 1 - Configurar o provedor de identidade da organização (Priority: P1) 🎯 MVP

**Goal**: Admin da org cadastra, testa, ativa, desativa e exclui a configuração OIDC pelos 4 endpoints
REST de `contracts/admin-oidc-api.md`, com validação anti-SSRF do issuer e RBAC `require_org_admin`.

**Independent Test**: Configurar um provedor de desenvolvimento via API, validar a conexão (status
`ok`), ativar, e confirmar 403 para não-admin e admin de outra org (quickstart §1, §3, §7).

### Tests for User Story 1 (escrever primeiro — devem FALHAR) ⚠️

- [X] T006 [P] [US1] Escrever testes anti-SSRF em `apps/api/src/tests/security/test_oidc_issuer_ssrf.py` (SC-003): issuer em faixa privada (`https://192.168.1.10/...`, `https://10.0.0.5/...`), loopback (`https://localhost/...`), link-local/metadata de nuvem (`https://169.254.169.254/...`, `https://metadata.google.internal/...` via resolução DNS), reservada, `http://` fora de `development_mode`, e redirect 3xx no discovery — todos rejeitados com 400 sem requisição alcançar o destino
- [X] T007 [P] [US1] Escrever testes de router em `apps/api/src/tests/routers/test_oidc_admin_router.py`: 401 anônimo; 403 usuário não-admin; 403 admin de OUTRA org contra o `org_id` do path (padrão `apps/api/src/tests/security/test_rbac_cross_org.py`, Princípio IV); GET 404 sem config; PUT upsert 200 com forma do contrato; DELETE sem `confirm=true` → 400 e com `confirm=true` → 200 preservando contas/vínculos; `Cache-Control: no-store` nas respostas
- [X] T008 [P] [US1] Escrever testes de serviço em `apps/api/src/tests/services/test_oidc_config_service.py`: upsert parcial mantém campos ausentes; issuer normalizado sem barra final; classificação do teste de conexão com `httpx` mockado — timeout/erro de conexão/5xx → `inacessivel`, 4xx/corpo não-JSON/campos obrigatórios ausentes/`issuer` divergente/redirect → `invalida`, 200 coerente → `ok` com endpoints descobertos (mensagens pt-BR distintas, FR-006); alternar `enabled` via upsert persiste e é refletido pela camada de serviço — `get_active_oidc_config(org_id)` retorna a config com `enabled=true` e `None` com `enabled=false` (a parte de FR-007/SC-005 que ESTA feature controla)

### Implementation for User Story 1

- [X] T009 [US1] Implementar serviço em `apps/api/src/services/auth/oidc_config.py`: upsert singleton por org, leitura, exclusão com `confirm=true` obrigatório, `get_active_oidc_config(org_id) -> OIDCProviderConfig | None` (filtro `org_id = ? AND enabled = true`), e validação do issuer via `apps/api/src/services/security/url_validation.py` ANTES de persistir mudança de issuer (FR-003)
- [X] T010 [US1] Implementar o teste de conexão/discovery em `apps/api/src/services/auth/oidc_config.py` (depende de T009): `GET {issuer_url}/.well-known/openid-configuration` com `httpx.Timeout(5.0)` e `follow_redirects=False`, verificação de `issuer` coincidente e campos obrigatórios (`issuer`, `authorization_endpoint`, `token_endpoint`, `jwks_uri`), resultado estruturado `ok | inacessivel | invalida` com detail pt-BR (research.md §5); a mesma rotina roda no salvar e no endpoint de teste
- [X] T011 [US1] Implementar router `apps/api/src/routers/oidc_admin.py`: `GET/PUT/DELETE /oidc-config` + `POST /oidc-config/test` conforme `contracts/admin-oidc-api.md`, todos com `require_org_admin(user_id, org_id, db_session)` de `apps/api/src/security/org_auth.py`, `Cache-Control: no-store`, e rate limit por org nas mutações e no teste de conexão (padrão `apps/api/src/services/security/rate_limiting.py`)
- [X] T012 [US1] Montar o router em `apps/api/src/router.py` com `prefix="/orgs"` (mesmo padrão de `webhooks` e `api_tokens`) e rodar T006–T008 até ficarem verdes

**Checkpoint**: US1 funcional e testável de forma independente — MVP entregável.

---

## Phase 4: User Story 2 - Segredo protegido de ponta a ponta (Priority: P1)

**Goal**: Segredo cifrado com Fernet (chave fora do banco), nunca presente em resposta, log ou
auditoria; única operação é a substituição (FR-004/FR-005, SC-002).

**Independent Test**: Cadastrar segredo-canário conhecido e auditar todas as respostas
administrativas, o banco (ciphertext `gAAAA`) e os logs: zero ocorrências do valor (quickstart §4).

### Tests for User Story 2 (escrever primeiro — devem FALHAR) ⚠️

- [X] T013 [P] [US2] Escrever testes de não-vazamento em `apps/api/src/tests/routers/test_oidc_admin_router.py`: após cadastrar segredo-canário, o valor está ausente de TODAS as respostas (GET, PUT, POST test, erros 400/422) enquanto `secret_configured: true` está presente; asserção estrutural de que `OIDCProviderConfigRead` não possui nenhum campo de segredo (vazamento por serialização impossível); PUT com `enabled=true` sem segredo configurado → 400 pt-BR (barreira implementada em T016)
- [X] T014 [P] [US2] Escrever testes de cifragem e rotação em `apps/api/src/tests/services/test_oidc_config_service.py`: valor no banco é ciphertext Fernet (prefixo `gAAAA`), roundtrip decrypt só no backend; PUT com `client_secret` ausente/`null` mantém o atual, string não vazia substitui (rotação sem interrupção, FR-005), string vazia → 422; `caplog` sem o segredo-canário

### Implementation for User Story 2

- [X] T015 [US2] Integrar cifragem no serviço `apps/api/src/services/auth/oidc_config.py` reutilizando `encrypt_secret`/`decrypt_secret` de `apps/api/src/services/webhooks/crypto.py` (chave SHA-256 de `LEARNHOUSE_AUTH_JWT_SECRET_KEY` — zero env vars novas, research.md §1); implementar a semântica write-only do PUT: ausente/`null` mantém, não vazia substitui (única operação permitida), vazia → 422
- [X] T016 [US2] Aplicar as barreiras de vazamento em `apps/api/src/services/auth/oidc_config.py` e `apps/api/src/routers/oidc_admin.py`: `enabled=true` exige `secret_configured=true` (400 pt-BR caso contrário); nenhuma mensagem de erro, log ou exceção ecoa `client_secret`; rodar T013–T014 até verdes

**Checkpoint**: US1 e US2 funcionam de forma independente; segredo estruturalmente protegido.

---

## Phase 5: User Story 3 - Políticas de provisionamento configuráveis (Priority: P2)

**Goal**: Admin define auto-provisionamento, domínios permitidos, papel padrão de menor privilégio,
`required_acr` e tolerância de relógio — consumidos pela feature `002` via contrato intra-API.

**Independent Test**: Alterar cada política via PUT e verificar persistência/validação; papel elevado
rejeitado; `get_active_oidc_config` entrega a política completa da config ativa.

### Tests for User Story 3 (escrever primeiro — devem FALHAR) ⚠️

- [ ] T017 [P] [US3] Escrever testes de política em `apps/api/src/tests/services/test_oidc_config_service.py`: `default_role_id` inexistente, de outra org ou em `ADMIN_OR_MAINTAINER_ROLE_IDS` (`apps/api/src/security/rbac/constants.py`) → 400; obrigatório quando `auto_provision_users=true`; `allowed_email_domains` normalizados (minúsculas, sem `@`, duplicatas removidas, formato válido); `clock_skew_seconds` fora de 0–300 → 422; `get_active_oidc_config(org_id)` retorna `None` com `enabled=false` e a política completa com `enabled=true`
- [ ] T018 [P] [US3] Escrever teste de contrato em `apps/api/src/tests/routers/test_oidc_admin_router.py`: PUT com campos de política (`allowed_email_domains`, `auto_provision_users`, `default_role_id`, `required_acr`, `clock_skew_seconds`) persiste e retorna os valores na forma do contrato; mudança de política não altera `enabled` nem sessões (FR-009 — sem efeito colateral)

### Implementation for User Story 3

- [ ] T019 [US3] Implementar as validações de política no serviço `apps/api/src/services/auth/oidc_config.py`: `default_role_id` existe, pertence à org (ou é global) e NÃO está em `ADMIN_OR_MAINTAINER_ROLE_IDS` (menor privilégio — mesma regra de `apps/api/src/services/admin/admin.py`), obrigatório com auto-provisionamento; normalização de `allowed_email_domains`; faixa de `clock_skew_seconds` via `ge`/`le` no schema Write em `apps/api/src/db/oidc_provider_config.py`
- [ ] T020 [US3] Consolidar o contrato ProvisioningPolicy com a feature `002-identidade-provisionamento`: `get_active_oidc_config(org_id)` em `apps/api/src/services/auth/oidc_config.py` expõe `auto_provision_users`, `allowed_email_domains`, `default_role_id`, `required_acr` e `clock_skew_seconds`; documentar na docstring que a função é o contrato intra-API consumido pelas features `001` (login/validação de tokens) e `002` (admissão/provisionamento); rodar T017–T018 até verdes

**Checkpoint**: Todas as user stories funcionais e independentes.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Auditoria `oidc_config_*`, frontend completo e validação do quickstart.

- [ ] T021 [P] Adicionar os tipos `oidc_config_created`, `oidc_config_updated`, `oidc_config_activated`, `oidc_config_deactivated`, `oidc_config_deleted`, `oidc_config_secret_rotated` a `UserAuditEventType` em `apps/api/src/db/user_audit_events.py` e atualizar a docstring de `record_audit_event` em `apps/api/src/services/audit/audit.py` registrando a extensão deliberada de escopo para ações administrativas (research.md §6)
- [ ] T022 Emitir `record_audit_event` em todas as operações do serviço `apps/api/src/services/auth/oidc_config.py` (criação, edição, ativação, desativação, exclusão, rotação) com `audit_metadata` contendo a lista de NOMES dos campos alterados — nunca valores; rotação registra apenas o evento `oidc_config_secret_rotated` (FR-008; depende de T021)
- [ ] T023 Adicionar testes de auditoria em `apps/api/src/tests/routers/test_oidc_admin_router.py`: cada operação gera exatamente um evento com autor, momento e `org_id` corretos, e `audit_metadata` sem o segredo-canário (SC-004; depende de T022)
- [ ] T024 [P] Criar cliente REST `apps/web/services/auth/oidcAdmin.ts` no padrão de `apps/web/services/auth/sso.ts`, cobrindo os 4 endpoints de `contracts/admin-oidc-api.md` (GET/PUT/DELETE config + POST test)
- [ ] T025 Criar componente `apps/web/components/Dashboard/Pages/Org/OrgEditAuthSettings/OrgEditAuthSettings.tsx` no padrão `OrgEdit*` (`useOrg` + `useLHSession`, `@components/ui/{input,button,label,switch,select}`, `react-hot-toast`, `useTranslation` pt-BR), SEM `FeatureGate` (núcleo AGPL — research.md §4): campo de segredo write-only tipo password exibido como "segredo configurado" com ação única "substituir", botão "Testar conexão" mostrando `status`/`detail`, switch ativo/inativo, políticas de provisionamento (depende de T024)
- [ ] T026 Registrar a aba "Autenticação" na página de settings da org `apps/web/app/orgs/[orgslug]/dash/org/settings/[subpage]/page.tsx`, renderizando `OrgEditAuthSettings` (depende de T025)
- [ ] T027 Executar o roteiro completo de `specs/004-admin-config-oidc/quickstart.md` (passos 0–7) em `npx learnhouse dev` com Keycloak local: SC-001 (config ao primeiro login < 15 min), SC-002 (canário ausente de respostas/logs/banco/bundle), SC-003 (issuers internos rejeitados), SC-004 (auditoria completa), SC-005 (botão some na desativação) — GATE: bloqueada até a feature `001` estar implementada (ver "Dependência externa" em Dependencies)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — começa imediatamente
- **Foundational (Phase 2)**: depende do Setup — BLOQUEIA todas as stories; T005 (migração) depende de T004 (modelo); T003 é independente
- **User Stories (Phases 3–5)**: todas dependem da Phase 2 completa
  - US1 (P1): sem dependência de outras stories — MVP
  - US2 (P1): estende o serviço/router criados na US1 (T015/T016 tocam os mesmos arquivos de T009–T011) — executar após a US1
  - US3 (P2): estende o serviço da US1; independente da US2 em conteúdo, mas toca os mesmos arquivos — executar em sequência ou em branch coordenada
- **Polish (Phase 6)**: T021→T022→T023 em sequência; T024→T025→T026 em sequência; as duas trilhas (auditoria e frontend) são paralelas entre si; T027 por último

### Dependência externa (feature `001`)

A remoção do botão de login da organização (FR-007/SC-005) depende do flag público
"login corporativo disponível" servido no payload público da org pela feature `001`
— fora do escopo desta feature. Esta feature garante apenas a sua parte do
contrato: `enabled` persiste e é refletido por `get_active_oidc_config`
(assertado em T008). **T027 fica bloqueada (gate) até a feature `001` estar
implementada**, pois a verificação de SC-005 no quickstart depende desse flag.

### Within Each User Story

- Testes escritos e FALHANDO antes da implementação
- Serviço antes do router; router antes da montagem em `apps/api/src/router.py`
- Story completa (testes verdes) antes de passar à próxima prioridade

### Parallel Opportunities

- Phase 2: T003 ∥ T004 (arquivos diferentes)
- Phase 3: T006 ∥ T007 ∥ T008 (três arquivos de teste distintos)
- Phase 4: T013 ∥ T014 (routers vs. services)
- Phase 5: T017 ∥ T018 (services vs. routers)
- Phase 6: trilha de auditoria (T021–T023) ∥ trilha de frontend (T024–T026)

---

## Parallel Example: User Story 1

```bash
# Escrever os três arquivos de teste da US1 em paralelo (devem falhar):
Task: "Testes anti-SSRF em apps/api/src/tests/security/test_oidc_issuer_ssrf.py"
Task: "Testes de router (RBAC/CRUD) em apps/api/src/tests/routers/test_oidc_admin_router.py"
Task: "Testes de serviço (upsert/discovery) em apps/api/src/tests/services/test_oidc_config_service.py"

# Na Phase 2, em paralelo:
Task: "Extrair validador anti-SSRF para apps/api/src/services/security/url_validation.py"
Task: "Criar modelo SQLModel em apps/api/src/db/oidc_provider_config.py"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup (T001–T002)
2. Phase 2: Foundational (T003–T005) — CRITICAL, bloqueia tudo
3. Phase 3: US1 (T006–T012)
4. **PARAR e VALIDAR**: CRUD + teste de conexão + RBAC + anti-SSRF funcionais (quickstart §1–§3, §7)
5. Demo/deploy se pronto — observação: para produção real, incluir a US2 (o segredo cifrado e mascarado é P1 na spec e o modelo já nasce com `client_secret_encrypted` e `secret_configured` desde a fundação; a US1 sozinha só é MVP de demonstração)

### Incremental Delivery

1. Setup + Foundational → fundação pronta (tabela migrada, órfã `ssoconnection` descartada)
2. US1 → testar de forma independente → MVP demonstrável
3. US2 → auditoria de não-vazamento do canário → release P1 completo
4. US3 → políticas de provisionamento → contrato pronto para a feature `002`
5. Polish → auditoria `oidc_config_*` + tela `OrgEditAuthSettings` + quickstart completo

### Parallel Team Strategy

Com dois desenvolvedores, após a Phase 2:

1. Dev A: US1 → US2 (mesmos arquivos de serviço/router — sequência natural)
2. Dev B: trilha de frontend do Polish (T024–T026) contra o contrato `admin-oidc-api.md`, em paralelo desde o fim da US1
3. US3 e trilha de auditoria (T021–T023) entram quando US2 fechar; T027 valida tudo ao final

---

## Notes

- [P] = arquivos diferentes, sem dependências entre si
- US2 e US3 estendem arquivos criados na US1 (`oidc_config.py`, `oidc_admin.py`, arquivos de teste) — dentro de cada fase os testes são paralelizáveis, mas as fases de story rodam em sequência
- Verificar que os testes falham antes de implementar; commit após cada tarefa ou grupo lógico
- Migração Alembic no MESMO PR do modelo (Princípio III); segredo jamais em resposta/log/auditoria (Princípio IV, SC-002)
