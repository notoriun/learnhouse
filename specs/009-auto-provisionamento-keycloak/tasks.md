---

description: "Task list for 009-auto-provisionamento-keycloak"
---

# Tasks: Criação automática de conta no primeiro acesso via Keycloak

**Input**: Design documents from `/specs/009-auto-provisionamento-keycloak/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/api-oidc-provisionamento.md)

**Idioma**: as tarefas são escritas em português (pt-BR), conforme a seção
"Idioma Oficial" da constituição.

**Tests**: SIM. A especificação define critérios verificáveis e o Princípio III da
constituição exige teste para toda mudança de comportamento da API. A matriz
requisito → verificação está em [plan.md](./plan.md#estratégia-de-testes).

**Exceções obrigatórias (Princípio III)** — conferidas para esta feature:

- **Migração Alembic**: NÃO se aplica. Nenhuma tarefa altera modelo SQLModel
  (research.md D4); nenhuma coluna, tabela ou índice muda.
- **Teste na suíte de `apps/api`**: aplica-se. Toda tarefa que altera comportamento
  de endpoint tem tarefa de teste irmã (T007, T008, T009, T018).
- **RBAC com escopo de organização (Princípio IV)**: nenhum endpoint novo. O
  callback altera a forma da resposta, e T008 verifica explicitamente que a
  organização vem do fluxo no servidor e não é influenciável pelo cliente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: a qual história de usuário a tarefa pertence (US1, US2, US3)
- Caminhos de arquivo são exatos e foram apurados na Fase 0

## Path Conventions

Monorepo LearnHouse: `apps/api` (FastAPI + SQLModel), `apps/web` (Next.js),
`apps/e2e` (Playwright), `docs` (Nextra). Nenhum diretório novo é criado.

---

## Phase 1: Setup (ambiente e linha de base)

**Purpose**: ter o ambiente com Keycloak real de pé e comprovar que o defeito
reproduz antes de mexer em código — sem isso não há como afirmar que a mudança
resolveu algo.

- [X] T001 Subir o ambiente local com Keycloak seguindo os passos 1 a 4 de `specs/008-testes-keycloak-local/quickstart.md` (`docker-compose.local.yml`), e confirmar que `curl -s "http://localhost/api/v1/auth/keycloak/status?org=default"` responde `{"enabled":true,"platform":true}` — `platform:true` confirma que o fluxo usa a config global, que é o caminho alterado por esta feature
- [X] T002 [P] Criar no realm `dev` a identidade `novo@example.com` com e-mail verificado e senha `teste123`, conforme `specs/009-auto-provisionamento-keycloak/quickstart.md` §1, e confirmar por consulta ao banco que não existe conta local com esse e-mail
- [X] T003 [P] Registrar a linha de base do defeito (referência: `specs/009-auto-provisionamento-keycloak/quickstart.md` §2): percorrer `http://localhost/login?org=default` → "Entrar com identidade corporativa" com `novo@example.com` e confirmar que hoje o percurso termina em `/login?error=conta_nao_encontrada` (US1 falhando) e que uma identidade já vinculada termina em `/home`, o seletor de organizações (US2 falhando)

**Checkpoint**: ambiente de pé e os dois sintomas do pedido reproduzidos.

---

## Phase 2: Foundational (contrato entre apps e destino pós-acesso)

**Purpose**: o destino "área da organização com menu" é exigido pelas três
histórias (FR-005/FR-006 aparecem em US1, US2 e US3), e o contrato API ↔ BFF que o
viabiliza é compartilhado. Isto precisa estar pronto antes de qualquer história.

**⚠️ CRÍTICO**: nenhuma história pode ser fechada antes desta fase. O contrato de
referência é [contracts/api-oidc-provisionamento.md](./contracts/api-oidc-provisionamento.md).

