# Research: Logout Coordenado e Revogação de Sessão

**Feature**: `003-logout-revogacao` | **Date**: 2026-08-03

Base: `spec.md` desta feature; documento-base (seções 4.2, 4.3, 8, 16); código real de sessão
do LearnHouse (`apps/api/src/routers/auth.py`, `apps/api/src/security/auth.py`,
`apps/web/app/api/auth/[...path]/route.ts`, `apps/web/components/Contexts/AuthContext.tsx`).

---

## R1. Onde armazenar o vínculo sid → sessões locais

**Decisão**: Ambos — tabela PostgreSQL `upstream_session` como fonte da verdade durável +
chave Redis `upstream_revoked:{usid}` como enforcement no hot path.

**Justificativa**: O back-channel precisa de busca por `(issuer, sid)` — isso exige um índice
consultável e durável; a auditoria e a operação (quantas sessões um usuário tem, quando foram
revogadas e por quê) exigem persistência que sobrevive a restart/flush do Redis. Mas o
enforcement por request não pode custar uma query Postgres: hoje `get_current_user` já
consulta Redis para o blocklist (`jwt_revoked_before:{user_id}` em
`apps/api/src/security/auth.py::_is_token_revoked_for_user`). A revogação por sessão espelha
exatamente esse padrão: ao revogar, grava-se a linha (durável, auditável) E a chave Redis com
TTL = vida do refresh (`JWT_REFRESH_TOKEN_EXPIRES`); `get_current_user` e `/auth/refresh`
checam a chave apenas quando o token carrega o claim `usid` (custo zero para sessões nativas).
O `/auth/refresh` — menos frequente — também confere o status da linha no Postgres, cobrindo o
caso de Redis esvaziado (mesma postura fail-open-com-backstop do blocklist atual).

**Alternativas rejeitadas**:
- *Só Redis*: perde a durabilidade exigida pela auditoria (FR-008) e o histórico de revogação;
  um flush do Redis apagaria o vínculo sid→sessão e o back-channel deixaria de encontrar o alvo.
- *Só Postgres*: uma query por request autenticado no hot path de `get_current_user`; foge do
  padrão de revogação existente sem ganho.
- *Sessões server-side completas (session store)*: reescreveria o modelo de sessão stateless
  (JWT) da plataforma inteira — muito além do escopo; o claim `usid` + tabela de vínculo obtém
  o mesmo efeito só para sessões federadas.

## R2. Cifragem do refresh upstream (e do ID token)

**Decisão**: Fernet (`cryptography` 49.0, já dependência do `apps/api`) com chave simétrica
mantida fora do banco, em variável de ambiente / cofre — mesma chave e mesma abordagem
definidas para o `client_secret` na feature `004-admin-config-oidc` (spec 004, FR-004: "cifrado
com chave mantida fora do banco"). Helpers de cifra/decifra centralizados (compartilhados entre
004 e 003), usados por `apps/api/src/services/auth/upstream_session.py`. O valor decifrado
nunca sai do processo da API: não aparece em resposta, log, auditoria ou frontend.

**Justificativa**: Documento-base §7.2 e §8 ("Secret criptografado e nunca devolvido…"); um
dump do banco não pode entregar refresh tokens upstream vivos (que valem uma sessão SSO
corporativa). Fernet dá AEAD autenticado com API mínima e já está instalada — nenhuma
dependência nova (Princípio V).

**Alternativas rejeitadas**:
- *Coluna em claro*: dump do banco = roubo de sessão corporativa; inaceitável (Princípio IV).
- *pgcrypto no banco*: a chave conviveria com os dados no mesmo sistema; a exigência é chave
  FORA do banco.
- *Hash em vez de cifra*: o refresh upstream precisa ser reapresentado ao Keycloak — hash não
  serve; cifragem reversível é requisito funcional.
- *KMS/HSM dedicado*: decisão de infraestrutura acima do escopo; a interface por env var já
  permite evoluir para cofre sem mudança de schema.

## R3. Validação do logout token do back-channel

**Decisão**: Validar o logout token como JWT assinado pelo issuer cadastrado, usando o JWKS já
descoberto/cacheado pelo serviço OIDC da feature 001 (`services/auth/keycloak_oidc.py`),
conferindo TODOS os itens abaixo antes de qualquer efeito:

1. Assinatura via JWKS (com tolerância a rotação de chave — refetch on unknown `kid`).
2. `iss` = issuer cadastrado da organização; `aud` contém o `client_id` configurado.
3. `iat` presente e recente (janela curta com clock skew da config); `exp` verificado quando
   presente (Keycloak emite).
4. Claim `events` contém a chave `http://schemas.openid.net/event/backchannel-logout`.
5. `sid` e/ou `sub` presentes (pelo menos um); Keycloak envia `sid` quando o back-channel está
   habilitado no client.
6. `nonce` AUSENTE (proibido pela especificação OIDC Back-Channel Logout — presença = rejeição).
7. `jti` registrado em Redis (`backchannel_jti:{jti}`, SET NX com TTL curto) apenas para
   telemetria de reprocessamento — ver idempotência no contrato.

