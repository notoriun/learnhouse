# Quickstart de Validação: Logout Coordenado e Revogação de Sessão

**Feature**: `003-logout-revogacao` | **Date**: 2026-08-03

Pré-requisitos: features 001/002 operantes (login federado criando `upstream_session` e claim
`usid`); Keycloak de desenvolvimento com client confidencial, back-channel logout apontando
para `POST {API}/api/v1/auth/keycloak/backchannel-logout` e `post_logout_redirect_uri`
cadastrada; Redis e Postgres locais (`npx learnhouse dev`).

## Comandos de teste

```bash
# Suíte da API (flag de cobertura `api`) — novos testes desta feature
cd apps/api
uv run pytest src/tests/security/test_backchannel_logout.py -v
uv run pytest src/tests/security/test_upstream_refresh.py -v
uv run pytest src/tests/security/test_rp_logout.py -v

# Regressão dos caminhos que esta feature toca
uv run pytest src/tests/security/test_session_revocation.py src/tests/security/test_refresh_grace.py src/tests/security/test_remediation_auth_refresh.py src/tests/security/test_csrf.py -v

# Migração Alembic aplica e reverte limpa
uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
```

## Cenário 1 — Logout completo com SSO encerrado (US1 / SC-001)

1. Login via "Entrar com identidade corporativa"; confirmar sessão ativa.
2. Clicar "Sair". Esperado: navegação para `/api/auth/keycloak/logout` → redirect ao
   `end_session_endpoint` do Keycloak → retorno à página pública cadastrada.
3. Acessar uma página autenticada → deve exigir login.
4. Iniciar novo login corporativo → o Keycloak DEVE pedir credenciais (sem SSO silencioso).
5. Verificações: linha `upstream_session` com `status=revoked`, `revocation_reason=user_logout`;
   chave Redis `upstream_revoked:{usid}` presente; evento de auditoria `logout` com
   `method=rp_initiated`.

## Cenário 2 — Back-channel revoga por sid (US2 / SC-002)

1. Com sessão federada ativa, no admin do Keycloak: encerrar a sessão do usuário (ou executar
   logout em outro client do mesmo realm).
2. Esperado: Keycloak envia o logout token; API responde `200`; sessões locais com aquele `sid`
   revogadas imediatamente.
3. Próximo request autenticado do navegador → `401`; próximo refresh → `401` terminal → cookies
   limpos pelo BFF → tela de login.
4. Verificações: `status=revoked`, `revocation_reason=backchannel`; auditoria `session_revoked`
   com `origin=backchannel`; log `auth.backchannel outcome=accepted`.
5. Idempotência: reenviar o MESMO logout token (curl com o corpo capturado) → `200`, nenhum
   efeito novo, outcome `replayed`/`already_revoked`.
6. Negativo (SC-005): enviar logout token com assinatura inválida, `iss` errado, sem `events`
   ou com `nonce` → `400`, zero efeito sobre sessões, outcome `rejected_*`.

```bash
# Exemplo de teste manual do endpoint (token inválido deve dar 400)
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$API/api/v1/auth/keycloak/backchannel-logout" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "logout_token=invalid.jwt.value"   # esperado: 400
```

## Cenário 3 — Usuário desativado no Keycloak cai no SLA (US2 cenário 3)

1. Com back-channel DESABILITADO no client (para exercitar a garantia mínima), desativar o
   usuário no Keycloak.
2. Aguardar a próxima renovação da sessão local (ou forçar: expirar o `LH_access` e navegar).
3. Esperado: refresh chama o token endpoint upstream ANTES de rotacionar → `invalid_grant` →
   `401`; sessão encerrada; cookies limpos.
4. Verificações: `status=revoked`, `revocation_reason=upstream_denied`; auditoria
   `session_revoked` com `origin=upstream_denied`; log `auth.upstream outcome=upstream_denied`.
5. SLA: o encerramento ocorre no máximo até a próxima renovação — dentro do tempo configurado.

## Cenário 4 — Indisponibilidade transitória preserva a sessão (US3 / SC-004)

1. Com sessão federada ativa, derrubar o Keycloak (parar o container) — ou apontar o issuer
   para uma porta fechada em ambiente de teste.
2. Forçar renovações durante a indisponibilidade.
3. Esperado: refresh responde `503 UPSTREAM_UNAVAILABLE`; cookies NÃO são limpos (BFF só
   destrói sessão em 401/403); usuário continua navegando com o access token vigente; próxima
   renovação re-tenta com o MESMO refresh cookie (consumo do jti desfeito).
4. Subir o Keycloak de volta → a renovação seguinte sucede (`upstream_ok`) e rotaciona
   normalmente.
5. Rejeição definitiva ainda vence: com o provedor de volta e o usuário desabilitado, a
   renovação encerra a sessão (100% dos definitivos — SC-004).
6. TTL absoluto: simular indisponibilidade além do TTL máximo configurado
   (`LEARNHOUSE_OIDC_SESSION_MAX_HOURS` reduzido no teste) → sessão `expired`
   (`policy_ttl`), `401`, reautenticação exigida.

## Cenário 5 — Cookies limpos nas duas variantes (SC-003)

1. Em deployment multi-tenant (ou simulando `.{top_domain}`), autenticar e confirmar no
   DevTools os cookies `LH_access`/`LH_refresh`/`LH_session` (variantes host-only e
   domain-scoped conforme o modo).
2. Executar logout **nativo** (e-mail/senha → Sair) → inspecionar: zero cookies de sessão
   válidos remanescentes em ambas as variantes; comportamento idêntico ao atual (FR-010).
3. Executar logout **federado** (Sair em sessão SSO) → mesma inspeção: zero cookies em ambas
   as variantes, mesmo com o redirect ao Keycloak no meio do fluxo.
4. Logout com sessão já expirada (apagar `LH_access`, manter marcador) → conduz à página
   pública sem erro, cookies residuais limpos.
5. Auditar as respostas de rede do fluxo completo: nenhum token do provedor em corpo JSON
   acessível ao JavaScript.
