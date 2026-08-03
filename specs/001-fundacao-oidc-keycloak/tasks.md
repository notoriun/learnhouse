# Tasks: Login Corporativo via Keycloak (Fundação OIDC)

**Input**: Documentos de design em `/specs/001-fundacao-oidc-keycloak/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-oidc.md, quickstart.md

**Tests**: INCLUÍDOS — o Princípio III da constituição exige testes para mudanças de comportamento
da API, e o SC-002 exige testes negativos automatizados por claim. Testes são escritos ANTES da
implementação e devem falhar primeiro.

**Organization**: Tarefas agrupadas por user story para permitir implementação e teste
independentes de cada história.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: User story da tarefa (US1, US2, US3) — apenas nas fases de story
- Todo task inclui o caminho exato do arquivo

## Path Conventions

Monorepo web app (plan.md): backend em `apps/api/` (FastAPI), frontend em `apps/web/` (Next.js
App Router). Testes da API em `apps/api/src/tests/routers/` e `apps/api/src/tests/security/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Preparar configuração e ambiente de desenvolvimento — nenhuma dependência nova
(Princípio V: httpx, PyJWT[crypto] e redis já instalados)

- [X] T001 Adicionar bloco de defaults `keycloak` (enabled=false, issuer="", client_id="", client_secret="", clock_skew=30) em apps/api/config/config.yaml, mapeado para as variáveis `LEARNHOUSE_KEYCLOAK_ENABLED`, `LEARNHOUSE_KEYCLOAK_ISSUER`, `LEARNHOUSE_KEYCLOAK_CLIENT_ID`, `LEARNHOUSE_KEYCLOAK_CLIENT_SECRET`, `LEARNHOUSE_KEYCLOAK_CLOCK_SKEW` (contracts/api-oidc.md §3)
- [ ] T002 [P] Provisionar Keycloak de desenvolvimento conforme quickstart.md §1: container `kc-dev`, realm `plataforma`, client confidencial `learnhouse-web` com Standard flow ON, Implicit OFF, PKCE S256 obrigatório, redirect URI exata `http://localhost:3000/api/auth/keycloak/callback`, usuário de teste com e-mail verificado igual ao usuário local (ex.: `aluno@acme.dev`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Config tipada, serviço OIDC base (discovery/JWKS), armazenamento do fluxo no Redis e
registro do router — nada de user story antes disso

**⚠️ CRITICAL**: Nenhuma tarefa de user story pode começar antes desta fase terminar

- [X] T003 [P] Criar bloco `KeycloakConfig` em apps/api/config/config.py (campos: enabled, issuer, client_id, client_secret, clock_skew) lido das envs `LEARNHOUSE_KEYCLOAK_*`; issuer HTTPS obrigatório fora de dev; `client_secret` nunca serializado em resposta/log (research.md §7)
- [X] T004 Criar apps/api/src/services/auth/keycloak_oidc.py com a base de metadados do provedor: discovery via httpx `GET {issuer}/.well-known/openid-configuration` com timeout de 5 s e cache em memória de processo com TTL de 1 h; JWKS via `jwt.PyJWKClient` singleton por issuer com `cache_keys=True` (rebusca automática em `kid` desconhecido cobre rotação de chaves — FR-006, research.md §3)
- [X] T005 Implementar o flow state (AuthFlowState do data-model.md) em apps/api/src/services/auth/keycloak_oidc.py: `create_flow(org_slug, redirect_to)` gera `state` e `nonce` com `secrets.token_urlsafe(32)` e `code_verifier` PKCE (43–128 chars, RFC 7636), grava `oidc_flow:{state}` como JSON `{nonce, code_verifier, org_slug, redirect_to, created_at}` com `SET ... EX 600` via `get_redis_client()` (apps/api/src/core/redis.py); `consume_flow(state)` usa **GETDEL para uso único atômico**; sem Redis → fail closed (padrão de `magic_login._burn_jti`, research.md §2)
- [X] T006 Implementar `sanitize_redirect(path)` em apps/api/src/services/auth/keycloak_oidc.py: aceita somente caminho relativo interno iniciado por `/`, rejeita `//host`, esquemas (`https:`, `javascript:`) e host; valor inválido vira `/` sem erro (FR-008, edge case open redirect)
- [X] T007 [P] Criar o esqueleto do router apps/api/src/routers/keycloak_auth.py (APIRouter) e registrá-lo em apps/api/src/router.py com `include_router(..., prefix="/auth/keycloak")` — endpoints implementados nas fases de story

**Checkpoint**: Fundação pronta — as user stories podem começar

---

## Phase 3: User Story 1 - Login com identidade corporativa (Priority: P1) 🎯 MVP

**Goal**: Fluxo OIDC Authorization Code + PKCE completo — botão na tela de login, redirect ao
Keycloak, callback server-side, validação do ID token e emissão da sessão interna existente

**Independent Test**: Com realm de dev e usuário de teste (quickstart.md §3.1): iniciar o login na
página da org, autenticar no Keycloak e verificar sessão interna criada e página de destino
carregada em < 15 s (SC-001)

### Tests for User Story 1 (escrever PRIMEIRO — devem FALHAR antes da implementação) ⚠️

- [X] T008 [P] [US1] Criar apps/api/src/tests/security/test_keycloak_oidc_validation.py com fixture de par de chaves RSA (`cryptography`, já instalada) e teste do caminho feliz: ID token assinado com iss/aud/azp/exp/nbf/iat/nonce/email_verified corretos é aceito por `validate_id_token` (research.md §8)
- [X] T009 [P] [US1] Criar apps/api/src/tests/routers/test_keycloak_auth_router.py no padrão de test_auth_router.py (app mínimo com `include_router(..., prefix="/api/v1/auth/keycloak")`, monkeypatch das funções httpx do serviço e fake Redis em memória via patch de `get_redis_client`): GET /status → `{"enabled": true|false}` conforme config + política da org; POST /authorize → `authorization_url` com `response_type=code`, `code_challenge_method=S256`, `state`, `nonce`, `scope=openid email profile`; POST /callback fluxo feliz → 200 com `user`, `tokens` internos e `redirect_to`, state consumido do Redis

### Implementation for User Story 1

- [X] T010 [US1] Implementar `exchange_code(code, code_verifier)` em apps/api/src/services/auth/keycloak_oidc.py: POST httpx ao `token_endpoint` do discovery com client confidencial (`client_id`/`client_secret`) e `code_verifier`; recusa do provedor (`invalid_grant` etc.) → erro mapeável a 401 `CODIGO_RECUSADO`; indisponibilidade → erro mapeável a 503 `SSO_INDISPONIVEL`
- [X] T011 [US1] Implementar `validate_id_token(id_token, nonce)` em apps/api/src/services/auth/keycloak_oidc.py: assinatura via PyJWKClient (rebusca em `kid` desconhecido), `jwt.decode` validando `iss`, `aud`, `exp`/`nbf`/`iat` com `leeway=clock_skew` (default 30 s, research.md §5); verificação manual de `azp` (quando múltiplas audiences) e `nonce` idêntico ao do fluxo; retorno dos claims (`email`, `email_verified`) — qualquer falha rejeita (FR-005)
- [X] T012 [US1] Implementar GET /api/v1/auth/keycloak/status em apps/api/src/routers/keycloak_auth.py: `enabled` = config presente e ativa **e** método `sso` permitido na política da org (`is_login_method_allowed`, apps/api/src/services/orgs/auth_policy.py); org desconhecida → `{"enabled": false}` sem enumeração de orgs (FR-001, contracts/api-oidc.md §2)
- [X] T013 [US1] Implementar POST /api/v1/auth/keycloak/authorize em apps/api/src/routers/keycloak_auth.py: valida org/config (404 `SSO_NAO_CONFIGURADO`), sanitiza `redirect_to` com `sanitize_redirect`, cria o fluxo no Redis (`create_flow`) e monta a `authorization_url` (authorization_endpoint do discovery + `response_type=code`, `client_id`, `redirect_uri` exata, `scope=openid email profile`, `state`, `nonce`, `code_challenge` S256); discovery/Redis indisponível → 503 `SSO_INDISPONIVEL` fail closed
- [X] T014 [US1] Implementar POST /api/v1/auth/keycloak/callback em apps/api/src/routers/keycloak_auth.py na ordem obrigatória do contrato: (1) `consume_flow` GETDEL → 410 `FLUXO_INVALIDO`; (2) `exchange_code` → 401 `CODIGO_RECUSADO`; (3) `validate_id_token` → 401 `TOKEN_INVALIDO`; (4) resolução interina do usuário: `User` existente por `email` **somente com `email_verified=true`** → 403 `CONTA_NAO_ENCONTRADA` (research.md §6, sem auto-provisionamento); (5) `enforce_login_auth_method(db_session, org_id, AUTH_METHOD_SSO)` (apps/api/src/services/orgs/auth_policy.py) → 403 `METODO_NAO_PERMITIDO`; (6) reusar `mint_session_tokens(user.email, amr=AUTH_METHOD_SSO, org_id=org_id)` (apps/api/src/services/auth/session.py — sem desafio de MFA local, MFA é do Keycloak) + `record_audit_event(UserAuditEventType.LOGIN, metadata={"method": "sso", "provider": "keycloak"})`; resposta 200 `{user, tokens, redirect_to}` re-sanitizado
- [X] T015 [P] [US1] Criar apps/web/app/api/auth/keycloak/authorize/route.ts: `GET ?org={slug}&redirect={path}` → chama `POST /api/v1/auth/keycloak/authorize` server-side → `302 Location: authorization_url`; erro/indisponibilidade → `302 /login?org={org}&error=sso_nao_disponivel|sso_indisponivel`; nunca ecoa parâmetros não sanitizados nem expõe corpo JSON (contracts/api-oidc.md §1)
- [X] T016 [P] [US1] Criar apps/web/app/api/auth/keycloak/callback/route.ts: `GET ?code=&state=(&error=)` → se `error=access_denied` → `302 /login?error=acesso_nao_concluido` sem chamar a API; senão `POST /api/v1/auth/keycloak/callback` server-to-server, grava `LH_access`/`LH_refresh` httpOnly + marcador `LH_session=1` com as mesmas opções de cookie de `@services/auth/cookies` (padrão de apps/web/app/api/auth/[...path]/route.ts) e responde `302` para o `redirect_to` interno; falha da API → `302 /login?org={org}&error={codigo}` sem cookies
- [X] T017 [US1] Alterar apps/web/app/auth/login/login.tsx: botão "Entrar com identidade corporativa" visível quando `GET /api/v1/auth/keycloak/status?org={slug}` → `enabled=true`, navegando (top-level) para `/api/auth/keycloak/authorize?org={slug}&redirect={path}`; resolver a colisão com o SSO Enterprise existente (`checkSSOEnabled`/`redirectToSSOLogin` de @services/auth/sso): quando o Keycloak OSS está enabled ele tem precedência e apenas um botão SSO aparece (ambos usam o método `sso` de `allowedMethods`), sem reutilizar o fluxo do módulo Enterprise — decisão de precedência registrada nas Assumptions de spec.md e na nota de fronteira OSS/Enterprise do plan.md (research.md §4)
- [X] T018 [US1] Adicionar as chaves de tradução do botão (ex.: `auth.keycloak_sso_button`) em apps/web/locales/pt.json e apps/web/locales/en.json, com texto pt-BR "Entrar com identidade corporativa"

**Checkpoint**: US1 completa — login federado de ponta a ponta funcional e testável (quickstart §3.1)

---

## Phase 4: User Story 2 - Nenhum token exposto ao navegador (Priority: P1)

**Goal**: Garantir e comprovar (testes + auditoria) que nenhum token do provedor transita pelo
JavaScript, URL fragment ou storage do navegador — tokens internos apenas em cookies httpOnly

**Independent Test**: Auditoria DevTools (quickstart.md §3.2) num login completo: Network, Local/
Session Storage, Cookies e Console sem nenhum token do provedor (SC-003)

### Tests for User Story 2 (escrever PRIMEIRO — devem FALHAR antes da implementação) ⚠️

- [ ] T019 [P] [US2] Adicionar em apps/api/src/tests/routers/test_keycloak_auth_router.py asserções de vazamento: a resposta 200 do callback contém apenas tokens **internos** (nunca `id_token`, access/refresh token do Keycloak); nenhum corpo de erro (410/401/403/503) contém `code`, `code_verifier`, `client_secret` ou claims do token; logs capturados (caplog) durante fluxo feliz e falhas não contêm `code`, tokens nem `client_secret` (FR-004, FR-010)

### Implementation for User Story 2

- [ ] T020 [US2] Revisar e ajustar apps/web/app/api/auth/keycloak/callback/route.ts e apps/web/app/api/auth/keycloak/authorize/route.ts para os invariantes de US2: todas as respostas são `302` sem corpo com tokens; tokens internos saem somente como `Set-Cookie` httpOnly; `error_description` do provedor nunca é repassado à URL ou ao corpo; nenhum dado do callback vai a resposta legível por JavaScript (contracts/api-oidc.md §1 — Invariantes US2)
- [ ] T021 [US2] Varrer apps/api/src/services/auth/keycloak_oidc.py e apps/api/src/routers/keycloak_auth.py removendo qualquer log/exceção que inclua `code`, tokens do provedor, `code_verifier` ou `client_secret` (o claim que falhou vai ao evento de auditoria como categoria, nunca o valor — FR-009/FR-010)
- [ ] T022 [US2] Executar a auditoria manual DevTools do quickstart.md §3.2 num login completo em dev (Network: só `code`+`state` em query, nunca fragmento; Storage vazio de tokens; cookies `LH_*` com `LH_access`/`LH_refresh` HttpOnly; `document.cookie` sem tokens) e registrar o resultado no PR (SC-003)

**Checkpoint**: US1 e US2 comprovadas — arquitetura BFF sem vazamento auditada e testada

---

## Phase 5: User Story 3 - Falhas de autenticação tratadas com segurança (Priority: P2)

**Goal**: Toda falha (state inválido/replay, código expirado, token adulterado, provedor fora do
ar) nega o acesso sem criar sessão, com mensagem clara em pt-BR e auditoria sem dados sensíveis

**Independent Test**: Simular cada condição de falha (quickstart.md §3.3–3.6) e verificar mensagem
exibida e ausência de sessão; suíte automatizada cobre 100% dos casos negativos (SC-002)

### Tests for User Story 3 (escrever PRIMEIRO — devem FALHAR antes da implementação) ⚠️

- [ ] T023 [P] [US3] Adicionar em apps/api/src/tests/security/test_keycloak_oidc_validation.py **um teste negativo por claim** (SC-002), com ID tokens forjados assinados por RSA real: assinatura inválida, `kid` desconhecido (JWKS rebuscado e ainda ausente), `iss` errado, `aud` errado, `azp` errado com múltiplas audiences, `exp` no passado, `nbf` no futuro, `iat` além do leeway, `nonce` divergente, `email_verified=false` — cada caso rejeita sem sessão
- [ ] T024 [P] [US3] Adicionar em apps/api/src/tests/routers/test_keycloak_auth_router.py os casos negativos de fluxo: state reutilizado (segunda apresentação após GETDEL → 410), state desconhecido/expirado → 410, código recusado pelo token_endpoint (expirado/reutilizado/PKCE incorreto) → 401, provedor indisponível → 503 sem stack trace, Redis indisponível → fail closed (authorize e callback recusam), org sem método `sso` → erro sem sessão, sanitização de redirect (`//evil.com`, `https://evil.com`, `javascript:alert(1)` → `/`; `/dash/cursos` → aceito) — nenhum caso emite `mint_session_tokens`

### Implementation for User Story 3

- [ ] T025 [US3] Consolidar o mapeamento de erros em apps/api/src/routers/keycloak_auth.py no formato existente `{"detail": {"code": "...", "message": "..."}}` com mensagens pt-BR e sem detalhe técnico: 410 `FLUXO_INVALIDO`, 401 `CODIGO_RECUSADO`, 401 `TOKEN_INVALIDO`, 403 `CONTA_NAO_ENCONTRADA`, 403 `METODO_NAO_PERMITIDO`, 503 `SSO_INDISPONIVEL`, 404 `SSO_NAO_CONFIGURADO` (contracts/api-oidc.md §2)
- [ ] T026 [US3] Adicionar `record_audit_event` para início de fluxo (authorize), callback recebido e **cada categoria de falha** em apps/api/src/routers/keycloak_auth.py (apps/api/src/services/audit/audit.py), com metadata de categoria (`{"method": "sso", "provider": "keycloak", "failure": "invalid_state|token_invalid|..."}`) e nunca `code`, tokens ou segredos (FR-010)
- [ ] T027 [US3] Garantir em apps/web/app/api/auth/keycloak/callback/route.ts o mapeamento status→código de erro da query: 410 → `sessao_expirada`, 401 → `login_invalido`, 403 `CONTA_NAO_ENCONTRADA` → `conta_nao_encontrada`, 403 `METODO_NAO_PERMITIDO` → `sso_nao_disponivel`, 503 → `sso_indisponivel`, cancelamento → `acesso_nao_concluido` (contracts/api-oidc.md §1)
- [ ] T028 [US3] Exibir mensagens de erro pt-BR na tela de login apps/web/app/auth/login/login.tsx para os códigos `?error=acesso_nao_concluido|sessao_expirada|login_invalido|conta_nao_encontrada|sso_nao_disponivel|sso_indisponivel`, com chaves em apps/web/locales/pt.json e apps/web/locales/en.json — mensagem genérica por categoria, detalhe só nos logs de auditoria do backend (FR-009)

**Checkpoint**: Todas as user stories independentes e funcionais — nenhuma falha cria sessão

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Regressão, validação de ponta a ponta e auditoria final

- [ ] T029 [P] Rodar a regressão do login nativo (SC-004): `uv run pytest src/tests/routers/test_auth_router.py src/tests/routers/test_login_provenance.py src/tests/security/test_auth_policy.py -v` e a suíte completa `uv run pytest` em apps/api (cobertura da flag `api` do CI — Princípio III), sem regressão
- [ ] T030 [P] Executar a validação completa do quickstart.md §3 (cenários 3.1–3.7) em dev com o Keycloak container: login feliz < 15 s, cancelamento, state reutilizado em janela anônima, rotação de chaves no realm (JWKS rebuscado), provedor parado (`docker stop kc-dev` — sessões ativas e login nativo intactos, SC-005/FR-011), open redirect
- [ ] T031 Auditoria final de logs e checklist de saída (quickstart.md §5): nenhum log da API contém `code`, tokens ou `client_secret` durante os cenários; GET /status não permite enumeração de orgs; marcar os critérios de saída da fase ("login técnico validado")

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — começa imediatamente
- **Foundational (Phase 2)**: depende de T001 (config.yaml) — **BLOQUEIA todas as user stories**
- **User Stories (Phases 3–5)**: todas dependem da Phase 2 completa
  - US1 (P1) primeiro — é o MVP e cria os arquivos que US2/US3 endurecem
  - US2 (P1) audita/testa os arquivos criados em US1
  - US3 (P2) adiciona os caminhos negativos sobre US1
- **Polish (Phase 6)**: depende de todas as stories desejadas completas

### User Story Dependencies

- **US1 (P1)**: só depende da Foundational — entregável e testável sozinha (MVP)
- **US2 (P1)**: testável de forma independente (auditoria DevTools), mas endurece os arquivos de
  US1 (T019–T021 tocam callback/authorize/serviço) → executar após o checkpoint de US1
- **US3 (P2)**: os testes negativos (T023/T024) exercitam o validador e o router de US1 →
  executar após o checkpoint de US1; independente de US2

### Within Each User Story

- Testes escritos primeiro e FALHANDO antes da implementação
- Serviço (keycloak_oidc.py) antes dos endpoints (keycloak_auth.py)
- Endpoints FastAPI antes das rotas BFF; rotas BFF antes da UI (login.tsx)
- Tarefas no MESMO arquivo são sequenciais (sem [P]): T004→T005→T006, T010→T011, T012→T013→T014

### Parallel Opportunities

- Phase 1: T002 (ambiente Keycloak) em paralelo com T001
- Phase 2: T003 (config.py) e T007 (esqueleto do router) em paralelo; T004–T006 sequenciais no
  mesmo arquivo
- US1: T008 e T009 (arquivos de teste distintos) em paralelo; T015 e T016 (rotas BFF distintas)
  em paralelo após T013/T014
- US3: T023 e T024 em paralelo (arquivos de teste distintos)
- Polish: T029 e T030 em paralelo

---

## Parallel Example: User Story 1

```bash
# Testes primeiro, em paralelo (devem falhar antes da implementação):
Task: "T008 caminho feliz do validador em apps/api/src/tests/security/test_keycloak_oidc_validation.py"
Task: "T009 fluxo feliz dos endpoints em apps/api/src/tests/routers/test_keycloak_auth_router.py"

# Após T013/T014 (endpoints FastAPI prontos), rotas BFF em paralelo:
Task: "T015 apps/web/app/api/auth/keycloak/authorize/route.ts"
Task: "T016 apps/web/app/api/auth/keycloak/callback/route.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup (T001–T002)
2. Phase 2: Foundational (T003–T007) — CRÍTICA, bloqueia tudo
3. Phase 3: US1 (T008–T018)
4. **PARAR e VALIDAR**: quickstart §3.1 — login de ponta a ponta com o realm de dev
5. Demo/deploy do MVP: login federado funcional com sessão interna reusada

### Incremental Delivery

1. Setup + Foundational → fundação pronta
2. US1 → teste independente (quickstart §3.1) → **MVP!**
3. US2 → auditoria DevTools + testes de vazamento (quickstart §3.2) → release candidato de segurança
4. US3 → suíte negativa completa (SC-002) + mensagens pt-BR → release da Fase 1
5. Polish → regressão SC-004/SC-005 + checklist de saída ("login técnico validado")

### Parallel Team Strategy

Com dois desenvolvedores, após a Foundational:

1. Dev A: US1 backend (T008, T010–T014)
2. Dev B: US1 frontend (T009 em par com A; depois T015–T017) — contratos já fixados em
   contracts/api-oidc.md permitem trabalho em paralelo contra o contrato
3. US2 e US3 podem ser divididas após o checkpoint de US1 (arquivos de teste distintos)

---

## Notes

- [P] = arquivos diferentes, sem dependência pendente
- Nenhuma migração Alembic: o único estado novo é efêmero no Redis (data-model.md)
- Nenhuma dependência nova: httpx + PyJWT[crypto] + redis já instalados (Princípio V)
- Keycloak não sobe em teste: discovery/token_endpoint via monkeypatch, Redis via fake em memória
  (research.md §8)
- Nenhum código do módulo Enterprise é copiado, ativado ou consultado (premissa da spec)
- Commit após cada tarefa ou grupo lógico; parar em qualquer checkpoint para validar a story
