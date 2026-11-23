# Data Model: Administração da Configuração OIDC

**Feature**: `004-admin-config-oidc` | **Data**: 2026-08-03

## Entidade: OIDCProviderConfig

Tabela `oidc_provider_config` — modelo SQLModel em
`apps/api/src/db/oidc_provider_config.py`, migração Alembic em
`apps/api/migrations/versions/` (mesmo PR — Princípio III). Convenções seguem
`apps/api/src/db/webhooks.py` (org FK com `ondelete="CASCADE"`, segredo em coluna
`*_encrypted`, autor em `created_by_user_id`) e timestamps `timestamptz` como
`apps/api/src/db/user_audit_events.py` (não repetir o padrão legado de datas em
string).

### Campos

| Campo | Tipo | Constraints | Descrição |
|---|---|---|---|
| `id` | `Integer` | PK | Chave primária. |
| `org_id` | `Integer` | FK `organization.id`, `ondelete="CASCADE"`, NOT NULL, **UNIQUE** | Organização dona. UNIQUE = no máximo 1 configuração (logo, 1 provedor ativo) por org no primeiro release. |
| `issuer_url` | `String(2048)` | NOT NULL | Endereço do emissor, validado (HTTPS + anti-SSRF + discovery) antes de persistir. Normalizado sem barra final; comparado com igualdade exata ao claim `issuer` do documento de discovery. |
| `client_id` | `String(255)` | NOT NULL | Identificador do cliente confidencial no provedor. |
| `client_secret_encrypted` | `Text` | NOT NULL, default `""` | Segredo cifrado com Fernet (chave fora do banco — ver `research.md` §1). String vazia = segredo ainda não configurado. **Nunca serializado em nenhum schema de leitura.** |
| `scopes` | `String(500)` | NOT NULL, default `"openid email profile"` | Scopes separados por espaço (formato do protocolo). |
| `enabled` | `Boolean` | NOT NULL, `server_default="false"` | Situação ativo/inativo. Só pode ser `true` com segredo configurado e discovery validado. |
| `allowed_email_domains` | `JSON` (lista de `str`) | NOT NULL, default `[]` | Domínios de e-mail admitidos no provisionamento. Lista vazia = sem filtro de domínio (a restrição padrão vem de `auto_provision_users=false`). |
| `auto_provision_users` | `Boolean` | NOT NULL, `server_default="false"` | Padrão restritivo: primeiro acesso não cria conta até o admin ligar. |
| `default_role_id` | `Integer` | FK `role.id`, NULLABLE | Papel padrão de menor privilégio aplicado no provisionamento. Obrigatório quando `auto_provision_users=true`. |
| `required_acr` | `String(255)` | NULLABLE | Nível mínimo de autenticação (claim `acr`) exigido nos tokens. NULL = sem exigência. |
| `clock_skew_seconds` | `Integer` | NOT NULL, default `60` | Tolerância de relógio na validação de `exp`/`nbf`/`iat`. Faixa aceita: 0–300. |
| `created_by_user_id` | `Integer` | FK `user.id`, NOT NULL | Autor da criação (padrão `webhook_endpoint`). |
| `created_at` | `DateTime(timezone=True)` | NOT NULL | Criação (UTC). |
| `updated_at` | `DateTime(timezone=True)` | NOT NULL | Última alteração (UTC). |

Índices: o UNIQUE de `org_id` já é o índice de leitura do fluxo de login
(`get_active_oidc_config` filtra `org_id = ? AND enabled = true`).

**Evolução para múltiplos provedores** (fora do escopo do primeiro release): trocar
o UNIQUE simples por índice parcial
`UNIQUE (org_id) WHERE enabled` — a regra "no máximo 1 provedor ATIVO por org"
sobrevive à chegada de N configurações. Campo `provider`
("keycloak"/"oidc", documento-base §7.1) não é necessário enquanto o issuer
identifica o provedor — YAGNI.

### Schemas Pydantic (mesmo arquivo)

- `OIDCProviderConfigRead` — todos os campos acima **exceto**
  `client_secret_encrypted`, mais `secret_configured: bool`
  (= `bool(client_secret_encrypted)`, padrão `has_secret` de
  `WebhookEndpointRead` em `apps/api/src/db/webhooks.py`). O campo do segredo não
  existe no schema — vazamento por serialização é estruturalmente impossível.
- `OIDCProviderConfigWrite` — payload do PUT: campos editáveis +
  `client_secret: str | None` (write-only; ver semântica abaixo).
