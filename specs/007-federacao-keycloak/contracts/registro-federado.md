# Contrato — Registro Federado e Bloqueios de Conta Federada (007)

## 1. API: `POST /api/v1/auth/keycloak/authorize` (alterado)

Corpo existente ganha campo opcional:

```json
{
  "org_slug": "default",
  "redirect_to": "/home",
  "action": "register"   // opcional; ausente ou "login" = comportamento atual
}
```

- `action: "register"` → `authorization_url` retorna o endpoint `registrations` do provedor
  com os **mesmos** parâmetros do login (client_id, redirect_uri, scope, state, nonce,
  PKCE S256). Nada mais muda na resposta.
- **Guarda FR-010**: `action: "register"` só é aceito quando o issuer da config efetiva do
  login da org **é o issuer global da plataforma** (um row da feature 004 apontando o mesmo
  issuer conta como plataforma; IdP de terceiro nunca casa). Caso contrário → `400 {code:
  "REGISTRO_NAO_DISPONIVEL"}`, mapeado pelo BFF ao tratamento de erro existente da tela de
  login. Nunca trocamos o path de um IdP de terceiro.
- Valores fora de `{"login", "register"}` → 422 (validação de schema).
- Org sem login corporativo ativo → mesmo erro do fluxo atual (sem vazamento de config).
- O callback (`POST /auth/keycloak/callback`) permanece **inalterado** — o retorno do
  registro é um authorization code normal processado pela admissão existente (FR-002).

## 2. BFF web: `GET /api/auth/keycloak/authorize` (alterado)

Query existente ganha `action=register` (opcional), repassado ao corpo da chamada à API.
Qualquer outro valor é ignorado (tratado como login). Erros seguem o mapeamento de códigos
existente na query da tela de login.

## 3. Bloqueios de conta federada (alterado)

`PATCH /api/v1/users/{user_id}/password` (troca de senha) e `PUT /api/v1/users/{user_id}`
(quando o `email` enviado difere do atual), para conta federada à plataforma (regra R1 do
data-model):

```json
HTTP 403
{
  "detail": {
    "code": "CONTA_FEDERADA",
    "message": "Sua conta é gerenciada pelo provedor de identidade corporativo. Altere senha e e-mail na central de conta.",
    "account_console_url": "https://<issuer>/account"
  }
}
```

- Contas não federadas: comportamento atual byte a byte (SC-006).
- Descoberta pública da central de conta para a UI (dica, fora do fluxo de erro):
  `GET /api/v1/instance/info` passa a incluir `account_console_url`
  (`<issuer>/account` quando o Keycloak da plataforma está ativo; `null` caso
  contrário). O front usa o cookie `LH_sso` como sinal de sessão federada.
- Demais campos do `PUT` (nome, bio, avatar…): editáveis normalmente para todos.
- O front (tela Security) exibe a mensagem e o link; nenhuma regra é duplicada no cliente
  (Princípio II) — o front pode *ocultar* os formulários como dica de UX, mas a autoridade é
  o 403 da API.

## 3b. API: `GET /auth/keycloak/status` (alterado)

Resposta ganha o campo `platform`:

```json
{ "enabled": true, "platform": true }
```

`platform: true` ⇔ o issuer da config efetiva do login da org é o issuer global da
plataforma (registro federado disponível). `false` para org com IdP próprio de terceiro.
Nenhum outro dado da config é exposto.

## 4. Front: tela de login (alterado)

- Condição de exibição do "Criar conta pela identidade corporativa": `status.enabled &&
  status.platform` (guarda FR-010 — o botão não aparece para org com IdP de terceiro).
- Destino: `/api/auth/keycloak/authorize?org=<slug>&action=register&redirect=/home`.
- O cadastro local continua exibido conforme os métodos de entrada da org (config existente).

## Invariantes de segurança

- PKCE, state e nonce idênticos ao login (mesmo código, mesmo storage de flow).
- Nenhum novo endpoint; nenhuma credencial administrativa em runtime (FR-009).
- `org_slug` validado como hoje (sem echo de entrada não sanitizada).
- Mensagens de erro do provedor nunca repassadas ao navegador (padrão da feature 001).
