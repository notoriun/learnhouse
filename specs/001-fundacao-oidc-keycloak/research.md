# Research: Login Corporativo via Keycloak (Fundação OIDC)

**Feature**: `001-fundacao-oidc-keycloak` | **Data**: 2026-08-03

Nenhum "NEEDS CLARIFICATION" restante — todas as incógnitas do Technical Context estão resolvidas
abaixo.

## 1. Biblioteca OIDC: implementação própria com httpx + PyJWT

**Decisão**: Implementar o cliente OIDC diretamente com `httpx` (discovery e troca de código) e
`PyJWT[crypto]` com `jwt.PyJWKClient` (validação de assinatura via JWKS). Ambos já estão em
`apps/api/pyproject.toml` (`httpx==0.28.1`, `pyjwt[crypto]==2.13.0`, com `cryptography==49.0.0`).

**Justificativa**: Princípio V da constituição (dependência já instalada antes de código novo, e
código novo antes de dependência nova). O fluxo necessário é pequeno e bem especificado: 1 GET de
discovery, 1 POST de token, 1 validação de JWT — `PyJWT` já valida `iss`, `aud`, `exp`, `nbf`,
`iat` e assinatura com `leeway`; sobram apenas `azp` e `nonce`, verificações manuais de duas
linhas. O projeto já usa PyJWT para toda a sessão interna (`src/security/auth.py::decode_jwt`),
então não há segundo vocabulário de JWT no código.

**Alternativas consideradas**:
- **Authlib** — cliente OIDC completo, mas é dependência nova, traz máquina de estados própria e
  esconderia exatamente as validações que a spec exige testar claim a claim (SC-002). Rejeitada.
- **python-keycloak** — acopla ao admin API do Keycloak, muito além do necessário para um RP.
  Rejeitada.
- **oic / oidcrp** — manutenção irregular, dependência nova. Rejeitada.

## 2. Armazenamento do fluxo (state/nonce/PKCE) no Redis

**Decisão**: Uma chave por fluxo — `oidc_flow:{state}` — com valor JSON
`{nonce, code_verifier, org_slug, redirect_to, created_at}`, `TTL = 600 s` (10 min), gravada via
`get_redis_client()` (`apps/api/src/core/redis.py`, pool singleton). Consumo atômico com
`GETDEL` no callback: a primeira apresentação do `state` recupera e destrói o registro; qualquer
reapresentação encontra chave ausente → uso único por construção. Sem Redis disponível, o fluxo
**falha fechado** (não inicia login e não aceita callback).

**Justificativa**: `state` aleatório (`secrets.token_urlsafe(32)`) já é chave natural e única do
fluxo; `GETDEL` elimina a janela entre ler e apagar sem precisar de Lua nem de `SETNX` auxiliar.
O padrão fail-closed espelha `magic_login._burn_jti`
(`apps/api/src/services/auth/magic_login.py`), que documenta a mesma razão: um valor de uso único
não pode ser "provavelmente único". TTL de 10 min cobre autenticação + MFA no Keycloak com folga e
mantém a janela de replay curta (FR-003). Múltiplas abas funcionam naturalmente: cada aba gera seu
próprio `state`/chave (edge case da spec).

**Alternativas consideradas**:
- **Cookie assinado com o flow state** (stateless) — evitaria Redis, mas uso único exigiria um
  denylist… em Redis. Além disso o `code_verifier` viajaria pelo navegador. Rejeitada.
- **Tabela PostgreSQL** — exigiria migração e limpeza por job para dados que vivem minutos;
  Redis com TTL faz a expiração de graça. Rejeitada.
- **SETNX marker de consumo** (padrão do magic link) — funciona, mas são duas operações e duas
  chaves; `GETDEL` é uma. Rejeitada por ser maior sem ganho.

## 3. Cache de discovery e JWKS

**Decisão**: Discovery (`{issuer}/.well-known/openid-configuration`) buscado via httpx com timeout
curto (5 s) e cacheado em memória de processo com TTL de 1 h. JWKS via `jwt.PyJWKClient` mantido
como singleton por issuer, com o cache interno do próprio PyJWKClient (`cache_keys=True`,
lifespan padrão) — em `kid` desconhecido o PyJWKClient rebusca o JWKS automaticamente, o que cobre
rotação de chaves (FR-006, edge case da spec) sem código extra.

**Justificativa**: São dados públicos, pequenos e por processo; cache em memória evita uma ida ao
Redis por login e não cria estado compartilhado a invalidar. O comportamento de rebusca em `kid`
desconhecido é exatamente a semântica exigida: "obter as chaves atualizadas e concluir, ou falhar
de forma segura".

