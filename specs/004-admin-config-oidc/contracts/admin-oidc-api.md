# Contrato: API Administrativa da Configuração OIDC

**Feature**: `004-admin-config-oidc` | **Data**: 2026-08-03

Base: `/api/v1/orgs/{org_id}/oidc-config` — router novo
(`apps/api/src/routers/oidc_admin.py`) montado em `apps/api/src/router.py` com
`prefix="/orgs"`, como `webhooks` e `api_tokens`. **Sem** `require_plan`: núcleo
AGPL, disponível a toda instância.

## Autenticação e permissões (todos os endpoints)

- Usuário autenticado por sessão/JWT (`get_current_user`); anônimo → **401**.
- `require_org_admin(user_id, org_id, db_session)` de
  `apps/api/src/security/org_auth.py` — admin/maintainer da org (ou superadmin,
  bypass embutido); aplica também as políticas de MFA/sessão da org
  (`enforce_org_mfa`). Não-admin ou membro de outra org → **403** (FR-001,
  cenário 4 da US1).
- Todas as consultas filtram por `org_id` do path — nunca há acesso cross-org
  (Princípio IV).
- Respostas com `Cache-Control: no-store` (dados de configuração de autenticação).

## Semântica do segredo (transversal)

- **Leitura**: o valor do segredo NUNCA aparece. Toda resposta usa
  `secret_configured: boolean` (padrão `has_secret` de
  `apps/api/src/db/webhooks.py`).
- **Escrita**: campo write-only `client_secret` no PUT —
  ausente/`null` = mantém o segredo atual; string não vazia = **substitui**
  (única operação permitida, FR-005); string vazia = **422**.
- O segredo jamais aparece em logs, mensagens de erro ou trilha de auditoria
  (FR-004/FR-008); a rotação gera evento de auditoria sem valor.

---

## 1. `GET /orgs/{org_id}/oidc-config`

Lê a configuração da organização.

**Respostas**
- **200** — objeto de leitura: `id`, `org_id`, `issuer_url`, `client_id`,
  `secret_configured`, `scopes`, `enabled`, `allowed_email_domains`,
  `auto_provision_users`, `default_role_id`, `required_acr`,
  `clock_skew_seconds`, `created_by_user_id`, `created_at`, `updated_at`.
- **404** — a org ainda não possui configuração OIDC.
- **401 / 403** — conforme regras gerais.

## 2. `PUT /orgs/{org_id}/oidc-config`

Cria ou atualiza (upsert — a configuração é singleton por org no primeiro
release). Aceita atualização parcial: campos ausentes mantêm o valor atual.

**Corpo** (`OIDCProviderConfigWrite`): `issuer_url`, `client_id`,
`client_secret` (write-only, ver semântica acima), `scopes`, `enabled`,
`allowed_email_domains`, `auto_provision_users`, `default_role_id`,
`required_acr`, `clock_skew_seconds`.

**Validações server-side** (mensagens em pt-BR):
- issuer: HTTPS obrigatório fora de dev; anti-SSRF (DNS → bloqueio de faixas
  privadas/loopback/link-local/reservadas); discovery bem-sucedido com `issuer`
  coincidente — tudo antes de persistir (FR-003).
- `enabled=true` exige `secret_configured=true`.
- `default_role_id`: existente, da org (ou global), não Admin/Maintainer;
  obrigatório com `auto_provision_users=true`.
- `clock_skew_seconds` 0–300; domínios de e-mail com formato válido.

**Respostas**
- **200** — mesma forma do GET (nunca o segredo). Ativação/desativação tem efeito
  imediato no flag público de login da org (SC-005).
- **400** — issuer bloqueado (SSRF/HTTP), discovery falhou (detalhe distingue
  "provedor inacessível" de "configuração inválida"), ativação sem segredo, papel
  padrão inválido/elevado/de outra org.
- **422** — payload malformado (`client_secret` vazio, skew fora da faixa etc.).
- **401 / 403 / 429** — conforme regras gerais; mutações têm rate limit por org
  (padrão `src/services/security/rate_limiting.py`).

**Auditoria**: emite `oidc_config_created` / `oidc_config_updated` /
`oidc_config_activated` / `oidc_config_deactivated` /
`oidc_config_secret_rotated` com autor, momento e nomes dos campos alterados
(FR-008).

## 3. `POST /orgs/{org_id}/oidc-config/test`

Teste de conexão (FR-006). Corpo opcional `{ "issuer_url": "..." }` — quando
presente, testa esse issuer (pré-validação antes de salvar); quando ausente,
testa a configuração salva. Executa a validação anti-SSRF e em seguida o
discovery (`GET {issuer}/.well-known/openid-configuration`, timeout 5 s, sem
seguir redirects).

**Respostas**
- **200** — resultado estruturado (falha do provedor é resultado, não erro HTTP):

  ```json
  { "status": "ok | inacessivel | invalida",
    "detail": "mensagem em português",
    "discovered_endpoints": { "authorization_endpoint": "...", "token_endpoint": "...", "jwks_uri": "..." } }
  ```

  `discovered_endpoints` presente apenas com `status: "ok"`.
- **400** — issuer rejeitado pela validação de segurança (SSRF/HTTP) ou URL
  malformada — mesmo comportamento do PUT, para que o teste nunca alcance a rede
  interna.
- **404** — sem corpo e sem configuração salva.
- **401 / 403 / 429** — conforme regras gerais; rate limit obrigatório (o
  endpoint dispara requisições de rede a partir de URL fornecida).

## 4. `DELETE /orgs/{org_id}/oidc-config?confirm=true`

Exclui a configuração. `confirm=true` é obrigatório (a exclusão desativa o login
corporativo; identidades externas e contas são preservadas para eventual
reativação — edge case da spec).

**Respostas**
- **200** — `{ "detail": "Configuração OIDC excluída." }`. Botão de login
  corporativo some no próximo carregamento; login nativo, contas e vínculos
  intactos (FR-007).
- **400** — `confirm` ausente ou falso (a mensagem informa se existem identidades
  externas vinculadas ao issuer nesta org).
- **404** — não há configuração.
- **401 / 403** — conforme regras gerais.

**Auditoria**: `oidc_config_deleted`.

---

## Tabela de erros (resumo)

| Código | Quando |
|---|---|
| 400 | Issuer bloqueado (SSRF/HTTP), discovery falhou no PUT, ativação sem segredo, papel inválido, exclusão sem confirmação |
| 401 | Sem autenticação |
| 403 | Não é admin/maintainer da org (ou política de MFA/sessão da org não satisfeita) |
| 404 | Configuração inexistente |
| 422 | Payload malformado (validação Pydantic; inclui `client_secret: ""`) |
| 429 | Rate limit de mutação/teste por org |

## Contratos derivados (informativos, fora deste router)

- **Flag público de login**: `GET /orgs/slug/{slug}` (existente, público) passa a
  refletir "login corporativo disponível" = `enabled` desta config — contrato de
  exibição consumido pela página de login (feature `001`; padrão
  `apps/web/services/auth/authMethods.ts`). Nenhum outro campo desta tabela é
  público.
- **Contrato intra-API**: `get_active_oidc_config(org_id)` em
  `apps/api/src/services/auth/oidc_config.py` — consumido pelas features `001`
  (fluxo de login/validação de tokens) e `002` (política de provisionamento).
