# Contratos: Logout Coordenado e Revogação de Sessão

**Feature**: `003-logout-revogacao` | **Date**: 2026-08-03

Contratos entre apps (Princípio I) definidos antes da implementação. Sem código — apenas
rotas, corpos, validações e respostas. Prefixo real da API: `/api/v1`; rotas BFF servidas pelo
Next.js em `/api/*`.

---

## 1. Rotas BFF de logout (`apps/web`)

### 1.1 `POST /api/auth/logout` — logout local (existente, inalterado)

Interceptada pelo catch-all `apps/web/app/api/auth/[...path]/route.ts`. Comportamento mantido
(FR-010): best-effort `DELETE {API}/api/v1/auth/logout` com o cookie `LH_refresh`; limpeza de
`LH_access`, `LH_refresh`, `LH_custom_domain` (httpOnly) e `LH_session`, `LH_org` (marcadores)
nas **duas variantes** (host-only e `.{top_domain}`); resposta `200 {"ok": true}`. Usada pelo
`AuthContext.signOut` para sessões nativas (password, google, magic_login).

### 1.2 `GET /api/auth/keycloak/logout` — logout federado (nova; navegação top-level)

O navegador **navega** para esta rota (não é fetch). Query opcional: `redirect` (caminho
interno de fallback, sanitizado pelas regras existentes de redirect seguro).

Passos do servidor BFF:
1. Encaminha `POST {API}/api/v1/auth/keycloak/logout` com os cookies de sessão e os headers de
   identidade do cliente (`x-forwarded-for`, `x-real-ip`, `user-agent`), timeout curto.
2. Limpa os cookies de sessão nas duas variantes (mesma lista/mecânica da rota 1.1) —
   **sempre**, mesmo se a API falhar ou a sessão já estiver expirada.
3. Resposta:
   - API retornou `end_session_url` → `302 Location: {end_session_url}`.
   - API não retornou URL (sessão nativa, sem ID token armazenado, sessão já expirada) ou
     falhou → `302` para destino interno seguro (`redirect` sanitizado ou `/`).

Regras: nenhuma resposta desta rota contém tokens; `Cache-Control: no-store`; logout com
sessão já expirada conduz à página pública sem erro (edge case da spec).

---

## 2. API — logout federado (`apps/api`)

### 2.1 `POST /api/v1/auth/keycloak/logout`

**Autenticação**: cookies de sessão (`LH_access`/`LH_refresh`) ou bearer. Sessão ausente ou
expirada → ainda responde `200` com `end_session_url: null` (logout deve ser sempre concluível).

**Efeitos (nesta ordem — FR-001: revogação ANTES de qualquer redirecionamento)**:
1. Revoga todas as sessões do usuário: `revoke_user_sessions_before(user_id)` (blocklist Redis
   existente — mesmo alcance do logout local atual, todos os dispositivos).
2. Se o token da sessão carrega `usid`: marca a `upstream_session` como `revoked`
   (motivo `user_logout`), grava `upstream_revoked:{usid}`, anula os campos cifrados após uso.
3. Monta a URL de RP-Initiated Logout com o `end_session_endpoint` do discovery:
   `id_token_hint` (ID token decifrado da sessão; se ausente, usa `client_id` — o Keycloak
   exibirá confirmação), `post_logout_redirect_uri` (**somente** valor previamente cadastrado
   na configuração do provedor; nunca derivado de entrada do usuário) e `client_id`.
4. Auditoria: evento `logout` com `{"method": "rp_initiated", ...}`; sem tokens.

**Resposta `200`**:

```json
{ "end_session_url": "https://kc.example.com/realms/x/protocol/openid-connect/logout?...", "revoked": true }
```

`end_session_url: null` quando a sessão não é federada ou não há como montar a URL. Nenhum
outro dado. `Cache-Control: no-store`.

### 2.2 `POST /api/v1/auth/keycloak/backchannel-logout`

Endpoint server-to-server chamado pelo **Keycloak** (Backchannel Logout URL do client). Não
autenticado por sessão — a autenticidade é a assinatura do logout token.

**Requisição**: `Content-Type: application/x-www-form-urlencoded`, corpo:

```
logout_token=<JWT assinado pelo issuer>
```

**Validação (todas obrigatórias; qualquer falha → 400 sem efeito — SC-005)**:
1. JWT com assinatura válida via JWKS do issuer (cache da feature 001; refetch em `kid`
   desconhecido).
2. `iss` corresponde a um issuer cadastrado e ativo; `aud` contém o `client_id` configurado.
3. `iat` dentro da janela aceitável (clock skew configurado); `exp` verificado quando presente.
4. `events` contém `http://schemas.openid.net/event/backchannel-logout`.
5. Presente ao menos um entre `sid` e `sub`; `nonce` ausente (presença → 400).