- [X] T004 [P] Remover o campo `redirect_to` de `AuthorizeRequest` e da chamada a `oidc.create_flow` em `apps/api/src/routers/keycloak_auth.py` (endpoint `POST /authorize`), conforme contrato §1
- [X] T005 [P] Remover `redirect_to` de `create_flow` e da re-sanitização em `consume_flow`, e remover a função `sanitize_redirect`, em `apps/api/src/services/auth/keycloak_oidc.py` — a proteção contra open redirect passa a ser estrutural (não há mais entrada do usuário no destino), conforme research.md D2
- [X] T006 Trocar `redirect_to` por `org_slug` no corpo da resposta 200 de `POST /callback` em `apps/api/src/routers/keycloak_auth.py`, usando o slug da `Organization` já resolvida a partir do fluxo (depende de T004, mesmo arquivo)
- [X] T007 Atualizar `apps/api/src/tests/routers/test_keycloak_auth_router.py`: a resposta 200 do callback traz `org_slug` e NÃO traz `redirect_to`; `POST /authorize` conclui normalmente quando o corpo inclui um `redirect_to` desconhecido (campo ignorado, sem erro) — contrato §1 e §2
- [X] T008 Acrescentar em `apps/api/src/tests/routers/test_keycloak_auth_router.py` a verificação do Princípio IV: o `org_slug` devolvido é o da organização do fluxo criado no `authorize` e não é influenciável por nada que o cliente mande no `callback`; um `state` de outra organização não devolve o slug da organização pedida
- [X] T009 [P] Remover de `apps/api/src/tests/security/test_keycloak_oidc_validation.py` o teste de `sanitize_redirect` (função deixou de existir), preservando intactos todos os demais testes de validação de token e de fluxo do arquivo
- [X] T010 Compor o destino no BFF a partir de `org_slug` em `apps/web/app/api/auth/keycloak/callback/route.ts`: `getUriWithOrg(org_slug, '/')` de `@services/config/config`, resolvido contra `publicOrigin(request)`; manter as guardas de destino (relativo ou host permitido; nunca `/home` nem `/login`) e manter inalterada a gravação dos cookies `LH_access`, `LH_refresh`, `LH_session` e `LH_sso` (depende de T006; contrato §3)
- [X] T011 [P] Remover `&redirect=${encodeURIComponent('/home')}` das duas URLs de autorização em `apps/web/app/auth/login/login.tsx` (botão de entrar, linha ~331, e botão de criar conta, linha ~340) — o destino não vem mais do cliente
- [X] T012 [P] Ajustar `apps/e2e/features/keycloak/api.ts` para não enviar `redirect_to` no corpo de `POST /auth/keycloak/authorize`
- [X] T013 Reescrever `apps/e2e/features/keycloak/tests/us1-redirect-allowlist.spec.ts` para afirmar algo mais forte do que a sanitização atual: um `redirect` externo ou malformado passado à rota de autorização é **ignorado** e o retorno termina na área da organização (depende de T010, T012)

**Checkpoint**: contrato aplicado nas duas pontas; o destino de qualquer acesso
bem-sucedido é a área da organização com menu, independente de entrada do usuário.

---

## Phase 3: User Story 1 - Primeiro acesso cria a conta e entra direto no menu (Priority: P1) 🎯 MVP

**Goal**: uma identidade do provedor da plataforma sem conta prévia passa a ter a
conta criada no retorno da autenticação e cai autenticada na área com menu.

**Independent Test**: com `novo@example.com` (sem conta local), percorrer o login
corporativo e verificar que a conta passou a existir com papel de menor privilégio,
que a sessão está ativa e que a página final é a raiz do host da organização.

### Tests for User Story 1

> Escrever antes da implementação e conferir que falham.

- [X] T014 [US1] Em `apps/api/src/tests/services/test_provisioning.py`, cobrir a criação automática no caminho do provedor da plataforma: identidade nova com e-mail verificado e política sem linha de config de org → `ProvisioningSuccess` com `outcome="provisioned"`, `User` criado, `UserOrganization` na organização do fluxo com `role_id=4`, `ExternalIdentity` com `(issuer, subject)` e evento `SSO_PROVISIONED` registrado (FR-001, FR-002, FR-009, FR-013)
- [X] T015 [US1] Em `apps/api/src/tests/services/test_provisioning.py`, cobrir o fail-closed de IdP de terceiro: com linha `OIDCProviderConfig` de issuer diferente do global e `auto_provision_users=False`, identidade nova → `ProvisioningDenied(reason="auto_provision_desativado")`, nenhuma conta criada (FR-002, SC-008)
- [X] T016 [US1] Em `apps/api/src/tests/services/test_provisioning.py`, reverificar que as guardas continuam recusando **com a criação ligada**: e-mail não verificado → `email_nao_verificado`; domínio fora de `allowed_email_domains` → `dominio_nao_permitido`; em ambos, nenhuma conta, vínculo ou membresia gravada (FR-008, FR-012)
- [X] T017 [US1] Em `apps/api/src/tests/services/test_provisioning.py`, cobrir a colisão de nome de usuário: existe conta local `joao` com outro e-mail e a identidade nova deriva o username `joao` → a conta é criada com sufixo determinístico e o acesso conclui como `provisioned`, sem virar `ProvisioningConflict(dados_inconsistentes)` (research.md D3)
- [X] T018 [P] [US1] Em `apps/api/src/tests/routers/test_keycloak_auth_router.py`, cobrir o endpoint: callback com identidade nova no caminho da config global responde 200 com `org_slug` e tokens, e não mais 403 `CONTA_NAO_ENCONTRADA` (FR-001)

