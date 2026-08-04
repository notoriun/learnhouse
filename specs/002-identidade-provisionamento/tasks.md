# Tasks: Identidade Externa, Linking e Provisionamento

**Input**: Design documents from `/specs/002-identidade-provisionamento/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/provisioning.md, quickstart.md

**Tests**: OBRIGATÓRIOS nesta feature — SC-002, SC-003 e SC-004 exigem comprovação por testes
automatizados, e o Princípio III da constituição exige testes para toda mudança de schema e de
comportamento. Em cada story, os testes vêm PRIMEIRO e DEVEM FALHAR antes da implementação.

**Organization**: tarefas agrupadas por user story, na ordem de prioridade da spec
(US1 e US2 = P1; US3 e US4 = P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência entre si)
- **[Story]**: US1, US2, US3, US4 — somente nas fases de story
- Caminho de arquivo exato em toda tarefa

## Nota de Integração — Feature 001

O consumidor de `provision_federated_login` é o callback OIDC server-side da feature
`001-fundacao-oidc-keycloak`, que entrega claims JÁ validados criptograficamente
(`contracts/provisioning.md`). Esta feature NÃO implementa o callback nem depende dele para
ser testada: todos os testes chamam `provision_federated_login` diretamente com fixtures de
`FederatedClaims` (unidade/integração via sessão de banco de teste), sem fluxo OIDC completo.
A ligação callback → serviço é uma linha no lado da feature 001 e fica fora deste tasks.md.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: garantir base limpa para a migração e linha de base verde de regressão

- [X] T001 Verificar head único do Alembic com `cd apps/api && uv run alembic heads`; se houver
      múltiplos heads, criar merge seguindo o precedente
      `apps/api/migrations/versions/e6f7a8b9c0d1_merge_heads.py`
- [X] T002 [P] Rodar a linha de base de regressão que deve permanecer verde ao final
      (quickstart §3): `cd apps/api && uv run pytest src/tests/routers/test_auth_router.py
      src/tests/routers/test_auth_logout_revocation.py src/tests/routers/test_login_provenance.py
      src/tests/security -q`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: modelo, migração e extensões compartilhadas de auditoria/contrato — nada de story
antes disto

**⚠️ CRITICAL**: nenhuma user story pode começar antes desta fase completa. A migração Alembic
DEVE acompanhar o mesmo PR (Constituição, Princípio III).

- [X] T003 [P] Criar modelo `ExternalIdentity` em `apps/api/src/db/external_identities.py`
      conforme data-model.md §1: campos `id`, `user_id` (FK `user.id`, `ondelete="CASCADE"`,
      not null), `organization_id` (FK `organization.id`, `ondelete="SET NULL"`, nullable),
      `issuer`, `subject`, `provider` (default `"keycloak"`), `email_at_link_time`,
      `created_at` (`_utcnow()`, padrão de `user_audit_events.py`), `last_login_at`;
      `__table_args__` com `UniqueConstraint("issuer", "subject",
      name="uq_externalidentity_issuer_subject")` e índices `ix_externalidentity_user_id`,
      `ix_externalidentity_organization_id`
- [X] T004 [P] Alterar `apps/api/src/db/user_audit_events.py`: `user_id` passa a `Optional`
      (nullable); adicionar tipos `sso_provisioned`, `sso_linked`, `sso_login_denied`,
      `sso_conflict` a `UserAuditEventType`; atualizar o docstring de escopo (linhas 23-29,
      hoje declara "somente ações de aprendizagem do aluno" — research.md §8)
- [X] T005 Gerar e escrever a migração Alembic: `cd apps/api && uv run alembic revision -m
      "add external identity"` → arquivo em
      `apps/api/migrations/versions/<rev>_add_external_identity.py`, encadeado no head único
      (T001). `upgrade()`: cria a tabela `externalidentity` com a constraint
      `uq_externalidentity_issuer_subject`, os índices e as FKs (CASCADE/SET NULL) E, na MESMA
      migração, torna `user_audit_event.user_id` anulável (research.md §8). `downgrade()`:
      restaura `NOT NULL` e dropa a tabela. Esta migração cria APENAS `externalidentity` e a
      alteração de auditoria — NÃO toca a tabela órfã `ssoconnection`, cujo DROP é
      responsabilidade da migração da feature 004 (research.md §4)
- [X] T006 Verificar reversibilidade da migração (quickstart §1): `cd apps/api && uv run
      alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head`;
      conferir no banco `\d externalidentity` (constraint e FKs) e `\d user_audit_event`
      (`user_id` nullable)
- [X] T007 [P] Alterar `apps/api/src/services/audit/audit.py`: `record_audit_event` aceita
      eventos sem `user_id` para os tipos `sso_*` (remover o early-return `if not user_id`
      de audit.py:59-60 para esses tipos), mantendo o comportamento atual para os demais
- [X] T008 [P] Criar o esqueleto do contrato em
      `apps/api/src/services/auth/provisioning.py`: dataclasses `FederatedClaims`,
      `ProvisioningPolicy` (defaults restritivos: `auto_provision=False`,
      `allow_link_by_email=False`, `allowed_email_domains=[]`, `default_role_id=None`),
      `ProvisioningSuccess`, `ProvisioningDenied`, `ProvisioningConflict` e as assinaturas
      `provision_federated_login(...)` e `get_provisioning_policy(...)` conforme
      contracts/provisioning.md e data-model.md §2

**Checkpoint**: schema migrado e contrato tipado — stories podem começar

---

## Phase 3: User Story 1 - Primeiro acesso com provisionamento automático (Priority: P1) 🎯 MVP

**Goal**: usuário sem conta local entra pela identidade corporativa e, se a política permitir
(e-mail verificado, domínio autorizado, auto-provisionamento ativo), ganha conta com papel de
menor privilégio; caso contrário é negado com auditoria.

**Independent Test**: chamar `provision_federated_login` com claims de usuário inexistente e
política de fixture; verificar conta criada, membership, papel e evento — sem fluxo OIDC.

### Tests for User Story 1 (escrever PRIMEIRO — devem FALHAR) ⚠️

- [X] T009 [US1] Teste: primeiro acesso conforme cria `User` (`signup_method="sso"`,
      `email_verified=True`), `ExternalIdentity` (`email_at_link_time` preenchido),
      `UserOrganization` com papel de menor privilégio (nunca role_id 1/2) e evento
      `sso_provisioned` sem tokens no metadata (SC-001, US1-1) em
      `apps/api/src/tests/services/test_provisioning.py`
- [X] T010 [US1] Teste: e-mail NÃO verificado → `ProvisioningDenied(email_nao_verificado)`,
      ZERO escrita em `user`/`externalidentity`/`userorganization` — comprova SC-002 ("zero
      vínculo com e-mail não verificado") no caminho de provisionamento — em
      `apps/api/src/tests/services/test_provisioning.py`
- [X] T011 [US1] Teste: `auto_provision=False` → `ProvisioningDenied(auto_provision_desativado)`
      sem conta criada; e política padrão (org sem configuração) é restritiva (US1-3) em
      `apps/api/src/tests/services/test_provisioning.py`
- [X] T012 [US1] Teste: domínio fora de `allowed_email_domains` →
      `ProvisioningDenied(dominio_nao_permitido)` + evento `sso_login_denied` com apenas o
      domínio (nunca o e-mail completo) no metadata (US1-4); lista vazia não restringe — em
      `apps/api/src/tests/services/test_provisioning.py`

### Implementation for User Story 1

- [X] T013 [P] [US1] Adicionar parâmetro opcional `role_id: int = 4` a `create_user` em
      `apps/api/src/services/users/users.py` (substitui o `role_id=4` fixo do membership em
      users.py:283; default preserva todos os chamadores atuais — research.md §5)
- [X] T014 [P] [US1] Implementar `get_provisioning_policy` em
      `apps/api/src/services/auth/provisioning.py`: lê a política pela interface
      `ProvisioningPolicy`, cujo backing store é a tabela `oidc_provider_config` da feature
      004 (research.md §4); em testes, fixtures de `ProvisioningPolicy`
      (contracts/provisioning.md); ausência
      ou erro de leitura → defaults restritivos (fail-closed, data-model.md §2); valida que
      `default_role_id` referencia `Role` da própria org e nunca papel privilegiado
      (`ADMIN_ROLE_ID`/`MAINTAINER_ROLE_ID` de `apps/api/src/security/rbac/constants.py`)
- [X] T015 [US1] Implementar os passos 2, 3 e 5 do fluxo (data-model.md §5) em
      `apps/api/src/services/auth/provisioning.py`: `email_verified` (ausente = False) →
      domínio case-insensitive → `auto_provision` → `create_user(request, db_session, ...,
      is_oauth=True, signup_provider="sso", role_id=política)` + criar `ExternalIdentity`;
      `IntegrityError` na constraint única = corrida perdida → re-selecionar a linha vencedora
      e prosseguir como login (research.md §1 e §3); emitir `sso_provisioned` e
      `sso_login_denied` via `record_audit_event` com `extract_request_context(request)`,
      sem tokens/segredos (FR-011)

**Checkpoint**: US1 completa — provisionamento e negações funcionam e são auditados

---

## Phase 4: User Story 2 - Identidade estável mesmo com troca de e-mail (Priority: P1)

**Goal**: identidade reconhecida por `issuer+subject`, nunca por e-mail: troca de e-mail no
provedor mantém a mesma conta; e-mail reciclado jamais dá acesso à conta alheia.

**Independent Test**: provisionar um usuário (fixture), alterar o e-mail nos claims e chamar
o serviço de novo; verificar mesmo `user.id` e contagem de contas inalterada.

### Tests for User Story 2 (escrever PRIMEIRO — devem FALHAR) ⚠️

- [X] T016 [US2] Teste de regressão dedicado (SC-003): mesmo `issuer+subject` com e-mail novo
      → mesma conta local, ZERO conta criada, `User.email` e `email_at_link_time` inalterados,
      `last_login_at` atualizado, evento `login` com `email_changed: true` no metadata
      (US2-1, FR-007) em `apps/api/src/tests/services/test_provisioning.py`
- [X] T017 [US2] Teste: novo `subject` chega com o e-mail ANTIGO de outra conta → NUNCA acessa
      a conta do antigo dono; termina em conflito para revisão administrativa ou em conta
      própria conforme a política (US2-2, quickstart §2.5) em
      `apps/api/src/tests/services/test_provisioning.py`
- [X] T018 [US2] Teste: identidade vinculada a usuário local desativado →
      `ProvisioningDenied(usuario_desativado)` sem recriar conta; e organização inativa →
      `ProvisioningDenied(organizacao_inativa)` (edge cases da spec) em
      `apps/api/src/tests/services/test_provisioning.py`

### Implementation for User Story 2

- [X] T019 [US2] Implementar o passo 1 do fluxo (localizar) em
      `apps/api/src/services/auth/provisioning.py`: `SELECT ExternalIdentity WHERE
      issuer+subject`; encontrada + usuário ativo → atualizar `last_login_at`, backfill de
      perfil SOMENTE em campos vazios (`first_name`, `last_name`, `avatar_image` —
      research.md §7), e-mail mudou → apenas evento de auditoria (`email_changed`), conta
      intocada; usuário desativado → negar `usuario_desativado`; org inativa → negar
      `organizacao_inativa`; retorno `ProvisioningSuccess(outcome="login")`

**Checkpoint**: US1 + US2 completas — o serviço de provisionamento cobre criar e reconhecer

---

## Phase 5: User Story 3 - Vínculo seguro a conta pré-existente (Priority: P2)

**Goal**: conta nativa com e-mail coincidente e verificado é vinculada quando a política
permite; qualquer ambiguidade vira conflito para revisão administrativa, nunca vínculo
automático.

**Independent Test**: criar conta local por fixture, chamar o serviço com claims de e-mail
coincidente e políticas variadas; verificar vínculo único ou conflito auditado.

### Tests for User Story 3 (escrever PRIMEIRO — devem FALHAR) ⚠️

- [X] T020 [US3] Teste: e-mail verificado coincidente (case-insensitive) +
      `allow_link_by_email=True` → `ExternalIdentity` criada na conta EXISTENTE (sem conta
      nova), membership garantido idempotentemente, evento `sso_linked` (US3-1) em
      `apps/api/src/tests/services/test_provisioning.py`
- [X] T021 [US3] Teste: mesmo cenário com e-mail NÃO verificado → nenhum vínculo, acesso
      negado — completa a comprovação de SC-002 no caminho de linking (US3-2, FR-004) em
      `apps/api/src/tests/services/test_provisioning.py`
- [X] T022 [US3] Teste de conflito → revisão administrativa (SC-004): os três casos —
      `email_em_outra_organizacao`, `email_conflito_politica` (política nega),
      `identidade_conflitante` (usuário já tem identidade do mesmo issuer com outro subject)
      — terminam SEM vínculo, SEM sessão, com evento durável `sso_conflict` (`user_id` NULL,
      e-mail no metadata para a revisão localizar o caso) e mensagem sem vazar dados da conta
      alheia (US3-3, FR-005) em `apps/api/src/tests/services/test_provisioning.py`

### Implementation for User Story 3

- [X] T023 [P] [US3] (SATISFEITA POR REÚSO — o vínculo verifica o membership existente via UserOrganization; conta sem membership na org vira conflito email_em_outra_organizacao, então o linking nunca cria membership novo) Extrair o bloco de membership idempotente de `signWithGoogle`
      (`apps/api/src/services/auth/utils.py:233-276` — checar `UserOrganization` existente,
      quota, criar vínculo, `_invalidate_session_cache`, `notify_user_joined_org`) para
      função compartilhada em `apps/api/src/services/auth/utils.py`, reusada por
      `signWithGoogle` e pelo provisionamento (research.md §5 — extraída, não duplicada)
- [X] T024 [US3] Implementar o passo 4 do fluxo (vincular/conflitar) em
      `apps/api/src/services/auth/provisioning.py`: busca case-insensitive
      (`func.lower(User.email)`, padrão de utils.py:151-153); existe + política permite + sem
      ambiguidade → criar `ExternalIdentity` + membership via helper de T023 + `sso_linked`;
      qualquer ambiguidade → `ProvisioningConflict` + `sso_conflict`, sem escrita de vínculo

**Checkpoint**: US1 + US2 + US3 — todos os terminais do fluxograma implementados

---

## Phase 6: User Story 4 - Sessão persistente e renovação transparente (Priority: P2)

**Goal**: sessão federada emitida pelo MESMO mecanismo interno do login nativo (cookies
httpOnly, rotação de refresh com jti e janela de graça) — por decisão de research.md §6,
esta fase NÃO escreve código de sessão, apenas comprova o reúso.

**Independent Test**: emitir sessão via `issue_session_or_challenge` com `amr="sso"` e
exercitar `/api/auth/refresh` — sem fluxo OIDC.

### Tests for User Story 4 (comprovação do reúso) ⚠️

- [X] T025 [P] [US4] Teste: sessão emitida com `amr=AUTH_METHOD_SSO`
      (`apps/api/src/security/session_context.py:62`) e `org_id` do fluxo carrega claims
      `amr="sso"`/`sorg` e cookies `LH_access`/`LH_refresh` httpOnly — estender
      `apps/api/src/tests/routers/test_login_provenance.py`
- [X] T026 [P] [US4] Teste: refresh de sessão SSO rotaciona o `jti`, reapresentação dentro da
      janela de graça re-serve o mesmo par (múltiplas abas, US4-2) e replay fora da janela é
      negado com revogação e log `replay_detected` (US4-3, FR-010) — estender
      `apps/api/src/tests/routers/test_auth_logout_revocation.py`
- [X] T027 [US4] Rodar a regressão de sessão existente (quickstart §3):
      `cd apps/api && uv run pytest src/tests/routers/test_auth_router.py
      src/tests/routers/test_auth_logout_revocation.py
      src/tests/routers/test_login_provenance.py -q` e confirmar que NENHUM código de
      sessão foi alterado por esta feature (FR-009: "o mesmo mecanismo")

**Checkpoint**: todas as user stories comprovadas de forma independente

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: validação transversal dos Success Criteria e fechamento do checklist

- [ ] T028 (PENDENTE — validação manual em dev com Keycloak da 001) [P] Executar a validação manual do quickstart.md §2 (7 grupos de cenários) num
      ambiente `npx learnhouse dev` com realm Keycloak da feature 001, incluindo DevTools
      (cookies httpOnly, nenhum token do provedor em rede/localStorage — §2.7)
- [X] T029 [P] Rodar a suíte de autorização (SC-006 — zero regressão de permissões):
      `cd apps/api && uv run pytest src/tests/security -q`
- [X] T030 Verificar ausência de tokens/códigos/segredos em `audit_metadata` de todos os
      eventos `sso_*` (asserções nos testes de
      `apps/api/src/tests/services/test_provisioning.py` + query do quickstart §4:
      `select * from user_audit_event where event_type like 'sso_%'`)
- [ ] T031 (PENDENTE — suíte completa; 13 falhas pré-existentes idênticas à dev limpa) Rodar a suíte completa da API: `cd apps/api && uv run pytest src/tests -q` e
      fechar o checklist de aceitação do quickstart.md §4

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências
- **Foundational (Phase 2)**: depende de T001 (head único); BLOQUEIA todas as stories.
  T005 depende de T003 + T004; T006 depende de T005; T007 depende de T004; T008 é
  independente após T003
- **US1 (Phase 3)**: depende da Phase 2; T015 depende de T009–T014
- **US2 (Phase 4)**: depende da Phase 2; edita o mesmo `provisioning.py` de US1 → executar
  após T015 (ou coordenar no mesmo dev). T019 depende de T016–T018
- **US3 (Phase 5)**: depende da Phase 2; T024 depende de T020–T023 e do mesmo arquivo de
  US1/US2 → após T019
- **US4 (Phase 6)**: depende apenas da Phase 2 (o mecanismo de sessão já existe); testável
  em paralelo às demais stories — arquivos de teste distintos
- **Polish (Phase 7)**: depende de todas as stories desejadas
- **GATE — fundação da feature 004**: a execução em ambiente real das stories que leem a
  política (US1/US3, via `get_provisioning_policy` — T014) requer a migração da feature 004
  aplicada (tabela `oidc_provider_config`, backing da interface `ProvisioningPolicy`);
  testes unitários/integração NÃO requerem — usam fixtures de `ProvisioningPolicy`
  (contracts/provisioning.md). Ordem entre features: 001 → 004 (fundação) → 002 → 003

### User Story Dependencies

- **US1 (P1)**: nenhuma dependência de outra story
- **US2 (P1)**: independente em teste, mas compartilha `provisioning.py` com US1 (o passo
  "localizar" é o destino da corrida de provisionamento de US1 — research.md §3)
- **US3 (P2)**: usa os passos 1–3 já implementados (US1/US2); helper T023 é arquivo separado
- **US4 (P2)**: só depende da Foundational; não toca `provisioning.py`

### Within Each User Story

- Testes escritos primeiro e FALHANDO antes da implementação
- Modelo (Phase 2) → serviço → auditoria; story completa antes da próxima prioridade

---

## Parallel Example

```bash
# Phase 2 — arquivos diferentes, após T001:
Task T003: "Criar modelo ExternalIdentity em apps/api/src/db/external_identities.py"
Task T004: "Alterar apps/api/src/db/user_audit_events.py (user_id anulável + tipos sso_*)"
# depois de T003/T004, em paralelo:
Task T007: "record_audit_event aceita user_id nulo em apps/api/src/services/audit/audit.py"
Task T008: "Esqueleto do contrato em apps/api/src/services/auth/provisioning.py"

