# Research: Administração da Configuração OIDC

**Feature**: `004-admin-config-oidc` | **Data**: 2026-08-03

Cada decisão abaixo foi tomada após inspeção do código real do repositório;
caminhos citados são relativos à raiz do repo.

## 1. Cifragem do `client_secret`

**Decisão**: Fernet (AES-128-CBC + HMAC) da biblioteca `cryptography==49.0.0` — já
instalada (`apps/api/pyproject.toml`, linha 38) e já usada exatamente para este fim
em `apps/api/src/services/webhooks/crypto.py` (`encrypt_secret`/`decrypt_secret`,
chave de 32 bytes derivada por SHA-256 de
`security_config.auth_jwt_secret_key`, que vem da env var
`LEARNHOUSE_AUTH_JWT_SECRET_KEY` com validação de entropia mínima em
`apps/api/config/config.py`). Reutilizar essas funções (import direto do módulo de
crypto; promover para `src/services/security/crypto.py` é opcional e pode ser feito
quando um terceiro consumidor surgir). A chave nunca toca o banco — atende FR-004 e
a premissa da spec ("variável de ambiente ou cofre de segredos").

**Justificativa**: dependência existente + padrão existente no próprio codebase
(Princípio V). Zero env vars novas para a operação.

**Limitação assumida** (documentar no runbook): rotacionar a JWT secret invalida os
ciphertexts — os segredos OIDC precisam ser recadastrados, mesma limitação já aceita
para os segredos de webhook. Como a única operação sobre o segredo é a substituição
(FR-005), a recuperação é trivial.

**Alternativas rejeitadas**:
- *Env var dedicada (`LEARNHOUSE_OIDC_ENCRYPTION_KEY`)*: mais um segredo para
  provisionar em toda instância self-hosted; adicionar apenas quando rotação de
  chave independente da JWT secret virar requisito real.
- *Vault/KMS externo*: serviço novo — decisão de nível constitucional (Stack), não
  de feature.
- *pgcrypto*: a chave apareceria em queries/logs do Postgres e dentro do banco —
  viola FR-004.
- *authlib / python-jose*: não instaladas; não fazem cifragem em repouso.

## 2. Validação anti-SSRF do issuer

**Decisão**: extrair para `apps/api/src/services/security/url_validation.py` uma
versão do validador já existente
`_validate_webhook_url` (`apps/api/src/services/webhooks/webhooks.py:40-71`):
`urlparse` → `socket.getaddrinfo` → `ipaddress.ip_address` rejeitando
`is_private | is_loopback | is_link_local | is_reserved` (acrescentar
`is_multicast | is_unspecified`). Diferenças em relação aos webhooks:

- **HTTPS obrigatório** salvo quando `general_config.development_mode` é verdadeiro
  (env `LEARNHOUSE_DEVELOPMENT_MODE`; mesmo padrão de exceção usado em
  `src/security/csrf.py` e `src/services/email/utils.py`) — cobre FR-003.
- O endpoint de metadata de nuvem (`169.254.169.254`, `metadata.google.internal`)
  cai no bloqueio de link-local via resolução DNS — o validador resolve o hostname
  ANTES de aceitar, então nomes internos que resolvem para faixas bloqueadas são
  rejeitados.
- No teste de conexão/discovery, requisição com `follow_redirects=False` — um
  provedor que redireciona o discovery para dentro da rede é tratado como
  configuração inválida, fechando o vetor de redirect pós-validação (TOCTOU).
- Mensagens de erro em pt-BR (FR-006), sem ecoar endereços resolvidos internos.

**Allowlist opcional de issuers**: NÃO no primeiro release. A spec a marca como
opcional e nenhuma org demandou; a estrutura da função aceita esse parâmetro no
futuro sem migração.

**Alternativas rejeitadas**:
- *Reusar `_validate_webhook_url` diretamente*: permite `http://` em produção
  ("for local testing") — insuficiente para FR-003; a extração compartilhada
  permite que os webhooks migrem depois.