### Implementation for User Story 1

- [X] T019 [P] [US1] Em `apps/api/src/routers/keycloak_auth.py`, trocar a política do caminho de fallback global por `ProvisioningPolicy(auto_provision=True, allow_link_by_email=True)` quando `config_row is None`; manter `get_provisioning_policy` intacto quando existe linha de config de org (data-model.md §2; a linha alterada é a que hoje monta `ProvisioningPolicy(allow_link_by_email=True)`)
- [X] T020 [P] [US1] Em `apps/api/src/services/auth/provisioning.py`, na derivação do username em `_create_and_link`: consultar se o username base está livre antes de chamar `create_user` e, em colisão, tentar sufixos `-1`…`-5` e depois um sufixo curto derivado do `subject`; em falha persistente de `create_user`, uma única nova tentativa com o sufixo derivado do subject antes de cair no conflito `dados_inconsistentes` (research.md D3)

### Verificação de ponta a ponta da US1

- [X] T021 [P] [US1] Criar `apps/e2e/features/keycloak/tests/us1-auto-provision.spec.ts`: identidade nova no provedor, sem conta local → após autenticar, a conta existe, a sessão está ativa e a página final é a área da organização (FR-001, SC-001)
- [X] T022 [P] [US1] Criar `apps/e2e/features/keycloak/tests/us1-destino-menu.spec.ts`: o percurso termina na raiz do host da organização (área com menu), nunca em `/home` nem em `/login`, e o menu de navegação está presente na página final (FR-005, FR-007, SC-002)
- [X] T023 [US1] Registrar as jornadas `us1-auto-provision`, `us1-destino-menu` e a reescrita `us1-redirect-allowlist` em `apps/e2e/features/keycloak/coverage.ts`, cada uma apontando os requisitos que comprova no formato `FR-00X (009)` (depende de T013, T021, T022)

