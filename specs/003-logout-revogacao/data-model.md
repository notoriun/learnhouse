# Data Model: Logout Coordenado e Revogação de Sessão

**Feature**: `003-logout-revogacao` | **Date**: 2026-08-03

## Entidade: Sessão Upstream (`upstream_session`)

Vínculo durável entre uma cadeia de sessão local (identificada pelo claim `usid` dos JWTs) e a
sessão no provedor de identidade (`issuer` + `sid`). Uma linha por login federado. Modelo
SQLModel em `apps/api/src/db/upstream_sessions.py`; migração Alembic obrigatória no mesmo PR
(Princípio III).

### Campos

| Campo | Tipo | Regras |
|---|---|---|
| `id` | `int` PK autoincrement | Chave primária técnica. |
| `session_uuid` | `String(64)`, NOT NULL, **UNIQUE** | Valor do claim `usid` estampado nos JWTs locais da cadeia (ex.: `upsession_<uuid4>`). Gerado no login federado. |
| `user_id` | `int` FK → `user.id`, NOT NULL, `ondelete=CASCADE`, index | Usuário local dono da sessão. |
| `external_identity_id` | `int` FK → identidade externa (feature 002), NULLABLE, `ondelete=SET NULL` | Identidade federada que originou a sessão. |
| `org_id` | `int` FK → `organization.id`, NULLABLE, `ondelete=CASCADE` | Organização do fluxo de login (espelha o claim `sorg`; nullable como no login central/apex). |
| `issuer` | `Text`, NOT NULL | Issuer normalizado do provedor. `sid` só é interpretado dentro do seu issuer. |
| `sid` | `String(255)`, NULLABLE, index composto | Claim `sid` do ID token (correlação de logout). Nullable: provedores sem `sid` ainda têm TTL e refresh upstream como garantias. |
| `upstream_refresh_encrypted` | `Text`, NULLABLE | Refresh token upstream cifrado (Fernet, chave fora do banco — research R2). Atualizado a cada rotação upstream. NUNCA exposto em API/log. |
| `id_token_encrypted` | `Text`, NULLABLE | Último ID token cifrado; usado apenas como `id_token_hint` no RP-Initiated Logout (research R7). |
| `status` | `String(16)`, NOT NULL, default `active` | `active` \| `revoked` \| `expired`. |
| `revocation_reason` | `String(32)`, NULLABLE | `user_logout` \| `backchannel` \| `upstream_denied` \| `policy_ttl` \| `admin`. Preenchido ao sair de `active`. |
| `created_at` | `timestamptz`, NOT NULL, default utcnow | Início da sessão federada; base do TTL máximo absoluto (research R6). |
| `last_refreshed_at` | `timestamptz`, NULLABLE | Última renovação upstream bem-sucedida. |
| `revoked_at` | `timestamptz`, NULLABLE | Momento da transição para `revoked`/`expired`. |

### Índices

| Índice | Colunas | Uso |
|---|---|---|
| `uq_upstream_session_uuid` (UNIQUE) | `session_uuid` | Lookup no refresh e no `get_current_user` (via claim `usid`). |
| `ix_upstream_session_issuer_sid` | `issuer`, `sid` | Busca do back-channel logout por sid. NÃO único: o mesmo sid SSO pode originar mais de uma sessão local (novo login na mesma sessão de navegador do Keycloak). |
| `ix_upstream_session_user_status` | `user_id`, `status` | Revogação por usuário (back-channel sem `sid`, desativação administrativa) e visão operacional. |

### Estados e transições

```text
                    ┌──────────────────────────────┐
                    │            active            │
                    └──────┬───────┬───────┬───────┘
       logout do usuário   │       │       │   TTL máximo excedido /
       (RP-Initiated ou    │       │       │   refresh upstream expirado
       local)              │       │       │   naturalmente
                           v       │       v
                      ┌─────────┐  │  ┌─────────┐
                      │ revoked │  │  │ expired │
                      └─────────┘  │  └─────────┘
                           ^       │
                           │       │ back-channel válido (sid/sub) OU
                           └───────┘ rejeição definitiva no refresh
                                     (invalid_grant)
```

- `active → revoked` — motivos: `user_logout` (FR-001/FR-003), `backchannel` (FR-004),
  `upstream_denied` (FR-005/FR-006), `admin` (uso futuro/operacional).
- `active → expired` — motivo: `policy_ttl` (FR-007) ou expiração natural do refresh upstream.
- `revoked` e `expired` são **terminais**: nenhuma transição de volta; reprocessamento
  back-channel de sessão já encerrada é no-op idempotente (edge case da spec).
