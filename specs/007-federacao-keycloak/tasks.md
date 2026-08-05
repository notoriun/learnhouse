# Tasks: Federação de Identidade — Keycloak como Dono Único dos Usuários

**Input**: Design documents from `/specs/007-federacao-keycloak/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: incluídos — a Constituição (Princípio III) exige testes para mudanças de
comportamento da API, e a spec/quickstart os lista explicitamente.

**Organization**: tarefas agrupadas por user story; cada story é independentemente
implementável e testável.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizável (arquivos distintos, sem dependência pendente)
- **[Story]**: US1 (registro federado), US2 (migração), US3 (bloqueios federados)

---

## Phase 1: Setup

**Purpose**: preparar o ambiente local de validação (realm de dev coerente com a federação)

- [ ] T001 Atualizar `docker/keycloak/realm-dev.json`: `registrationAllowed: true` e
      `registrationEmailAsUsername: true` (research §5), mantendo client/usuários de teste;
      recriar o container do Keycloak local e conferir a tela de registro acessível

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: nenhum — as três stories não compartilham código novo entre si (o helper de
federação serve só à US3 e o client Admin API vive dentro do script da US2). Sem tarefas
bloqueantes: as stories podem começar em paralelo após T001.

**Checkpoint**: T001 concluída → US1, US2 e US3 liberadas em paralelo

---

## Phase 3: User Story 1 - Criar conta pelo provedor corporativo (Priority: P1) 🎯 MVP

**Goal**: "Criar conta" leva ao registro do Keycloak; o retorno cai no callback existente e o
JIT provisiona — nenhuma regra de admissão nova (FR-001/002/003).

**Independent Test**: quickstart passo 1 — registrar usuária inédita pelo navegador no
ambiente docker local e chegar autenticada em `/home`, com vínculo em `externalidentity`;
negativos de registro desabilitado e provedor fora do ar.

### Implementation for User Story 1

- [ ] T002 [US1] Em `apps/api/src/services/auth/keycloak_oidc.py`, aceitar
      `action="register"` na montagem da URL de autorização: trocar o path do
      `authorization_endpoint` descoberto de `/protocol/openid-connect/auth` para
      `/protocol/openid-connect/registrations`, mantendo client_id, redirect_uri, scope,
      state, nonce e PKCE idênticos (research §1)
- [ ] T003 [US1] Em `apps/api/src/routers/keycloak_auth.py`, adicionar campo opcional
      `action: Literal["login", "register"]` ao corpo do `POST /authorize` (default
      "login") e repassar ao serviço; valor fora do conjunto → 422 pelo schema. **Guarda
      FR-010**: `register` com config efetiva vinda de row de org (IdP de terceiro) → `400
      {code: "REGISTRO_NAO_DISPONIVEL"}`. No `GET /status`, expor campo `platform: bool`
      (config efetiva é a global da plataforma) — contracts/registro-federado.md §1 e §3b
- [ ] T004 [US1] Testes em `apps/api/src/tests/routers/test_keycloak_auth_router.py`:
      (a) `action=register` → `authorization_url` contém `/registrations` e preserva
      state/nonce/PKCE; (b) `action` inválida → 422; (c) sem `action` → comportamento atual
      inalterado; (d) org sem login corporativo → mesmo erro de hoje; (e) org com config
      OIDC própria (IdP terceiro) + `action=register` → 400 `REGISTRO_NAO_DISPONIVEL`;
      (f) `GET /status` retorna `platform` true/false conforme a origem da config efetiva
- [ ] T005 [P] [US1] Em `apps/web/app/api/auth/keycloak/authorize/route.ts`, repassar
      `action=register` da query ao corpo enviado à API; qualquer outro valor é tratado como
      login (contracts/registro-federado.md §2)
- [ ] T006 [P] [US1] Em `apps/web/app/auth/login/login.tsx`, exibir "Criar conta pela
      identidade corporativa" quando `status.enabled && status.platform` (guarda FR-010 —
      nunca para org com IdP de terceiro), apontando para
      `/api/auth/keycloak/authorize?org=<slug>&action=register&redirect=/home`; chaves de
      tradução em `apps/web/locales/pt.json` e `apps/web/locales/en.json` (research §6)
- [ ] T007 [US1] Validar quickstart passo 1 no ambiente docker local (registro feliz +
      negativos de `registrationAllowed` off e Keycloak fora do ar)

**Checkpoint**: US1 funcional e testável de forma independente — contas novas nascem no
provedor

---

## Phase 4: User Story 2 - Usuários existentes migram mantendo a senha (Priority: P1)

**Goal**: migração one-shot idempotente leva contas locais de senha ao realm com hash Argon2
importado e vínculos gravados (FR-004/005/006/007).

**Independent Test**: quickstart passo 2 — dry-run e execução real contra o Keycloak local,
login corporativo com a senha antiga, reexecução sem duplicatas, filtro `--org`.

### Implementation for User Story 2

- [ ] T008 [US2] Criar `apps/api/scripts/migrate_users_to_keycloak.py` conforme
      `contracts/migracao-cli.md`: token via client_credentials
      (`LEARNHOUSE_KC_MIGRATION_CLIENT_ID/SECRET`, research §3), busca por e-mail no realm,
      criação com credencial Argon2 importada (parse do hash PHC → `secretData`/
      `credentialData`, research §2), modo `--reset-passwords` (required action
      UPDATE_PASSWORD + e-mail), gravação de `ExternalIdentity` por org do usuário com
      filtro `--org` repetível, `--dry-run` default / `--execute`, relatório
      criados/vinculados/pulados/falhas em pt-BR, exit codes 0/1/2; hash e segredos nunca
      logados
- [ ] T009 [US2] Testes em `apps/api/src/tests/scripts/test_migrate_users.py` (httpx
      mockado no padrão da suíte): conta nova → criada com credencial; e-mail já existente
      no realm → apenas vinculada; sem senha local → pulada; falha de API em uma conta não
      interrompe as demais; reexecução → idempotente (zero duplicatas); dry-run → zero
      escrita; parse do PHC Argon2 (m/t/p/salt/digest); filtro `--org`;
      `--reset-passwords` → usuário criado sem credencial, com required action
      UPDATE_PASSWORD e disparo de e-mail (FR-007)
- [ ] T010 [US2] Validação prática do import Argon2 no docker local (quickstart passo 2):
      migrar conta de teste, logar via SSO com a senha antiga; registrar o resultado em
      `specs/007-federacao-keycloak/research.md` §2 (import confirmado, ou fallback
      `--reset-passwords` promovido a caminho padrão do rollout — FR-007)

**Checkpoint**: US1 e US2 independentes — estoque de contas federado, senha preservada

---

## Phase 5: User Story 3 - Credenciais federadas se gerenciam no provedor (Priority: P2)

**Goal**: troca local de senha/e-mail recusada para contas federadas à plataforma, com
direcionamento à account console; contas não federadas intocadas (FR-008/010).

**Independent Test**: quickstart passo 3 — 403 `CONTA_FEDERADA` na API para senha/e-mail de
conta federada, UI com aviso + link, conta local de controle inalterada, e-mail alterado no
provedor refletido no login seguinte.

### Implementation for User Story 3

- [ ] T011 [P] [US3] Criar `apps/api/src/services/auth/federation.py`:
      `is_platform_federated(db_session, user_id)` (existe `ExternalIdentity` com issuer ==
      issuer global da plataforma, research §4) e `platform_account_console_url()`
      (`<issuer>/account`)
- [ ] T012 [US3] Em `apps/api/src/services/users/users.py`, aplicar o guard nas duas
      operações: `update_user_password` e `update_user` quando o `email` enviado difere do
      atual → `HTTPException 403` com `{code: "CONTA_FEDERADA", message pt-BR,
      account_console_url}` (contracts/registro-federado.md §3); demais campos do
      `update_user` seguem editáveis
- [ ] T013 [US3] Testes em `apps/api/src/tests/services/test_federated_guards.py`: conta
      federada → senha e e-mail bloqueados com payload do contrato; conta local → fluxo
      atual intocado; identidade de IdP de terceiro (issuer diferente) → NÃO bloqueia
      (FR-010); mudança de nome/bio em conta federada → permitida
- [ ] T014 [P] [US3] Em `apps/web/components/Dashboard/Pages/Users/Security/`, para conta
      federada: ocultar formulários de senha/e-mail (dica de UX; autoridade é o 403 da API),
      exibir aviso e link "central de conta" com `account_console_url`; chaves de tradução
      em `apps/web/locales/pt.json` e `apps/web/locales/en.json` (construir contra o
      contrato §3; validação manual contra a API só após T012)
- [ ] T015 [US3] Validar quickstart passo 3 (API, UI, sync de e-mail no login, conta de
      controle)

**Checkpoint**: as três stories independentes e funcionais

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T016 Rodar a suíte completa da API (`uv run pytest`) e o typecheck do web
      (`bun run typecheck` em `apps/web`) — tudo verde (quickstart passo 4)
- [ ] T017 Executar o quickstart completo ponta a ponta no ambiente docker local e conferir
      SC-001…SC-006 da spec; anotar no quickstart qualquer desvio encontrado

---

## Dependencies & Execution Order

- **T001 (Setup)** → libera todas as stories.
- **US1 (T002→T003→T004; T005/T006 em paralelo entre si e após T003; T007 por último)**.
- **US2 (T008→T009→T010)** — independente de US1/US3.
- **US3 (T011→T012→T013; T014 em paralelo após T011; T015 por último)** — independente de
  US1/US2.
- **Polish (T016→T017)** — após as stories desejadas no incremento.

```text
T001 ──┬── US1: T002 → T003 → T004 ─┬→ T007
       │         └→ T005 [P], T006 [P]
       ├── US2: T008 → T009 → T010
       └── US3: T011 → T012 → T013 ─┬→ T015
                 └→ T014 [P]
US1+US2+US3 → T016 → T017
```

## Parallel Example

Após T001, três frentes simultâneas: `T002` (API US1), `T008` (script US2) e `T011` (helper
US3) não compartilham arquivos. Dentro da US1, `T005` e `T006` (web) rodam em paralelo após
`T003`; dentro da US3, `T014` (web) roda em paralelo a `T012/T013` (API).

## Implementation Strategy

**MVP = US1** (registro federado): entrega o modelo IdP-first para contas novas com o menor
diff — duas mudanças na API, duas no web. **Incremento 2 = US2** (migração): federa o estoque
existente; T010 decide na prática o caminho da senha (import vs contingência). **Incremento
3 = US3** (bloqueios): fecha a porta da divergência. Cada incremento é liberável sozinho; a
ordem P1→P1→P2 da spec é a recomendada, mas US2/US3 podem inverter sem retrabalho.
