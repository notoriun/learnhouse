# Tasks: Logout Coordenado e Revogação de Sessão

**Input**: Documentos de design em `specs/003-logout-revogacao/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/logout.md, quickstart.md

**Tests**: INCLUÍDOS — o Princípio III da constituição exige que mudanças de comportamento da
API cheguem com testes (flag de cobertura `api`), e o Princípio IV trata revogação como caminho
de segurança. Em cada story, os testes vêm PRIMEIRO e devem falhar antes da implementação.

**Organization**: Tarefas agrupadas por user story para permitir implementação e teste
independentes de cada uma.

**Dependência externa registrada**: esta feature consome as features
`001-fundacao-oidc-keycloak` e `002-identidade-provisionamento` (login federado operante,
`apps/api/src/routers/keycloak_auth.py` e `apps/api/src/services/auth/keycloak_oidc.py`
criados, JWKS/discovery cacheados, identidade externa persistida). O contrato de fronteira
001/002 → 003 está em `contracts/logout.md` (seção "Contrato entre features").

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: user story da tarefa (US1, US2, US3) — apenas nas fases de story
- Caminho de arquivo exato em toda descrição

## Path Conventions

Monorepo web app: backend em `apps/api` (FastAPI, SQLModel, Alembic, pytest em
`apps/api/src/tests/security/`); BFF/frontend em `apps/web` (Next.js App Router, rotas em
`apps/web/app/api/auth/*`). Nenhum diretório novo de topo (plan.md, Structure Decision).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verificar pré-requisitos das features 001/002 e preparar o ambiente de validação.

- [X] T001 (features 001/002 presentes nesta branch empilhada) Verificar o pré-requisito das features 001/002: existência e operação de `apps/api/src/routers/keycloak_auth.py` e `apps/api/src/services/auth/keycloak_oidc.py` (login federado emitindo sessão interna, JWKS/discovery cacheados); se ausentes, esta feature fica BLOQUEADA — registrar o bloqueio no PR
- [X] T002 [P] Rodar a baseline verde das suítes de regressão que esta feature toca: `apps/api/src/tests/security/test_session_revocation.py`, `apps/api/src/tests/security/test_refresh_grace.py`, `apps/api/src/tests/security/test_remediation_auth_refresh.py`, `apps/api/src/tests/security/test_csrf.py` (`uv run pytest`)
- [ ] T003 (PENDENTE — config do Keycloak dev com Backchannel Logout URL; validação manual) [P] Configurar o Keycloak de desenvolvimento conforme `specs/003-logout-revogacao/quickstart.md`: client confidencial com Backchannel Logout URL apontando para `POST {API}/api/v1/auth/keycloak/backchannel-logout` e `post_logout_redirect_uri` cadastrada

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Entidade Sessão Upstream (tabela + migração Alembic — Princípio III), serviço de
vínculo com cifragem Fernet e claim `usid` estampado no login federado. Nada de story pode
começar antes desta fase.

**⚠️ CRITICAL**: Nenhuma tarefa de user story pode começar antes do fim desta fase.

- [X] T004 Criar o modelo SQLModel `UpstreamSession` em `apps/api/src/db/upstream_sessions.py` com os campos, estados (`active`/`revoked`/`expired`), `revocation_reason` (`user_logout`/`backchannel`/`upstream_denied`/`policy_ttl`/`admin`) e índices (`uq_upstream_session_uuid` UNIQUE, `ix_upstream_session_issuer_sid`, `ix_upstream_session_user_status`) definidos em `specs/003-logout-revogacao/data-model.md`
- [X] T005 Criar a migração Alembic `apps/api/migrations/versions/xxxx_add_upstream_session.py` no MESMO PR do modelo (Princípio III), com `upgrade`/`downgrade` limpos (validação: `uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head`)
- [X] T006 [P] Adicionar o tipo de evento `SESSION_REVOKED` (`session_revoked`) a `UserAuditEventType` em `apps/api/src/db/user_audit_events.py`
- [X] T007 [P] Adicionar o claim `USID_CLAIM` (`"usid"`) em `apps/api/src/security/session_context.py` e estender `carry_session_claims` para carregar `usid` junto de `amr`/`sorg` através das rotações
- [X] T008 Criar o serviço `apps/api/src/services/auth/upstream_session.py`: criar/consultar/revogar o vínculo upstream; helpers de cifragem/decifragem Fernet (`cryptography` já instalada, chave fora do banco via env var — mesma abordagem do `client_secret` da feature 004, research R2); invariante de escrita: toda transição terminal grava `upstream_revoked:{usid}` no Redis (TTL = `JWT_REFRESH_TOKEN_EXPIRES`), preenche `revoked_at`/`revocation_reason` e anula `upstream_refresh_encrypted`/`id_token_encrypted`; consultas sempre filtradas por `issuer` + `sid` e por `user_id` nos caminhos autenticados (Princípio IV)
- [X] T009 Integrar a fronteira 001/002 → 003 no login federado em `apps/api/src/routers/keycloak_auth.py`: ao emitir a sessão interna, criar a linha `upstream_session` (`issuer`, `sid` do ID token, refresh upstream e ID token cifrados via serviço) e estampar o claim `usid` nos tokens locais; sessões anteriores sem `usid` seguem tratadas como nativas (`contracts/logout.md`, seção "Contrato entre features")

**Checkpoint**: Fundação pronta — login federado cria `upstream_session` e estampa `usid`; as user stories podem começar.

---

## Phase 3: User Story 1 - Sair encerra a sessão por completo (Priority: P1) 🎯 MVP

**Goal**: O logout de sessão federada revoga a sessão local, invalida o refresh interno, limpa
os cookies nas duas variantes (host-only e domain-scoped) e conduz o navegador ao
`end_session_endpoint` do Keycloak (RP-Initiated Logout); o logout nativo permanece inalterado
(FR-001, FR-002, FR-003, FR-010).

**Independent Test**: Com um usuário autenticado via SSO: sair → acessar página autenticada
(deve exigir login) → iniciar novo login corporativo (o Keycloak deve pedir credenciais, sem
SSO silencioso). Cenários 1 e 5 do `specs/003-logout-revogacao/quickstart.md` (SC-001, SC-003).

### Tests for User Story 1 ⚠️ escrever PRIMEIRO, garantir que FALHAM antes da implementação

- [X] T010 [P] [US1] Criar `apps/api/src/tests/security/test_rp_logout.py`: `POST /api/v1/auth/keycloak/logout` revoga na ordem FR-001 (blocklist `revoke_user_sessions_before` → `upstream_session` marcada `revoked` motivo `user_logout` → chave Redis `upstream_revoked:{usid}` → campos cifrados anulados); resposta 200 com `end_session_url` contendo `id_token_hint` e a `post_logout_redirect_uri` CADASTRADA (nunca derivada de entrada do usuário); sessão nativa ou expirada → 200 com `end_session_url: null`; fallback `client_id` quando não há ID token armazenado; auditoria `logout` com `{"method": "rp_initiated"}` sem tokens; `Cache-Control: no-store`
- [ ] T011 (PENDENTE — teste bun do BFF; não rodável nesta máquina sem node_modules; rota implementada em T014) [P] [US1] Criar teste do BFF (`bun test`) em `apps/web/app/api/auth/keycloak/logout/route.test.ts`: a rota limpa TODAS as variantes de cookies de sessão (host-only e `.{top_domain}`: `LH_access`, `LH_refresh`, `LH_custom_domain`, `LH_session`, `LH_org`) mesmo quando a API falha ou a sessão já expirou; 302 para `end_session_url` quando presente, senão 302 para destino interno sanitizado; nenhuma resposta contém tokens (SC-003)

### Implementation for User Story 1

- [X] T012 [US1] Implementar `POST /auth/keycloak/logout` em `apps/api/src/routers/keycloak_auth.py` conforme `contracts/logout.md` §2.1: autenticação por cookies ou bearer com 200 mesmo sem sessão válida (logout sempre concluível); revogação ANTES de qualquer redirecionamento (FR-001) via `revoke_user_sessions_before` + serviço `upstream_session` (motivo `user_logout`); montagem da URL de RP-Initiated Logout com `end_session_endpoint` do discovery, `id_token_hint` decifrado, `post_logout_redirect_uri` cadastrada e `client_id`; auditoria `logout` via `record_audit_event`; `Cache-Control: no-store`
- [X] T013 [US1] Extrair/reexportar o helper `appendClearAuthCookies` em `apps/web/app/api/auth/[...path]/route.ts` para reuso pela rota federada — mudança mínima, sem alterar o comportamento do logout nativo (FR-010)
- [X] T014 [US1] Criar a rota BFF `apps/web/app/api/auth/keycloak/logout/route.ts` (GET, navegação top-level) conforme `contracts/logout.md` §1.2: encaminhar `POST {API}/api/v1/auth/keycloak/logout` com cookies e headers de identidade (`x-forwarded-for`, `x-real-ip`, `user-agent`, timeout curto); SEMPRE limpar cookies nas duas variantes via `appendClearAuthCookies` (mesmo com falha da API); 302 para `end_session_url` ou destino interno sanitizado (`redirect` seguro ou `/`); `Cache-Control: no-store`; nenhum token na resposta
- [X] T015 [US1] Alterar `signOut` em `apps/web/components/Contexts/AuthContext.tsx`: sessão SSO → `window.location.href = '/api/auth/keycloak/logout'` (navegação, não fetch — research R7); sessões nativas (password, google, magic_login) mantêm o caminho atual intacto (FR-010)

**Checkpoint**: US1 completa e testável de forma independente — validar cenários 1 e 5 do quickstart.

---

## Phase 4: User Story 2 - Revogação corporativa encerra o acesso (Priority: P1)

**Goal**: A desativação/revogação de um usuário no provedor encerra as sessões locais dentro do
SLA: imediatamente via back-channel logout (token validado criptograficamente, revogação
idempotente por `sid`/`sub`) e, como garantia mínima, na próxima renovação (refresh federado
valida o upstream ANTES de rotacionar; `invalid_grant` → encerramento definitivo) — FR-004,
FR-005, FR-006 (parte definitiva), FR-008.

**Independent Test**: Desativar um usuário de teste no Keycloak e medir o encerramento das
sessões: com back-channel habilitado → imediato; com back-channel desabilitado → até a próxima
renovação. Cenários 2 e 3 do `specs/003-logout-revogacao/quickstart.md` (SC-002, SC-005).

### Tests for User Story 2 ⚠️ escrever PRIMEIRO, garantir que FALHAM antes da implementação

- [X] T016 [P] [US2] Criar `apps/api/src/tests/security/test_backchannel_logout.py`: logout token válido revoga as `upstream_session` ativas por `(issuer, sid)` (e por `sub` quando não há `sid`), grava `upstream_revoked:{usid}`, audita `session_revoked` com `origin=backchannel`; idempotência: sessão desconhecida, já revogada ou mesmo `jti` reprocessado → 200 sem novo efeito (outcomes `unknown_session`/`already_revoked`/`replayed`); testes NEGATIVOS (SC-005 — efeito zero em 100%): assinatura inválida, `iss` não cadastrado, `aud` sem o `client_id`, claim `events` ausente, `nonce` presente, `iat` fora da janela, sem `sid` e sem `sub` → 400 com corpo vazio e ZERO efeito sobre sessões
- [X] T017 [P] [US2] Criar `apps/api/src/tests/security/test_upstream_refresh.py` (parte US2): ordem upstream-primeiro no `GET /auth/refresh` (nenhuma rotação local antes do sucesso upstream — FR-005); token com `usid` presente em `upstream_revoked:{usid}` → 401 (outcome `upstream_revoked`); `invalid_grant` do token endpoint → 401, linha `revoked` motivo `upstream_denied`, chave Redis gravada, auditoria `session_revoked`; `get_current_user` rejeita access token com `usid` revogado; sessões nativas (sem `usid`) mantêm contrato e latência inalterados

### Implementation for User Story 2

- [X] T018 [US2] Implementar a validação do logout token em `apps/api/src/services/auth/keycloak_oidc.py` (research R3): assinatura via JWKS cacheado com refetch em `kid` desconhecido; `iss` cadastrado e ativo; `aud` contém o `client_id`; `iat` recente com clock skew e `exp` quando presente; `events` contém `http://schemas.openid.net/event/backchannel-logout`; ao menos um entre `sid`/`sub`; `nonce` AUSENTE (presença → rejeição); nenhum atalho de dev/teste desabilita a validação (Princípio IV)
- [X] T019 [US2] Implementar `POST /auth/keycloak/backchannel-logout` em `apps/api/src/routers/keycloak_auth.py` conforme `contracts/logout.md` §2.2: corpo `application/x-www-form-urlencoded` com `logout_token`; validação integral (T018) → revogação idempotente via serviço `upstream_session` por `(issuer, sid)` ou por `sub`; telemetria de replay `backchannel_jti:{jti}` (SET NX, TTL 10 min, não bloqueia); auditoria `session_revoked` (`origin: "backchannel"`, `sessions_affected: n`); respostas 200 (revogado ou no-op) e 400 (inválido, corpo vazio sem detalhe); `Cache-Control: no-store`; rate limit defensivo
- [X] T020 [US2] Implementar o refresh upstream em `apps/api/src/services/auth/keycloak_oidc.py`: chamada `grant_type=refresh_token` ao token endpoint com o refresh upstream decifrado e timeout de 5 s (`httpx`); classificação da resposta conforme research R5 (`invalid_grant` = rejeição DEFINITIVA; timeout/conexão/5xx/429/`invalid_client`/200 malformada = TRANSITÓRIA); definitiva NUNCA reclassificada como transitória (Princípio IV)
- [X] T021 [US2] Adicionar o ramo federado no `GET /auth/refresh` em `apps/api/src/routers/auth.py` (research R4, ordem exata): após o blocklist existente, checar `upstream_revoked:{usid}` → 401; após o gate NX de `jti` (SOMENTE o vencedor — abas concorrentes seguem a grace window sem chamada upstream), carregar a `upstream_session` por `usid`, validar `status=active` e chamar o refresh upstream (T020); sucesso → persistir o refresh upstream rotacionado (cifrado) + `last_refreshed_at` e seguir a rotação local com `usid` carregado por `carry_session_claims`; `invalid_grant` → marcar `revoked` motivo `upstream_denied`, gravar chave Redis, auditar e responder 401 (outcome `upstream_denied`)
- [X] T022 [P] [US2] Rejeitar em `get_current_user` (`apps/api/src/security/auth.py`) tokens cujo claim `usid` esteja presente em `upstream_revoked:{usid}` — espelho do padrão `jwt_revoked_before:*` existente, checagem só quando o claim existe (custo zero para sessões nativas)

**Checkpoint**: US1 e US2 funcionam de forma independente — validar cenários 2 e 3 do quickstart (SLA imediato e garantia por renovação).

---

## Phase 5: User Story 3 - Falha transitória não derruba o usuário (Priority: P2)

**Goal**: A renovação federada distingue falha transitória (503 `UPSTREAM_UNAVAILABLE`, consumo
do `jti` desfeito, nada rotacionado, sessão preservada) de rejeição definitiva (401), com TTL
máximo absoluto por política como teto — FR-006 (parte transitória), FR-007.

**Independent Test**: Simular indisponibilidade do provedor durante renovações: sessões ativas
sobrevivem (≥95% em 10 min — SC-004), rejeições definitivas ainda encerram 100%, e o TTL
absoluto expira a sessão em indisponibilidade prolongada. Cenário 4 do
`specs/003-logout-revogacao/quickstart.md`.

### Tests for User Story 3 ⚠️ escrever PRIMEIRO, garantir que FALHAM antes da implementação

- [X] T023 [US3] Estender `apps/api/src/tests/security/test_upstream_refresh.py` (parte US3): timeout, erro de conexão, 5xx, 429, `invalid_client` e 200 malformada → 503 com código `UPSTREAM_UNAVAILABLE` (outcome `upstream_transient`), consumo do `jti` desfeito (`refresh_used:{user_id}:{jti}` removido), NENHUM artefato rotacionado, linha permanece `active` e o MESMO refresh cookie funciona na tentativa seguinte; invariante FR-006: definitiva nunca vira 503 e transitória nunca vira 401; TTL máximo excedido (`created_at` + `LEARNHOUSE_OIDC_SESSION_MAX_HOURS` reduzido no teste) → linha `expired` motivo `policy_ttl`, chave Redis, 401 — inclusive durante indisponibilidade (falha transitória não estende o limite); concorrência: perdedores do gate NX recebem o par da grace window sem chamada upstream duplicada

### Implementation for User Story 3

- [X] T024 [US3] Implementar o tratamento transitório no ramo federado do `GET /auth/refresh` em `apps/api/src/routers/auth.py` (research R4 passo 4): em classificação transitória, desfazer o consumo do `jti` (DELETE `refresh_used:{user_id}:{jti}`), não rotacionar nada (nem local nem upstream), responder 503 com código `UPSTREAM_UNAVAILABLE` e outcome `upstream_transient`; nenhum estado muda (linha `active`, cookies intactos — o BFF já preserva sessão em status ≠ 401/403, sem mudança no cliente)
- [X] T025 [US3] Aplicar o TTL máximo absoluto (research R6) no passo do vencedor em `apps/api/src/routers/auth.py` com helper em `apps/api/src/services/auth/upstream_session.py`: verificar `created_at` + limite ANTES da chamada upstream (`LEARNHOUSE_OIDC_SESSION_MAX_HOURS`, padrão 24 h; config por organização quando a feature 004 existir); excedido → marcar `expired` motivo `policy_ttl`, gravar `upstream_revoked:{usid}`, auditar `session_revoked` (`origin: "policy_ttl"`) e responder 401 (outcome `ttl_exceeded`)

**Checkpoint**: As três user stories funcionam de forma independente — validar cenário 4 do quickstart (SC-004).

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Observabilidade consolidada, runbook operacional e validação completa do quickstart.

- [X] T026 [P] Consolidar a telemetria de outcomes fechados (padrão `_log_refresh_outcome`, data-model.md seção Observabilidade): logger `learnhouse.auth.upstream` (`upstream_ok`, `upstream_transient`, `upstream_denied`, `upstream_revoked`, `ttl_exceeded`) em `apps/api/src/routers/auth.py` e logger `learnhouse.auth.backchannel` (`accepted`, `unknown_session`, `already_revoked`, `replayed`, `rejected_signature`, `rejected_claims`) em `apps/api/src/routers/keycloak_auth.py`; exatamente UM outcome estruturado por tentativa, sem tokens/segredos (FR-008, FR-009)
- [X] T027 [P] Escrever o runbook operacional em `specs/003-logout-revogacao/runbook.md`: procedimento para indisponibilidade do provedor (leitura de `upstream_transient` sustentado, impacto esperado, TTL como teto) e para rotação da chave Fernet/segredo do client (`invalid_client` classificado como transitório — alertar operação, não derrubar usuários); alertas do documento-base §16 (aumento de `upstream_denied`, taxa de `rejected_*`)
- [X] T028 [P] Rodar a regressão dos caminhos tocados em `apps/api/src/tests/security/`: `test_session_revocation.py`, `test_refresh_grace.py`, `test_remediation_auth_refresh.py`, `test_csrf.py` — comparar com a baseline de T002 (FR-010: logout nativo sem regressão)
- [X] T029 Validar a migração em `apps/api`: `uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head` (aplicação e reversão limpas — Princípio III)
- [ ] T030 (PENDENTE — validação manual completa do quickstart em dev) Executar a validação completa de `specs/003-logout-revogacao/quickstart.md` (cenários 1–5: SC-001 a SC-005) em ambiente `npx learnhouse dev` com o Keycloak de desenvolvimento (T003), incluindo a inspeção automatizada de cookies nas duas variantes (SC-003) e a auditoria de que nenhum token do provedor aparece em corpo JSON acessível ao JavaScript

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências internas; T001 é um GATE — sem as features 001/002 entregues, as Phases 2+ ficam bloqueadas
- **Foundational (Phase 2)**: depende da Phase 1; BLOQUEIA todas as user stories. Ordem interna: T004 → T005; T008 depende de T004; T009 depende de T007 + T008; T006 e T007 são paralelas entre si e às demais
- **US1 (Phase 3)**: depende da Phase 2; independente de US2/US3
- **US2 (Phase 4)**: depende da Phase 2; independente de US1. Ordem interna: T016/T017 (testes) → T018 → T019; T020 → T021; T022 paralela (só depende da Phase 2)
- **US3 (Phase 5)**: depende da Phase 2 e **estende o ramo federado criado em US2 (T020/T021)** — dependência entre stories registrada: US3 é sequencial após US2 nos arquivos `apps/api/src/routers/auth.py` e `apps/api/src/tests/security/test_upstream_refresh.py`
- **Polish (Phase 6)**: depende de todas as stories desejadas; T026–T028 paralelas; T029 → T030 por último

### User Story Dependencies

- **US1 (P1)**: após Phase 2 — nenhuma dependência de outra story
- **US2 (P1)**: após Phase 2 — nenhuma dependência de US1 (arquivos disjuntos no backend; o endpoint de logout RP e o back-channel vivem no mesmo `keycloak_auth.py`, mas em rotas independentes — coordenar merge se em paralelo)
- **US3 (P2)**: após US2 (mesmos arquivos de refresh e mesma suíte de teste)

### Within Each User Story

- Testes PRIMEIRO (devem falhar) → serviços → endpoints → integração BFF/frontend
- Modelo antes de serviço; serviço antes de endpoint
- Story completa (checkpoint validado) antes de seguir para a próxima prioridade

---

## Parallel Example: User Story 1

```bash
# Após a Phase 2, lançar os testes da US1 em paralelo (arquivos diferentes):
Task: "T010 [US1] Criar apps/api/src/tests/security/test_rp_logout.py"
Task: "T011 [US1] Criar apps/web/app/api/auth/keycloak/logout/route.test.ts"

# Em times com duas pessoas, US1 e US2 em paralelo após a Phase 2:
Dev A: T010–T015 (US1 — logout RP + BFF + AuthContext)
Dev B: T016–T022 (US2 — back-channel + refresh upstream-primeiro)

# Dentro da US2, também em paralelo:
Task: "T016 [US2] apps/api/src/tests/security/test_backchannel_logout.py"
Task: "T017 [US2] apps/api/src/tests/security/test_upstream_refresh.py"
Task: "T022 [US2] get_current_user em apps/api/src/security/auth.py"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup (T001 confirma as features 001/002 — gate externo)
2. Phase 2: Foundational (T004–T009 — tabela + migração + serviço Fernet + claim `usid`)
3. Phase 3: US1 (T010–T015)
4. **PARAR e VALIDAR**: cenários 1 e 5 do quickstart (SC-001, SC-003) de forma independente
5. Deploy/demo: logout completo com SSO encerrado já entrega o requisito central da feature

### Incremental Delivery

1. Setup + Foundational → fundação pronta (login federado cria `upstream_session` + `usid`)
2. US1 → testar → deploy/demo (**MVP**: logout completo em computador compartilhado)
3. US2 → testar → deploy/demo (revogação corporativa: back-channel + garantia por renovação — fecha o risco "sessão local sobrevive à revogação upstream")
4. US3 → testar → deploy/demo (resiliência: indisponibilidade do Keycloak não derruba usuários)
5. Polish → observabilidade consolidada, runbook, quickstart completo (SC-001 a SC-005)

### Parallel Team Strategy

Com dois desenvolvedores, após a Phase 2:

1. Dev A: US1 (T010–T015 — API logout RP + BFF + frontend)
2. Dev B: US2 (T016–T022 — back-channel + refresh upstream-primeiro)
3. US3 (T023–T025) entra após US2 (mesmos arquivos); Polish fecha em conjunto

---

## Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta
- Revogação é caminho de segurança (Princípio IV): nenhum teste ou atalho de dev desabilita a validação criptográfica do logout token; rejeição definitiva nunca é reclassificada como transitória
- Migração Alembic (T005) DEVE chegar no mesmo PR do modelo (T004) — Princípio III
- Nenhuma dependência nova (Princípio V): Fernet, httpx, Redis e padrões de rotação/blocklist já existem
- Commit após cada tarefa ou grupo lógico; validar cada checkpoint antes de avançar