- **Falha transitória NÃO transiciona estado**: a linha permanece `active` e a renovação é
  reapresentada depois (User Story 3).
- Invariante de escrita: toda transição para fora de `active` grava, na mesma operação, a chave
  Redis `upstream_revoked:{session_uuid}` (TTL = `JWT_REFRESH_TOKEN_EXPIRES`) — o enforcement
  no hot path — e `revoked_at`/`revocation_reason` na linha.
- Higiene: linhas terminais são elegíveis a limpeza por retenção (a auditoria durável vive em
  `user_audit_event`, não aqui); `upstream_refresh_encrypted` e `id_token_encrypted` são
  anulados na transição terminal (não reter segredos mortos).

### Relacionamentos

- `upstream_session.user_id → user.id` (N:1) — um usuário pode ter várias sessões federadas
  (múltiplos dispositivos), cada uma com seu `session_uuid`.
- `upstream_session.external_identity_id → external_identity.id` (N:1, feature 002).
- Cadeia de sessão local: **não há tabela de sessão local** (JWTs stateless); o vínculo é o
  claim `usid` = `session_uuid`, carregado através das rotações por `carry_session_claims`
  (`apps/api/src/security/session_context.py`).

## Chaves Redis (enforcement e controles — não são schema)

| Chave | Valor / TTL | Uso |
|---|---|---|
| `upstream_revoked:{session_uuid}` | `"1"` / `JWT_REFRESH_TOKEN_EXPIRES` | Rejeição imediata em `get_current_user` e `/auth/refresh` para tokens com claim `usid`. Espelha o padrão `jwt_revoked_before:{user_id}` existente. |
| `backchannel_jti:{jti}` | `"1"` / 10 min, SET NX | Telemetria de reprocessamento do logout token (outcome `replayed`); não bloqueia — ver research R3. |
| *(existentes, reusadas)* `jwt_revoked_before:{user_id}`, `refresh_used:{user_id}:{jti}`, `refresh_grace:{user_id}:{jti}` | — | Blocklist por usuário no logout; rotação one-time-use; grace window de concorrência. Sem mudança de semântica. |

## Eventos de auditoria (tabela existente `user_audit_event`)

Novo tipo em `UserAuditEventType` (`apps/api/src/db/user_audit_events.py`) + reuso do `LOGOUT`
existente. Gravados via `record_audit_event` (commit isolado, nunca bloqueia o caminho do
usuário). **Nunca contêm tokens, sid bruto opcionalmente truncado, nem segredos** (FR-008).

| Evento | `event_type` | Quando | `audit_metadata` (exemplos) |
|---|---|---|---|
| Logout local (nativo) | `logout` (existente) | DELETE `/auth/logout` | `{"method": "local"}` |
| Logout iniciado pela aplicação (RP) | `logout` | POST `/auth/keycloak/logout` | `{"method": "rp_initiated", "session_uuid": ..., "sso_terminated": true}` |
| Revogação de sessão | `session_revoked` (**novo**) | back-channel aceito; `invalid_grant` no refresh; TTL de política | `{"origin": "backchannel" \| "upstream_denied" \| "policy_ttl", "session_uuid": ..., "sessions_affected": n}` |

Notificação back-channel **rejeitada** (assinatura/claims inválidos) não tem usuário
identificado com confiança → não gera linha em `user_audit_event`; é registrada por log
estruturado de auditoria operacional `auth.backchannel outcome=rejected_*` + Sentry, sem
atribuição de usuário e sem tokens ou segredos (FR-008 e edge case "rejeitada … com registro
do evento").

## Observabilidade (padrão existente de outcomes fechados)

Sem Prometheus (não existe na API); segue o padrão `_log_refresh_outcome` de
`apps/api/src/routers/auth.py` — uma linha estruturada por tentativa, outcome de conjunto
fechado, contável e alertável:

- Logger `learnhouse.auth.upstream` — outcomes: `upstream_ok`, `upstream_transient`,
  `upstream_denied`, `upstream_revoked`, `ttl_exceeded`.
- Logger `learnhouse.auth.backchannel` — outcomes: `accepted`, `unknown_session`,
  `already_revoked`, `replayed`, `rejected_signature`, `rejected_claims`.
- Alertas (documento-base §16): aumento de `upstream_denied` (revogações em massa),
  `upstream_transient` sustentado (indisponibilidade do provedor), qualquer taxa de
  `rejected_*` (tentativas de forjar logout).