**Alternativas consideradas**:
- **Cache no Redis** (`oidc_discovery:{issuer}`) — útil quando houver N provedores dinâmicos por
  org (feature 004); com um provedor estático por deployment é indireção sem ganho. Adiar para 004
  se necessário. Rejeitada agora.
- **Buscar a cada login** — adiciona 2 round-trips por login e um ponto de falha; viola SC-001.
  Rejeitada.

## 4. Formato do callback no BFF (Next.js)

**Decisão**: Duas Route Handlers server-side no App Router:

- `GET /api/auth/keycloak/authorize?org={slug}&redirect={path}` → chama
  `POST /api/v1/auth/keycloak/authorize` no FastAPI, recebe `{authorization_url}` e responde
  `302` para o Keycloak.
- `GET /api/auth/keycloak/callback?code=...&state=...` (redirect URI exata cadastrada no client) →
  chama `POST /api/v1/auth/keycloak/callback` server-to-server, recebe os tokens internos no corpo,
  grava `LH_access`/`LH_refresh` (httpOnly) + marcador `LH_session` com as mesmas opções de cookie
  do proxy existente, e responde `302` para o destino interno retornado pela API. Em erro, responde
  `302 /login?error={codigo}` (+ `?org=` quando conhecido) — nunca corpo JSON com detalhes.

**Justificativa**: É o mesmo contrato que `apps/web/app/api/auth/[...path]/route.ts` já pratica
(backend retorna tokens no corpo em chamada server-to-server; o BFF os converte em cookies via
`@services/auth/cookies`), aplicado a um fluxo de navegação por redirect. O navegador só vê
redirects e `Set-Cookie` — nenhum token do provedor nem token interno aparece em resposta legível
por JavaScript (FR-004, US2). O `code` do Keycloak chega por query string a uma rota **server-side**
e morre ali.

**Alternativas consideradas**:
- **Página client-side que posta code/state à API** (padrão do SSO Enterprise atual em
  `apps/web/app/auth/sso/callback/page.tsx`) — coloca `code`/`state` no JavaScript do navegador e
  reutilizaria o fluxo do módulo Enterprise, que a spec proíbe. Rejeitada (ADR-03).

**Fronteira com o SSO Enterprise**: a proibição de "consultar/reutilizar o módulo Enterprise"
refere-se ao **fluxo** — os serviços (`@services/auth/sso`), o callback client-side
(`auth/sso/callback`) e os endpoints EE. Tocar `apps/web/app/auth/login/login.tsx` para coordenar
precedência e visibilidade de botões é interação com código AGPL do repositório público e é
permitido. Decisão de precedência (registrada também nas Assumptions da spec): quando o Keycloak
OSS está habilitado, ele tem precedência sobre o SSO Enterprise e apenas um botão de identidade
corporativa é exibido na página de login.
- **Callback direto no FastAPI** (redirect URI apontando à API) — a API teria de gravar cookies do
  domínio do frontend e conhecer a topologia de domínios do Next.js (tenancy single/multi, domínios
  custom), lógica que hoje vive no BFF. Rejeitada.

## 5. Tratamento de clock skew

**Decisão**: Usar o parâmetro `leeway` do `jwt.decode` para `exp`/`nbf`/`iat`, com default de
**30 s**, configurável por `LEARNHOUSE_KEYCLOAK_CLOCK_SKEW` (segundos) no bloco `KeycloakConfig` de
`apps/api/config/config.py`. Fora da tolerância → rejeição sem sessão.

**Justificativa**: A spec exige tolerância "limitada e configurável"; `leeway` é o mecanismo nativo
do PyJWT — zero código novo. 30 s cobre drift de NTP normal entre containers sem abrir janela
relevante de replay; o documento-base (seção 7.2) prevê `clock_skew` como configuração.

**Alternativas consideradas**: valor fixo hardcoded (não configurável — contraria a spec) e leeway
zero (falha espúria com drift de segundos entre containers — contraria o edge case). Rejeitadas.

## 6. Reúso da emissão de sessão interna

**Decisão**: Após validar o ID token e resolver o usuário local, o callback do FastAPI:

1. Reaplica a política de métodos da org: `enforce_login_auth_method(db_session, org_id, AUTH_METHOD_SSO)`
   (`src/services/orgs/auth_policy.py`; `AUTH_METHOD_SSO = "sso"` já existe em
   `src/security/session_context.py` e já integra `POLICY_AUTH_METHODS`).
2. Emite a sessão com `mint_session_tokens(user.email, amr=AUTH_METHOD_SSO, org_id=org_id)` de
   `apps/api/src/services/auth/session.py` — deliberadamente **sem** o desafio de MFA local
   (`issue_session_or_challenge`), porque a spec assume que MFA é responsabilidade do Keycloak e o
   documento-base proíbe duplo MFA para SSO (seção 17, "Duplo MFA").