**Checkpoint**: US1 completa. O passo 5 do quickstart da feature 008 ("criar a conta
local antes") deixa de ser necessário — esse é o teste de aceitação mais direto.

---

## Phase 4: User Story 2 - Acessos seguintes reentram na mesma conta e no mesmo menu (Priority: P1)

**Goal**: a mesma identidade corporativa sempre chega à mesma conta, e ao mesmo
destino, sem nunca gerar uma segunda conta.

**Independent Test**: partindo de uma identidade já vinculada, repetir o acesso e
conferir que o `id` da conta de destino é o mesmo, que a contagem de contas não
aumentou e que a página final é a área com menu. Testável sem exercitar a criação.

**Nota de escopo**: o mecanismo de reconhecimento por `(issuer, subject)` já existe
e está correto desde a feature 002 — o que esta história adiciona é o destino
(entregue na Fase 2) e a prova de que a reentrada continua íntegra com a criação
ligada.

- [X] T024 [US2] Em `apps/api/src/tests/services/test_provisioning.py`, cobrir a reentrada: segundo acesso com o mesmo `(issuer, subject)` → `outcome="login"` na mesma conta, `last_login_at` atualizado, contagem de `User` inalterada e evento `LOGIN` com `method=sso`; e a variante com e-mail alterado no provedor → mesma conta, `email_changed` na auditoria, nenhuma conta nova (FR-003, FR-004, FR-013, SC-004)
- [X] T025 [P] [US2] Criar `apps/e2e/features/keycloak/tests/us2-reentrada-mesma-conta.spec.ts`: dois acessos consecutivos da mesma identidade → mesma conta, uma só conta na plataforma, e ambos terminando na área da organização com menu (FR-004, FR-006, SC-004)
- [X] T026 [US2] Registrar a jornada `us2-reentrada-mesma-conta` em `apps/e2e/features/keycloak/coverage.ts` com os requisitos que comprova (depende de T025)

**Checkpoint**: US1 e US2 funcionam de forma independente. Uma conta por identidade,
sempre no mesmo destino.

---

## Phase 5: User Story 3 - Conta local pré-existente é reaproveitada, não duplicada (Priority: P2)

**Goal**: quem já tinha conta na plataforma passa a entrar pela identidade
corporativa sem ganhar uma segunda conta, e chega ao mesmo destino.

**Independent Test**: com conta local existente na organização e identidade
corporativa de mesmo e-mail verificado, executar o acesso e confirmar que a sessão
abre na conta antiga, com seu histórico, sem criação de conta nova.

**Nota de escopo**: o vínculo por e-mail já existe e já é exercitado pela jornada
`us2-identity-link`. O risco que esta história fecha é de **regressão**: com a
criação automática ligada, é preciso garantir que o caminho de vínculo continua
vindo antes do de criação, para que ninguém receba conta duplicada.

- [X] T027 [US3] Em `apps/api/src/tests/services/test_provisioning.py`, cobrir a precedência do vínculo sobre a criação **com `auto_provision=True`**: conta local existente na organização do fluxo com o mesmo e-mail verificado → `outcome="linked"` na conta existente, nenhuma conta nova, evento `SSO_LINKED`; e e-mail coincidente com conta de outra organização → `ProvisioningConflict(email_em_outra_organizacao)`, sem criar nem vincular (FR-010, FR-012)
- [X] T028 [P] [US3] Estender `apps/e2e/features/keycloak/tests/us2-identity-link.spec.ts` para afirmar também o destino: o acesso que vincula termina na área da organização com menu (FR-006)
- [X] T029 [US3] Atualizar a entrada `us2-identity-link` em `apps/e2e/features/keycloak/coverage.ts` acrescentando os requisitos desta feature que a jornada passou a comprovar (depende de T028)

**Checkpoint**: as três histórias funcionam de forma independente.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: a documentação afirma hoje o oposto do novo comportamento — deixá-la
como está transformaria a feature em fonte de confusão para quem monta ambiente.

- [X] T030 [P] Reescrever a seção "Conta local para o vínculo por e-mail" de `docs/content/developers/contributing/keycloak-local.mdx` (o Callout de aviso e o `curl` de criação da conta): a pré-condição deixou de existir para o provedor da plataforma, e a afirmação de que "o auto-provisionamento depende de configuração por organização" passa a estar errada
- [X] T031 [P] Revisar `docs/content/self-hosting/configuration/keycloak.mdx` e `docs/content/platform/users/authentication.mdx` em busca de afirmações de que o acesso corporativo exige conta prévia, e corrigi-las descrevendo a regra nova: criação automática no provedor da plataforma, configuração por organização para IdP de terceiro
- [X] T032 [P] Acrescentar em `specs/008-testes-keycloak-local/quickstart.md` §5 uma nota de que a pré-condição documentada ali foi eliminada pela feature 009, com link para esta spec — sem reescrever o histórico daquele roteiro
- [X] T033 Rodar a suíte de testes de `apps/api` com a flag de cobertura `api` e conferir que nada além dos arquivos alterados nesta feature mudou de resultado; rodar `bun run typecheck` em `apps/e2e`
- [X] T034 Executar `specs/009-auto-provisionamento-keycloak/quickstart.md` de ponta a ponta (passos 1 a 7), incluindo a conferência de auditoria (`SSO_PROVISIONED` no primeiro acesso, `LOGIN` no segundo) e a limpeza do passo 9
- [X] T035 Rodar a suíte e2e completa de Keycloak de `apps/e2e/features/keycloak/` contra o ambiente local (`E2E_BASE_URL=http://localhost bun run test features/keycloak`) e conferir no relatório de `zz-coverage.spec.ts` que nenhuma jornada desta feature ficou declarada e não implementada

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sem dependências — começa imediatamente
- **Foundational (Fase 2)**: depende da Fase 1 (o ambiente é como se verifica) — **BLOQUEIA as três histórias**, porque o destino e o contrato são compartilhados
- **US1 (Fase 3)**: depende da Fase 2
- **US2 (Fase 4)**: depende da Fase 2; independente da US1
- **US3 (Fase 5)**: depende da Fase 2; conceitualmente independente, mas T027 só tem sentido com T019 aplicada (é um teste de regressão *da* criação ligada)
- **Polish (Fase 6)**: depende das histórias que se pretende entregar

### User Story Dependencies

- **US1 (P1)**: pode começar logo após a Fase 2. Nenhuma dependência de outra história
- **US2 (P1)**: pode começar logo após a Fase 2. Verificável sobre identidade já vinculada, sem exercitar criação
- **US3 (P2)**: pode começar logo após a Fase 2, mas seu valor real (não duplicar conta com a criação ligada) exige T019

### Within Each User Story

- Testes primeiro, conferindo que falham, depois implementação
- Na US1: T014–T018 (testes) → T019–T020 (implementação) → T021–T023 (e2e)
- Serviço antes de router quando ambos mudam; aqui T019 (router) e T020 (serviço) são independentes entre si

### Parallel Opportunities

- Fase 1: T002 e T003 em paralelo depois de T001
- Fase 2: T004, T005, T009, T011 e T012 em paralelo; T006 depende de T004 (mesmo arquivo); T010 depende de T006; T013 depende de T010 e T012
- Fase 3: T019 e T020 em paralelo (arquivos diferentes); T021 e T022 em paralelo; T018 em paralelo com T014–T017
- **T014, T015, T016, T017, T024 e T027 editam o MESMO arquivo** (`test_provisioning.py`) e por isso **não** são paralelizáveis entre si — nenhum está marcado `[P]`
- **T023, T026 e T029 editam o MESMO arquivo** (`coverage.ts`) — sequenciais
- Fase 6: T030, T031 e T032 em paralelo; T033–T035 no fim, em ordem

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Primeira onda — arquivos independentes:
Task: "T004 remover redirect_to de AuthorizeRequest em apps/api/src/routers/keycloak_auth.py"
Task: "T005 remover redirect_to e sanitize_redirect em apps/api/src/services/auth/keycloak_oidc.py"
Task: "T009 remover teste de sanitize_redirect em apps/api/src/tests/security/test_keycloak_oidc_validation.py"
Task: "T011 remover redirect=/home em apps/web/app/auth/login/login.tsx"
Task: "T012 remover redirect_to do authorize em apps/e2e/features/keycloak/api.ts"

# Depois, em cadeia: T006 → T010 → T013; e T007/T008 no mesmo arquivo de teste.
```

## Parallel Example: User Story 1

```bash
# Testes (T014–T017 são sequenciais entre si por conflito de arquivo):
Task: "T018 contrato do callback com identidade nova em apps/api/src/tests/routers/test_keycloak_auth_router.py"

# Implementação — arquivos diferentes, em paralelo:
Task: "T019 política do fallback global em apps/api/src/routers/keycloak_auth.py"
Task: "T020 username livre com sufixo em apps/api/src/services/auth/provisioning.py"

# Jornadas e2e — arquivos novos, em paralelo:
Task: "T021 us1-auto-provision.spec.ts"
Task: "T022 us1-destino-menu.spec.ts"
```

---

## Implementation Strategy

### MVP First (US1 apenas)

1. Fase 1: Setup — ambiente de pé e defeito reproduzido
2. Fase 2: Foundational — contrato e destino (bloqueia tudo)
3. Fase 3: US1 — criação automática e destino no primeiro acesso
4. **PARAR e VALIDAR**: percorrer o quickstart §2 e §3 com uma identidade nova
5. Neste ponto o pedido central já está entregue e demonstrável

### Incremental Delivery

1. Setup + Foundational → o destino já está correto para quem hoje consegue entrar
   (US2 e US3 ganham o menu antes de qualquer mudança de política)
2. + US1 → primeiro acesso cria conta (MVP)
3. + US2 → reentrada comprovada, sem duplicata
4. + US3 → precedência do vínculo comprovada com a criação ligada
5. + Polish → documentação alinhada ao comportamento novo

A ordem acima tem uma propriedade útil: a Fase 2 sozinha já é um incremento
entregável e de baixo risco — corrige o destino sem alterar quem pode entrar.

### Parallel Team Strategy

Com duas pessoas, depois da Fase 2:

- Pessoa A: US1 (política, colisão de username, jornadas novas) — o caminho crítico
- Pessoa B: US2 e US3 (testes de reentrada e de precedência do vínculo) + Fase 6 de
  documentação

Coordenação necessária em dois arquivos: `test_provisioning.py` e `coverage.ts`,
onde as duas pessoas escrevem. Combinar a ordem ou dividir por commit.

---

## Notes

- `[P]` = arquivos diferentes, sem dependência pendente
- Nenhuma migração Alembic nesta feature: nada de schema muda (research.md D4)
- Conferir que cada teste falha antes de implementar — em especial T014 e T018, que
  hoje devem falhar com recusa `auto_provision_desativado` / 403
- A remoção de `sanitize_redirect` (T005, T009) vai chamar atenção em revisão; a
  justificativa está em research.md D2 e a jornada reescrita em T013 afirma algo
  mais forte do que a função removida garantia
- Commit por tarefa ou por grupo lógico; parar em qualquer checkpoint para validar