- `OIDCConnectionTestResult` — `status: "ok" | "inacessivel" | "invalida"`,
  `detail: str` (pt-BR), `discovered_endpoints: dict | None` (sem dados sensíveis).

### Regras de validação (aplicadas no serviço `apps/api/src/services/auth/oidc_config.py`)

1. **issuer_url** (FR-003): HTTPS obrigatório fora de `development_mode`; resolução
   DNS não pode cair em faixa privada/loopback/link-local/reservada/multicast
   (validador de `src/services/security/url_validation.py`); discovery
   bem-sucedido e `issuer` do documento igual ao configurado — tudo antes de
   persistir mudança de issuer.
2. **Segredo** (FR-004/FR-005): no PUT, `client_secret` ausente ou `null` = mantém
   o atual; string não vazia = substitui (cifra e grava — única operação
   permitida); string vazia = 422 (não existe "remover segredo"). Nenhuma leitura,
   exportação ou log contém o valor.
3. **Ativação**: `enabled=true` exige `secret_configured=true` e issuer validado;
   caso contrário 400 com mensagem pt-BR.
4. **default_role_id**: deve existir, pertencer à org (ou ser papel global) e NÃO
   estar em `ADMIN_OR_MAINTAINER_ROLE_IDS`
   (`apps/api/src/security/rbac/constants.py`) — menor privilégio, mesma regra que
   `provision_user`/`change_user_role` já aplicam em
   `src/services/admin/admin.py`. Obrigatório se `auto_provision_users=true`.
5. **allowed_email_domains**: normalizados para minúsculas, sem `@`, formato de
   domínio válido; duplicatas removidas.
6. **clock_skew_seconds**: `0 <= x <= 300` (Pydantic `ge`/`le`).
7. **Exclusão**: exige confirmação explícita (`confirm=true`); não apaga usuários,
   vínculos nem identidades externas — apenas a configuração (edge case da spec:
   contas preservadas para eventual reativação).

### Ciclo de vida (estados)

```
(inexistente)
   → rascunho        PUT inicial; enabled=false; pode ou não ter segredo
   → configurada     secret_configured=true, discovery ok
   → ativa           enabled=true  → botão de login corporativo aparece na org
   → desativada      enabled=false → botão some no próximo carregamento (SC-005);
                     contas, vínculos e sessões existentes intactos (FR-007/FR-009)
   → excluída        DELETE confirmado; identidades externas preservadas
```

## Relações com outras features

### ExternalIdentity (feature `002-identidade-provisionamento`)

- **Sem FK direta.** A identidade externa é chaveada por `(issuer, subject)`
  (documento-base §7.1); a correlação com esta config é lógica:
  `external_identity.issuer == oidc_provider_config.issuer_url` (normalizados).
- Consequências: excluir/desativar a config **não** cascateia sobre identidades —
  reativar o mesmo issuer religa os mesmos vínculos (edge case da spec); duas orgs
  apontando para o mesmo issuer têm configs e políticas independentes (o vínculo
  org↔usuário vem de `user_organization`, não desta tabela).
- A feature `002` consome, no primeiro acesso: `auto_provision_users`,
  `allowed_email_domains`, `default_role_id` — via
  `get_active_oidc_config(org_id)`.

### Fluxo de login (feature `001-fundacao-oidc-keycloak`)

- A feature `001` lê a config ativa (`enabled=true`) da org para montar o fluxo
  authorize/callback (issuer → discovery, `client_id`, decifrar
  `client_secret_encrypted` só no backend para a troca de código no token
  endpoint) e validar tokens (`required_acr`, `clock_skew_seconds`).
- O flag público "login corporativo disponível" no payload de
  `GET /orgs/slug/{slug}` reflete `enabled` — é o que faz o botão sumir
  imediatamente na desativação (SC-005), no padrão de
  `apps/web/services/auth/authMethods.ts`.
- Substituição de segredo vale para as próximas trocas de código; sessões já
  emitidas não dependem do segredo do cliente — sem interrupção de login (FR-005).
- Estado de saúde do discovery (edge case "provedor reconfigurado depois"): não é
  persistido nesta tabela — a feature `001` mantém cache/erros de discovery no
  Redis e a tela de configuração os exibe via o endpoint de teste de conexão.

### Registro de Auditoria Administrativa

- Reutiliza `user_audit_event` (`apps/api/src/db/user_audit_events.py`) com os
  novos `event_type` `oidc_config_*` (ver `research.md` §6): autor
  (`user_id`), momento (`created_at`), `org_id` e `audit_metadata` com a lista de
  nomes dos campos alterados — sem valores de segredo (FR-008). Nenhuma tabela
  nova para auditoria.