3. Registra `record_audit_event(UserAuditEventType.LOGIN, ..., metadata={"method": "sso", "provider": "keycloak"})`
   (`src/services/audit/audit.py`) — sem code, tokens ou segredos (FR-010).
4. Retorna `access_token`/`refresh_token` no corpo (contrato server-to-server que o BFF espelha em
   cookies), exatamente como `/auth/login` e `/auth/oauth` já fazem.

**Resolução do usuário local (interina, até a feature 002)**: localizar `User` existente pelo claim
`email` **somente quando `email_verified=true`** no ID token; usuário inexistente → erro
`user_not_found` sem sessão (sem auto-provisionamento). A identidade durável por `issuer+sub`
(`ExternalIdentity`) chega na feature 002 e substitui este lookup.

**Justificativa**: `mint_session_tokens` é o chokepoint documentado de emissão de sessão — reusar
garante formato, expiração, claims de proveniência (`amr`/`sorg`) e política por org idênticos ao
login nativo (FR-007, "mesmo modelo de sessão"). O gate por e-mail verificado espelha a regra que
`/auth/oauth` já aplica ao Google ("Google did not return a verified email...").

**Alternativas consideradas**:
- `issue_session_or_challenge` (com gate de MFA local) — causaria duplo MFA para quem tem TOTP
  local + MFA no Keycloak; contraria a premissa da spec. Rejeitada (registrar `amr="sso"` é a
  evidência do método).
- Associação por e-mail não verificado — vetada pelo documento-base (seção 8, account takeover).
  Rejeitada.

## 7. Configuração do provedor nesta fase

**Decisão**: Configuração estática por deployment em `apps/api/config/config.py`
(bloco `KeycloakConfig`): `enabled`, `issuer` (HTTPS obrigatório fora de dev), `client_id`,
`client_secret` (somente env, nunca em resposta de API), `clock_skew`. A habilitação **por org**
nesta fase é a combinação: config presente e ativa **e** método `sso` permitido na política da org
(`is_login_method_allowed`). A tabela `OIDCProviderConfig` por organização é a feature 004.

**Justificativa**: FR-001 exige o botão apenas "nas organizações com provedor configurado e
ativo"; a política de métodos por org já existente fornece o interruptor por org sem schema novo.
Princípio V: config especulativa por tabela agora seria abstração antecipada da feature 004.

**Alternativas consideradas**: criar `OIDCProviderConfig` já em 001 (migração + criptografia de
segredo antecipadas sem tela de admin para usá-las — rejeitada); habilitar para todas as orgs
incondicionalmente (violaria FR-001 — rejeitada).

## 8. Estratégia de teste

**Decisão**: pytest, nos dois diretórios já usados pelos testes de auth:

- `apps/api/src/tests/security/test_keycloak_oidc_validation.py` — unidade do validador, com par de
  chaves RSA gerado em fixture (`cryptography`) e ID tokens forjados. **Um teste negativo por
  claim** (SC-002): assinatura inválida, `kid` desconhecido, `iss` errado, `aud` errado, `azp`
  errado com múltiplas audiences, `exp` no passado, `nbf` no futuro, `iat` além do skew, `nonce`
  divergente, `email_verified=false` — cada um termina sem sessão.
- `apps/api/src/tests/routers/test_keycloak_auth_router.py` — endpoints com
  `fastapi.testclient` + app mínimo (`include_router(..., prefix="/api/v1/auth/keycloak")`, padrão
  de `test_auth_router.py`): fluxo feliz (state consumido, sessão emitida, cookies setados),
  state reutilizado/expirado/desconhecido, código recusado pelo token_endpoint, provedor
  indisponível (503 sem stack trace), org sem método `sso`, sanitização de redirect
  (`//evil.com`, `https://evil.com`, `javascript:` → rejeitados; `/dash/cursos` → aceito).

Keycloak não sobe em teste: discovery/token_endpoint são stubs (monkeypatch das funções httpx do
serviço, padrão dos testes existentes que fazem `mocker.patch("src.routers.auth....")`); Redis é
substituído por um fake em memória via patch do shim `_redis()`/`get_redis_client`, como nos testes
de magic link e refresh.

**Justificativa**: segue o layout e as convenções de mock já estabelecidos na suíte
(`src/tests/routers/`, `src/tests/security/`, coverage flag `api` — Princípio III). Assinar tokens
de verdade com RSA em vez de mockar o `jwt.decode` garante que os testes negativos exercitam o
validador real.

**Alternativas consideradas**: Keycloak real via testcontainers (lento, flaky em CI, desnecessário
para validar claims — fica para o E2E manual do quickstart); `respx`/`fakeredis` (dependências
novas para o que monkeypatch já resolve). Rejeitadas.