**Efeitos (token válido)**:
- Com `sid`: localizar `upstream_session` ativas por `(issuer, sid)` → marcar `revoked`
  (motivo `backchannel`), gravar `upstream_revoked:{usid}` de cada uma.
- Sem `sid` (só `sub`): localizar a identidade externa por `(issuer, sub)` e revogar todas as
  `upstream_session` ativas do usuário naquele issuer.
- Auditoria `session_revoked` (`origin: "backchannel"`, `sessions_affected: n`); log
  estruturado `auth.backchannel outcome=accepted`.

**Idempotência**: sessão desconhecida, já revogada ou logout token reprocessado (mesmo `jti`)
→ `200` sem novo efeito, com outcome `unknown_session` / `already_revoked` / `replayed`
registrado. Logout token só revoga — reprocessar nunca cria estado.

**Respostas**:

| Status | Quando | Corpo |
|---|---|---|
| `200` | Revogado, ou no-op idempotente | vazio |
| `400` | Token ausente/malformado/assinatura ou claims inválidos | vazio (sem detalhe que ajude um forjador) |

Rejeições (`400`) geram registro em log estruturado de auditoria operacional
(`auth.backchannel outcome=rejected_signature | rejected_claims`) + Sentry, sem atribuição de
usuário e sem tokens ou segredos (FR-008); não geram evento durável em `user_audit_event`.

Headers: `Cache-Control: no-store`. Sem redirect, sem cookies. Rate limit defensivo aplicável
sem afetar o SLA (tráfego legítimo é esporádico).

---

## 3. Contrato do fluxo de refresh alterado

### `GET /api/v1/auth/refresh` (existente — comportamento estendido)

Contrato atual preservado para sessões nativas (mesmas respostas 200/401/429, rotação com
grace window, tokens espelhados no corpo para o proxy). Extensão para tokens que carregam o
claim `usid` (sessões federadas):

**Ordem de avaliação** (FR-005 — upstream primeiro, rotação local depois):
1. Etapas existentes: rate limit → cookie → decodificação → usuário → `password_changed_at` →
   blocklist por usuário.
2. **Nova**: `usid` presente em `upstream_revoked:{usid}` → `401` (sessão revogada por
   logout/back-channel/política).
3. Gate de uso único do `jti` (existente). Requisições concorrentes com o mesmo `jti` dentro
   da grace window recebem o par já rotacionado — **uma única** interação upstream por rotação.
4. **Nova (somente o vencedor do gate)**: carregar a `upstream_session`; verificar status
   `active` e TTL máximo absoluto (`created_at` + política — excedido → sessão `expired`,
   `401`); validar/renovar no token endpoint do Keycloak.
5. Rotação local (existente), com `usid` carregado para o novo par junto de `amr`/`sorg`.

**Novas respostas / semântica**:

| Status | Código | Significado | Ação do cliente (BFF/AuthContext — já implementada) |
|---|---|---|---|
| `200` | — | Upstream validado/renovado + par local rotacionado | Espelhar cookies (inalterado) |
| `401` | `Invalid credentials` | Rejeição **definitiva**: `invalid_grant` upstream, sessão revogada (`usid`), TTL excedido — além dos motivos atuais | Terminal: limpar cookies, voltar ao login (comportamento existente `isTerminalAuthFailure`) |
| `503` | `UPSTREAM_UNAVAILABLE` | Falha **transitória** do provedor (timeout, 5xx, rede, `invalid_client`). Consumo do `jti` desfeito; nenhum artefato rotacionado; o MESMO refresh cookie permanece válido | Preservar sessão; nova tentativa na próxima renovação (comportamento existente para status ≠ 401/403) |
| `429` | `RATE_LIMITED` | Existente, inalterado | Existente |

**Invariantes**:
- Rejeição definitiva NUNCA é respondida como 503; falha transitória NUNCA como 401 (FR-006).
- Em 503, nenhum estado muda: linha `active`, refresh local não consumido, refresh upstream
  não rotacionado.
- Toda tentativa emite exatamente um outcome estruturado (conjunto fechado — data-model.md,
  seção Observabilidade).
- Sessões nativas (sem `usid`): zero mudança de contrato e de latência.

### Contrato entre features (fronteira 001/002 → 003)

O login federado (features 001/002) DEVE, ao emitir a sessão interna: criar a linha
`upstream_session` (com `issuer`, `sid` do ID token, refresh upstream e ID token cifrados) e
estampar o claim `usid` nos tokens locais. Esta feature (003) consome esse vínculo; sem ele
(sessão anterior à feature), o refresh trata a sessão como nativa até o próximo login.