Token inválido → HTTP 400, efeito zero sobre sessões, log estruturado do motivo (sem o token).
Token válido → revogar `upstream_session` por `(issuer, sid)`; sem `sid`, por `sub` (todas as
sessões upstream daquele subject no issuer). Sessão desconhecida/já revogada → HTTP 200
idempotente com registro.

**Justificativa**: SC-005 exige efeito zero de notificações inválidas em 100% dos testes
negativos; a spec OIDC Back-Channel Logout 1.0 define exatamente esse conjunto de claims. O
reuso do JWKS/discovery da feature 001 evita segundo caminho de validação (Princípio V).

**Alternativas rejeitadas**:
- *Aceitar por origem de rede (IP do Keycloak)*: frágil e inseguro atrás de proxies; a
  validação criptográfica é o padrão e independe de topologia.
- *Rejeitar replays de `jti` com 400*: um retry legítimo do Keycloak (200 perdido na rede)
  viraria falha; como logout token só REVOGA (nunca cria sessão), o reprocessamento idempotente
  com 200 é inofensivo e atende o edge case da spec ("processada de forma idempotente").

## R4. Ordem exata do refresh federado e ponto de integração no fluxo existente

**Decisão**: Inserir o ramo federado dentro do `GET /auth/refresh` existente
(`apps/api/src/routers/auth.py::refresh`), preservando todas as etapas atuais, nesta ordem:

1. *(existente)* rate limit → cookie `LH_refresh` → `decode_refresh_token` → `sub`→user →
   `password_changed_at` → blocklist `_is_token_revoked_for_user`.
2. **(novo)** Se o payload carrega `usid`: checar Redis `upstream_revoked:{usid}` → se
   revogada, 401 (outcome `upstream_revoked`).
3. *(existente)* Gate de uso único `_mark_refresh_jti_used` (SET NX). Perdedores concorrentes
   seguem para a grace window (`_get_refresh_grace`) e recebem o par já rotacionado — ou seja,
   **abas concorrentes NÃO geram chamadas upstream duplicadas**: só o vencedor do NX fala com o
   Keycloak.
4. **(novo — somente vencedor, somente sessão federada)** Carregar `upstream_session` por
   `usid`; validar status (`ativa`) e TTL máximo absoluto (R6). Chamar o token endpoint do
   Keycloak (`grant_type=refresh_token`, refresh upstream decifrado, timeout 5 s):
   - **Sucesso** → persistir o refresh upstream rotacionado (cifrado) e `last_refreshed_at`;
     seguir para o passo 5.
   - **Rejeição definitiva** (R5) → marcar a linha `revogada` (motivo `upstream_denied`),
     gravar `upstream_revoked:{usid}`, auditar, 401 (outcome `upstream_denied`). O BFF já
     trata 401 como terminal e limpa cookies (`isTerminalAuthFailure` em
     `apps/web/app/api/auth/[...path]/route.ts`).
   - **Falha transitória** (R5) → **desfazer o consumo do jti** (DELETE
     `refresh_used:{user_id}:{jti}`), NÃO rotacionar nada, responder 503 com código
     `UPSTREAM_UNAVAILABLE` (outcome `upstream_transient`). O BFF e o `AuthContext` já
     preservam a sessão em qualquer status ≠ 401/403 — o mesmo cookie será reapresentado na
     próxima tentativa. Nenhuma mudança de comportamento é necessária no cliente.
5. *(existente)* Rotação local: `carry_session_claims` (estendido para carregar `usid` junto
   de `amr`/`sorg`) → mint do novo par → `_store_refresh_grace` → cookies → resposta com
   tokens no corpo (espelhados pelo proxy).

Isso implementa FR-005 literalmente: upstream validado/renovado PRIMEIRO; a rotação do
artefato local só ocorre depois do sucesso upstream. O consumo do `jti` antes da chamada
upstream é apenas um lock de concorrência — e é revertido na falha transitória, então nenhum
token local é "queimado" sem rotação correspondente.

**Alternativas rejeitadas**:
- *Upstream antes do gate de `jti`*: cada aba concorrente dispararia sua própria chamada ao
  Keycloak com o MESMO refresh upstream — desperdício e, com rotação de refresh habilitada no
  realm, quebra da sessão upstream.
- *Endpoint de refresh separado para sessões federadas*: duplicaria rate limit, grace window,
  rotação e telemetria; o cliente teria que saber qual endpoint chamar. Um ramo condicional no
  chokepoint único é menor e cobre por construção (mesmo racional do
  `issue_session_or_challenge`).
- *Validar upstream de forma assíncrona/lazy (fora do refresh)*: violaria FR-005 e o SLA — a
  renovação local poderia suceder com upstream já revogado.

## R5. Classificação transitório vs definitivo

**Decisão**: Classificar pela resposta do token endpoint (RFC 6749 §5.2):

