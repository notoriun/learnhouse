# Contrato API ↔ BFF — provisionamento automático e destino pós-acesso

**Feature**: `009-auto-provisionamento-keycloak` | **Data**: 2026-08-07

Delta sobre o contrato da feature 001 (`specs/001-fundacao-oidc-keycloak/contracts/api-oidc.md`).
Só o que muda está aqui; tudo o que não é mencionado permanece exatamente como
naquele contrato — ordem de validação, códigos de erro, invariantes de sigilo de
token e o fato de que **nenhuma resposta destes endpoints chega ao navegador**
(o BFF do Next.js é o único consumidor, server-to-server; o navegador só vê 302).

Consumidor: `apps/web/app/api/auth/keycloak/{authorize,callback}/route.ts`.
Produtor: `apps/api/src/routers/keycloak_auth.py`.

## 1. `POST /api/v1/auth/keycloak/authorize`

### Corpo da requisição

| Campo | Tipo | Antes | Agora |
|-------|------|-------|-------|
| `org_slug` | string | obrigatório | obrigatório (inalterado) |
| `action` | `"login" \| "register"` | opcional, default `"login"` | inalterado |
| `redirect_to` | string \| null | opcional — caminho interno para onde voltar | **REMOVIDO** |

`redirect_to` sai do corpo, do registro do fluxo no Redis e da resposta do
callback. Motivo: o destino pós-acesso passa a ser derivado da organização do
fluxo, nunca de entrada do usuário (FR-007). Consequência de segurança: o vetor de
open redirect deixa de existir por construção, em vez de ser neutralizado por
sanitização — ver research.md D2.

**Compatibilidade**: campo desconhecido no corpo é ignorado pelo modelo Pydantic,
então um cliente desatualizado que ainda mande `redirect_to` não recebe erro — o
valor simplesmente não tem efeito. O BFF deste repositório é o único cliente e é
atualizado no mesmo PR.

### Resposta

Inalterada: `{ "authorization_url": string, "state": string }`.

## 2. `POST /api/v1/auth/keycloak/callback`

### Corpo da requisição

Inalterado: `{ "code": string, "state": string }`.

### Resposta de sucesso (200)

| Campo | Tipo | Antes | Agora |
|-------|------|-------|-------|
| `user` | objeto `UserRead` | presente | inalterado |
| `tokens.access_token` | string | presente | inalterado |
| `tokens.refresh_token` | string | presente | inalterado |
| `tokens.expiry` | inteiro (ms) | presente | inalterado |
| `redirect_to` | string | caminho interno sanitizado | **REMOVIDO** |
| `org_slug` | string | — | **NOVO**: slug da organização do fluxo |

`org_slug` é o slug da `Organization` que o router já resolveu a partir do fluxo
(o mesmo valor que o `authorize` recebeu). É sempre presente numa resposta 200 —
uma resposta de sucesso sem organização resolvida é impossível, porque a
resolução da organização acontece antes da troca do código.

Deliberadamente **ausente** da resposta: qualquer indicação de que a conta foi
criada agora (`outcome`). O destino é o mesmo nos três desfechos e a distinção
vive na auditoria (`SSO_PROVISIONED` / `SSO_LINKED` / `LOGIN`) — research.md D6.

### Respostas de erro

Inalteradas, incluindo `403 CONTA_NAO_ENCONTRADA`, que continua sendo a resposta
para toda recusa de admissão. O que muda é **quando** ela ocorre: identidade nova
sem conta local, no caminho do provedor da plataforma, deixa de cair aqui e passa
a ser admitida. As demais recusas (e-mail não verificado, domínio não permitido,
conta bloqueada, conflito de identidade, IdP de terceiro sem criação automática
habilitada) continuam produzindo exatamente o mesmo status, código e mensagem.

## 3. Regra de destino (responsabilidade do BFF)

A API **não** devolve URL nem caminho de destino. O BFF calcula:

```text
destino = getUriWithOrg(org_slug, '/')     # apps/web/services/config/config.ts
        resolvido contra publicOrigin(request)
```

Por que `'/'`: a área com menu é o grupo de rotas `(withmenu)` de
`apps/web/app/orgs/[orgslug]/`, e o caminho público que chega até lá é a raiz do
host da organização — o catch-all do proxy reescreve `/` para `/orgs/{slug}/`. O
caminho é sempre `/`; só o host varia.

Comportamento por modo de hospedagem:

| Tenancy | `getUriWithOrg(slug, '/')` server-side | Destino final |
|---------|----------------------------------------|---------------|
| `single` | `/` (relativo) | raiz do host que atendeu o callback → área com menu |
| `multi` | `{proto}{slug}.{domain}/` (absoluto) | subdomínio da organização → área com menu |

Invariantes que o BFF DEVE manter:

1. O destino é relativo, ou absoluto em host permitido por `publicOrigin`
   (o domínio configurado ou subdomínio dele). Qualquer outro resultado cai na
   raiz do host atual.
2. O destino NUNCA é `/home` (seletor de organizações) nem `/login`.
3. Os cookies de sessão continuam sendo gravados na mesma resposta 302, com as
   opções de `getCookieOptions` — em `multi` o domínio `.{topDomain}` é o que
   permite a travessia do ápice para o subdomínio sem perder a sessão.
4. Nenhum parâmetro de query vindo do provedor é repassado ao destino.

## 4. Política de admissão efetiva (interno da API)

Não é contrato entre apps, mas é a regra que decide o desfecho e está aqui para o
revisor achar num só lugar. Em `keycloak_callback`, antes de
`provision_federated_login`:

| Situação | Política aplicada |
|----------|-------------------|
| Sem linha de config de org (`config_row is None`) — provedor da própria plataforma | `auto_provision=True`, `allow_link_by_email=True`, `allowed_email_domains=[]`, `default_role_id=None` (→ papel 4) |
| Com linha de config de org (feature 004) | `get_provisioning_policy(db, org_id)` — inalterado: respeita `auto_provision_users` e `allowed_email_domains` da organização |

`allow_link_by_email=True` no primeiro caso preserva o comportamento já existente
de vincular identidade a conta local de mesmo e-mail verificado dentro da mesma
organização; o que passa a ser verdadeiro é `auto_provision`.

## 5. Contrato interno de provisionamento (feature 002) — sem mudança de assinatura

`provision_federated_login(db_session, request, claims, org, policy)` mantém
assinatura, os três tipos de resultado (`ProvisioningSuccess` com
`outcome ∈ {login, provisioned, linked}`, `ProvisioningDenied`,
`ProvisioningConflict`) e todos os invariantes — em especial:

1. Identidade chaveada por `(issuer, subject)`, nunca por e-mail.
2. Nenhum resultado negativo ou de conflito deixa escrita parcial.
3. Corrida perdida na criação re-seleciona a identidade vencedora e conclui como
   `login`.

A única mudança de comportamento interno é na derivação do nome de usuário: ele
passa a ser verificado como livre antes da criação, com sufixo determinístico em
caso de colisão, de modo que "username em uso por outro e-mail" deixe de virar
`ProvisioningConflict(dados_inconsistentes)` — research.md D3.