- *Validação apenas sintática (regex/lista de IPs literais)*: não pega hostnames
  internos que resolvem para faixas privadas — exatamente o vetor do plano
  (documento-base, §8, risco "SSRF").
- *Biblioteca externa (ex.: `advocate`)*: dependência nova para ~30 linhas que o
  repo já tem prontas.

## 3. Onde vive a política de provisionamento (contrato com a feature 002)

**Decisão**: na própria tabela `oidc_provider_config` — campos
`allowed_email_domains`, `auto_provision_users`, `default_role_id`, `required_acr`,
`clock_skew_seconds` (conforme documento-base §7.2). O contrato de consumo é uma
função de serviço interna à API:
`get_active_oidc_config(org_id) -> OIDCProviderConfig | None` em
`apps/api/src/services/auth/oidc_config.py`, usada pela feature `001` (montar
authorize/callback, validar tokens com `clock_skew`/`required_acr`) e pela feature
`002` (decidir admissão: domínio permitido, auto-provisionamento, papel padrão).
Não é endpoint — é contrato intra-API, dentro da mesma fronteira (Princípio I).

**Alternativas rejeitadas**:
- *Blob JSON de `OrganizationConfig`* (`apps/api/src/db/organization_config.py`):
  esse config é servido pelo endpoint público `GET /orgs/slug/{slug}` (a própria
  docstring de `SignupFieldItem` avisa: "labels ... are PUBLIC strings") — colocar
  ciphertext e política ali arriscaria vazamento estrutural; além disso JSON não dá
  UNIQUE por org nem FK para `role.id`.
- *Tabela separada de política*: relação 1:1 com o provedor; join e migração a mais
  sem benefício.

## 4. Padrão de formulário admin no frontend

**Decisão**: novo componente
`apps/web/components/Dashboard/Pages/Org/OrgEditAuthSettings/OrgEditAuthSettings.tsx`,
seguindo a forma dos componentes reais de settings da org
(`OrgEditGeneral/`, `OrgEditBranding/`, `OrgEditDomains/`, `OrgEditSSO/` em
`apps/web/components/Dashboard/Pages/Org/`): `useOrg` + `useLHSession` para
contexto/token, componentes `@components/ui/{input,button,label,switch,select}`,
`react-hot-toast` para feedback e `useTranslation` para i18n (strings pt-BR). Novo
cliente REST `apps/web/services/auth/oidcAdmin.ts` no padrão de
`apps/web/services/auth/sso.ts`.

**Restrição importante**: `OrgEditSSO.tsx` existente é gate-ado por
`<FeatureGate feature="sso">` e chama endpoints de `@services/auth/sso` que **não
existem** na API OSS (`apps/api/src/routers/` não tem router de SSO) — são do
módulo Enterprise, cujo uso é proibido pela diretriz do documento-base. O
`OrgEditAuthSettings` é código novo, AGPL, sem `FeatureGate`, servido pelos
endpoints desta feature. Segredo na UI: campo write-only tipo password, exibido
como "segredo configurado" (`secret_configured`) com ação única "substituir".

**Remoção do botão de login** (FR-007/SC-005): a página de login decide o que
renderizar a partir do payload público da org, como já faz
`apps/web/services/auth/authMethods.ts` (`getAllowedAuthMethods` lê
`GET /orgs/slug/{slug}`); a feature `001` expõe nesse payload o flag público
"login corporativo disponível", que reflete `enabled` desta config — desativar aqui
remove o botão no próximo carregamento, sem tocar contas ou vínculos.

**Alternativa rejeitada**: estender `OrgEditSSO.tsx` — acoplaria o núcleo AGPL a
contratos Enterprise e ao gate `sso`.

## 5. Teste de conexão (discovery) com timeout e distinção de erros

**Decisão**: `httpx==0.28.1` (já instalado) com
`GET {issuer_url}/.well-known/openid-configuration`,
`timeout=httpx.Timeout(5.0)`, `follow_redirects=False`, executado **após** a
validação anti-SSRF. Classificação do resultado (FR-006, mensagens pt-BR):

