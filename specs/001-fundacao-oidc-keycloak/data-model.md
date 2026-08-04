# Data Model: Login Corporativo via Keycloak (Fundação OIDC)

**Feature**: `001-fundacao-oidc-keycloak` | **Data**: 2026-08-03

Esta feature **não cria nem altera tabelas** no PostgreSQL — nenhuma migração Alembic. O único
estado novo é efêmero, vive no Redis e expira sozinho. A sessão interna emitida ao final é o modelo
já existente (JWT `LH_access`/`LH_refresh` com claims `amr`/`sorg` — ver
`apps/api/src/services/auth/session.py` e `apps/api/src/security/session_context.py`), reutilizado
sem alteração de contrato (FR-007).

## Estruturas efêmeras (Redis)

### AuthFlowState — fluxo de login em andamento

Materializa a entidade "Fluxo de autenticação" da spec. Uma entrada por tentativa de login (cada
aba/tentativa gera a sua — edge case de logins simultâneos).

| Aspecto | Valor |
|---|---|
| Chave | `oidc_flow:{state}` — `state` é `secrets.token_urlsafe(32)`, único e imprevisível |
| Valor | JSON (campos abaixo) |
| TTL | 600 s (10 min) — cobre autenticação + MFA no Keycloak; expira replays tardios |
| Escrita | `SET ... EX 600` em `POST /api/v1/auth/keycloak/authorize` |
| Consumo | `GETDEL` no callback — **uso único atômico**; segunda apresentação do mesmo `state` não encontra a chave → `invalid_state`, sem sessão |
| Sem Redis | Fail closed: authorize não inicia fluxo, callback recusa (padrão de `magic_login._burn_jti`) |

Campos do valor JSON:

| Campo | Tipo | Regra |
|---|---|---|
| `nonce` | string aleatória (`token_urlsafe(32)`) | Enviado ao Keycloak no authorize; DEVE ser idêntico ao claim `nonce` do ID token recebido — divergência rejeita o login |
| `code_verifier` | string aleatória (43–128 chars, RFC 7636) | Segredo PKCE; só o hash S256 (`code_challenge`) sai do servidor; enviado ao token_endpoint na troca do código |
| `org_slug` | string | Organização que originou o fluxo; vincula a sessão resultante ao contexto da org (claim `sorg`) e à política de métodos |
| `redirect_to` | string (path relativo) | Destino pós-login, **já sanitizado no authorize** (somente caminho interno iniciado por `/`, sem `//`, sem esquema); re-sanitizado no consumo (defesa em profundidade) |
| `created_at` | epoch (int) | Auditoria/diagnóstico apenas; expiração real é o TTL da chave |

O `state` em si não é campo do valor: ele é a chave. O navegador só transporta `state` (opaco) —
`nonce` e `code_verifier` nunca saem do servidor em claro.

### Caches de metadados do provedor (memória de processo, não Redis)

| Estrutura | Conteúdo | Expiração |
|---|---|---|
| Discovery cache | documento `.well-known/openid-configuration` do issuer configurado | TTL 1 h em memória; refetch sob demanda |
| JWKS | chaves públicas do realm, via `jwt.PyJWKClient` singleton | cache interno do PyJWKClient; refetch automático em `kid` desconhecido (rotação de chaves) |

Dados públicos e não sensíveis; nenhum requisito de uso único → não precisam de Redis (decisão em
`research.md` §3).

## O que explicitamente NÃO pertence a esta feature

- **ExternalIdentity** (`issuer` + `subject` → `user_id`, unicidade em `(issuer, subject)`): é a
  feature `002-identidade-provisionamento`, junto com sua migração Alembic, política de linking por
  e-mail verificado e provisionamento. Nesta feature 001, a resolução do usuário local é interina —
  lookup de `User` existente por `email` com `email_verified=true` no ID token, sem persistir
  vínculo (ver `research.md` §6).
- **OIDCProviderConfig** (configuração por organização com segredo criptografado): feature
  `004-admin-config-oidc`. Aqui a configuração é estática por deployment (env/config).
- **Vínculo de sessão upstream / `sid`** (refresh e logout coordenados): features 002/003.