# Phase 3 — implementação em arquivos diferentes:
Task T013: "role_id opcional em apps/api/src/services/users/users.py"
Task T014: "get_provisioning_policy em apps/api/src/services/auth/provisioning.py"

# US4 pode rodar em paralelo a US2/US3 (arquivos de teste distintos):
Task T025: "amr=sso/sorg em apps/api/src/tests/routers/test_login_provenance.py"
Task T026: "rotação/replay SSO em apps/api/src/tests/routers/test_auth_logout_revocation.py"
```

Nota: os testes de uma mesma story (ex.: T009–T012) vivem todos em
`apps/api/src/tests/services/test_provisioning.py` e por isso NÃO levam [P] — mesmo arquivo.

---

## Implementation Strategy

### MVP First (US1 + US2)

O MVP é **Setup + Foundational + US1 + US2** (T001–T019). Justificativa: ambas são P1 e
compartilham o mesmo serviço (`apps/api/src/services/auth/provisioning.py`) — US1 sem US2
seria incoerente, pois o passo "localizar" (US2) é tanto o segundo login de toda conta
provisionada quanto o destino do perdedor da corrida de provisionamento (`IntegrityError` →
re-selecionar → login, research.md §3). Além disso, SC-003 (zero conta duplicada em troca de
e-mail) é critério de sucesso obrigatório que só US2 comprova. Entregar US1 sozinha criaria
contas que não conseguem voltar a entrar.

1. Phase 1 → Phase 2 (migração no MESMO PR — Princípio III)
2. Phase 3 (US1) → validar testes T009–T012 verdes
3. Phase 4 (US2) → validar SC-003 com T016
4. **PARAR e VALIDAR**: quickstart §2.1–2.5 + T029 (autorização)

### Incremental Delivery

1. MVP (US1+US2) → deploy/demo: primeiro acesso e identidade estável funcionam
2. US3 → contas nativas passam a vincular; conflitos ficam visíveis para revisão (a tela de
   revisão é a feature 004 — o registro nasce aqui)
3. US4 → comprovação do reúso de sessão (sem código novo)
4. Polish → SC-006 e checklist completo

### Parallel Team Strategy

Com dois devs após a Phase 2: Dev A segue US1 → US2 → US3 (mesmo arquivo de serviço,
sequencial por natureza); Dev B faz US4 (T025–T027) e T023 (helper em `utils.py`) em
paralelo, entregando o helper antes de A chegar em T024.