| Resposta do Keycloak | Classificação | Efeito |
|---|---|---|
| HTTP 400 com `error=invalid_grant` (refresh revogado/expirado, usuário desabilitado, sessão SSO encerrada) | **Definitiva** | Revogar sessão local imediatamente (401) |
| HTTP 400 com `error=invalid_client` / `unauthorized_client` (segredo rotacionado/config quebrada) | **Transitória** (erro de configuração, não do usuário) | Preservar sessão, 503; alertar operação — derrubar todos os usuários por um segredo errado seria auto-infligir um incidente |
| Timeout, erro de conexão/DNS, HTTP 5xx, 502/503/504 de gateway | **Transitória** | Preservar sessão, desfazer consumo do jti, 503 `UPSTREAM_UNAVAILABLE`, retry na próxima renovação |
| HTTP 429 | **Transitória** | Idem |
| Resposta 200 malformada (sem `refresh_token`/`access_token`) | **Transitória** | Idem, com log de anomalia |

Cada classificação emite outcome distinto no log estruturado (`upstream_denied` vs
`upstream_transient`) e, no caso definitivo, evento de auditoria `SESSION_REVOKED` com motivo
— exatamente a distinção exigida por FR-006/FR-009 e pelo dashboard do documento-base §16
("distinguindo falha transitória de credencial definitivamente inválida").

**Justificativa**: `invalid_grant` é a única resposta que afirma algo sobre a CREDENCIAL do
usuário; todo o resto fala sobre o serviço ou sobre a configuração. É o mesmo critério já
aplicado no BFF (`isTerminalAuthFailure`: só 401/403 destroem sessão) — a classificação
upstream espelha o padrão local existente.

**Alternativas rejeitadas**:
- *Qualquer 4xx = definitivo*: um `invalid_client` por segredo rotacionado derrubaria todas as
  sessões federadas da organização — o incidente que o risco "dependência excessiva do
  Keycloak" manda evitar.
- *Retry inline com backoff dentro do request*: seguraria o request do usuário; o retry natural
  é a próxima renovação (o cliente já re-tenta), dentro do TTL máximo absoluto.

## R6. TTL máximo absoluto

**Decisão**: Toda sessão federada tem vida máxima absoluta contada de
`upstream_session.created_at`, verificada no passo 4 do refresh (antes da chamada upstream).
Excedido o limite → linha marcada `expirada` (motivo `policy_ttl`), chave Redis gravada, 401.
O limite vem da configuração do provedor da organização (`OIDCProviderConfig`, feature 004 —
"tempos máximos permitidos"), com padrão global seguro de **24 horas** via env var
(`LEARNHOUSE_OIDC_SESSION_MAX_HOURS`) enquanto a config por organização não existir/definir.
Falha transitória não estende o limite: se a indisponibilidade upstream persistir além do TTL,
a sessão expira e o usuário reautentica quando o provedor voltar (cenário 3 da User Story 3).

**Justificativa**: FR-007 exige teto mesmo sem qualquer sinal do provedor — é o backstop para
back-channel desabilitado E upstream mudo. 24 h cobre a jornada de trabalho com folga e limita
a janela de uma sessão órfã a um dia; é configurável por política, como o SLA pendente do
plano exige.

**Alternativas rejeitadas**:
- *Reusar o TTL do refresh nativo (30 dias)*: janela de exposição inaceitável para sessão
  corporativa revogável.
- *TTL só no exp do refresh upstream do Keycloak*: depende de sinal do provedor — exatamente o
  que FR-007 manda não depender.

## R7. RP-Initiated Logout sem expor tokens ao JavaScript

**Decisão**: O logout federado é uma **navegação top-level** (não fetch):
`AuthContext.signOut` detecta sessão SSO (método de autenticação da sessão, já disponível ao
cliente como dica de UX) e faz `window.location.href = '/api/auth/keycloak/logout'`. A rota
BFF, no servidor: (1) chama `POST /auth/keycloak/logout` da API com os cookies (revogação
local + invalidação do refresh interno + obtenção da URL de logout); (2) limpa cookies nas
duas variantes (reuso de `appendClearAuthCookies`); (3) responde `302 Location:
{end_session_endpoint}?id_token_hint=...&post_logout_redirect_uri=...&client_id=...`. O ID
token usado como `id_token_hint` fica guardado cifrado na `upstream_session` (nunca no
navegador). Sessões nativas seguem o caminho atual intacto (fetch `POST /api/auth/logout` →
interceptação existente no catch-all → DELETE na API).

**Trade-off registrado**: o `id_token_hint` aparece na URL da navegação (histórico do
navegador/logs de proxy do Keycloak). Ele não é acessível ao JavaScript da aplicação, não entra
em estado React nem storage (mantendo o requisito da feature 001), e um ID token não é
credencial reutilizável (não se troca por acesso). Alternativa sem token — enviar apenas
`client_id` — força a tela de confirmação de logout do Keycloak, quebrando o fluxo de um
clique; adotá-la fica como fallback quando não houver ID token armazenado (sessões antigas).