| Condição | Resultado |
|---|---|
| Timeout, erro de conexão/DNS, 5xx | `inacessivel` — "Provedor inacessível — verifique o endereço e a disponibilidade do provedor." |
| 4xx, corpo não-JSON, campos obrigatórios ausentes (`issuer`, `authorization_endpoint`, `token_endpoint`, `jwks_uri`) | `invalida` — "Configuração inválida — o endereço não expõe uma descoberta OIDC válida." |
| `issuer` do documento ≠ `issuer_url` configurado | `invalida` (exigência do OIDC Discovery — evita provedor impostor) |
| Redirect (3xx) | `invalida` (redirects não seguidos por segurança) |
| 200 + documento coerente | `ok` + endpoints descobertos (sem dados sensíveis) |

A mesma rotina roda no salvar (FR-003 exige descoberta bem-sucedida antes de
persistir o issuer) e no endpoint `POST .../test`. Falha do provedor no teste é
**resultado 200 estruturado**, não erro HTTP — erro HTTP fica reservado a entrada
inválida/bloqueada. O teste de conexão recebe rate limit por org (padrão de
`src/services/security/rate_limiting.py`), pois é um oráculo de rede acionado por
URL arbitrária, ainda que restrito a admins.

**Alternativas rejeitadas**: `authlib` (não instalada; discovery é um GET + 4
verificações); aceitar salvar sem discovery (viola FR-003); seguir redirects no
discovery (reabre SSRF pós-validação).

## 6. Auditoria das mudanças de configuração

**Decisão**: reutilizar o mecanismo durável existente —
`record_audit_event` (`apps/api/src/services/audit/audit.py`) gravando em
`user_audit_event` (`apps/api/src/db/user_audit_events.py`) — com novos
`event_type`: `oidc_config_created`, `oidc_config_updated`,
`oidc_config_activated`, `oidc_config_deactivated`, `oidc_config_deleted`,
`oidc_config_secret_rotated`. `audit_metadata` carrega a **lista de nomes** dos
campos alterados (nunca valores de segredo; para o segredo registra-se apenas o
evento de rotação) + autor/momento/IP já capturados pelo mecanismo (FR-008).

**Atenção (extensão deliberada de escopo)**: a docstring atual de
`record_audit_event` e de `UserAuditEventType` restringe o log a ações de
APRENDIZ ("Do not call from authoring/admin paths"). Esta feature amplia esse
escopo — a docstring e a classe de tipos devem ser atualizadas no mesmo PR para
registrar a decisão, evitando que um revisor trate o uso como engano.

**Alternativa rejeitada**: nova tabela `admin_audit_event` — segunda infraestrutura
de auditoria para meia dúzia de eventos; criar apenas se o volume/retention de
eventos administrativos divergir do log atual.

## 7. Descarte da tabela órfã `ssoconnection`

**Contexto**: a migração
`apps/api/migrations/versions/a1b2c3d4e5f6_add_sso_connection.py` criou a tabela
`ssoconnection` sem modelo SQLModel correspondente e sem nenhum consumidor em
`apps/api/src` (órfã confirmada por busca no código), e com
`auto_provision_users` `server_default=TRUE` — o oposto do padrão restritivo
(provisionamento fechado por padrão) exigido por esta feature.

**Decisão** (coordenada com a feature `002-identidade-provisionamento`): esta
feature é a dona do armazenamento da política de provisionamento; a mesma
migração que cria `oidc_provider_config` faz o DROP de `ssoconnection` (o
`downgrade()` recria ambas as estruturas).

**Justificativa**: tabela sem dados de produção possíveis (nunca consumida por
código algum), default perigoso (`auto_provision_users=TRUE`), e a nova tabela
`oidc_provider_config` cobre integralmente o caso de uso.

**Alternativa rejeitada**: reaproveitar `ssoconnection` invertendo o default —
herdaria um esquema não desenhado para os requisitos atuais (sem UNIQUE por org,
sem FK de papel padrão, sem campos de política/cifragem no formato exigido).
