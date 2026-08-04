# Runbook Operacional — Logout Coordenado e Revogação (feature 003)

Procedimentos para operar o logout federado e a revogação de sessão. Observação:
não substitui a política de segurança da organização.

## Telemetria (outcomes fechados)

Dois loggers estruturados, uma linha por tentativa (sem tokens/segredos):

- `learnhouse.auth.upstream` — refresh federado: `upstream_ok`,
  `upstream_transient`, `upstream_denied`, `upstream_revoked`, `ttl_exceeded`.
- `learnhouse.auth.backchannel` — back-channel logout: `accepted`,
  `unknown_session`, `already_revoked`, `replayed`, `rejected_signature`,
  `rejected_claims`.

## Indisponibilidade do provedor (Keycloak fora do ar)

**Sintoma**: aumento sustentado de `upstream_transient` no logger
`learnhouse.auth.upstream`; usuários federados recebem 503 `UPSTREAM_UNAVAILABLE`
em algumas renovações.

**Impacto esperado**: sessões ativas são PRESERVADAS (a renovação transitória
não rotaciona nada e não derruba o usuário); o BFF mantém a sessão em respostas
com status ≠ 401/403. Novos logins federados falham enquanto o provedor não
volta (o login nativo continua funcionando).

**Ação**: verificar a saúde do Keycloak (discovery/token endpoint). Nenhuma ação
na aplicação é necessária — a recuperação é automática quando o provedor volta.
O teto é o TTL máximo absoluto (`LEARNHOUSE_OIDC_SESSION_MAX_HOURS`, padrão 24 h):
indisponibilidade prolongada além desse limite expira a sessão (`ttl_exceeded`),
e a falha transitória NUNCA estende o limite.

## Rotação da chave Fernet ou do segredo do client

**Contexto**: o refresh upstream e o ID token são cifrados com Fernet (chave
derivada de `LEARNHOUSE_AUTH_JWT_SECRET_KEY`, fora do banco). O segredo do client
OIDC é o `client_secret` da configuração (feature 004).

**Sintoma de segredo do client incorreto/rotacionado sem atualizar**: o token
endpoint responde `invalid_client`, classificado como **transitória**
(`upstream_transient`) — de propósito: um segredo errado NÃO deve derrubar todos
os usuários; ele impede renovações até a correção.

**Ação**: atualizar o segredo na configuração OIDC da organização (feature 004) e
confirmar que `upstream_transient` volta a `upstream_ok`. Se a chave Fernet
(`LEARNHOUSE_AUTH_JWT_SECRET_KEY`) for rotacionada, os refresh tokens upstream
cifrados com a chave antiga tornam-se indecifráveis — sessões federadas exigirão
novo login; planejar a rotação para janela de baixo uso.

## Alertas recomendados (documento-base §16)

- **Aumento de `upstream_denied`**: possível revogação em massa no provedor
  (desligamentos, incidente). Correlacionar com ações administrativas no Keycloak.
- **`upstream_transient` sustentado**: indisponibilidade do provedor (ver acima).
- **Qualquer taxa de `rejected_signature`/`rejected_claims`**: tentativas de
  forjar logout token (back-channel). Investigar origem; a validação criptográfica
  já rejeita com efeito zero sobre sessões, mas a taxa é sinal de ataque.
- **`replayed` recorrente**: reprocessamento do mesmo logout token — normalmente
  benigno (retry do provedor), mas monitorar volume.
