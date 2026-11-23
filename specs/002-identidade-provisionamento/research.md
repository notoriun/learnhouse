# Research: Identidade Externa, Linking e Provisionamento

**Feature**: `002-identidade-provisionamento` | **Date**: 2026-08-03

Cada decisão abaixo cita o código real do repositório que a fundamenta.

## 1. Unicidade issuer + subject: constraint composta no banco

**Decisão**: `UniqueConstraint("issuer", "subject")` na tabela `externalidentity`, criada na
migração Alembic. A aplicação NÃO faz "check-then-insert" como mecanismo de unicidade; ela
insere e trata `IntegrityError` como corrida perdida (re-selecionar a linha vencedora e
prosseguir com login normal).

**Justificativa**: Princípio V da constituição (preferir constraint de BD a código); dois
callbacks concorrentes do mesmo `subject` (duas abas completando login) são a corrida real, e
só a constraint fecha essa janela. Precedente no repo:
`apps/api/migrations/versions/f1a2b3c4d5e6_unique_certificateuser_user_certification.py` e o
índice único `ix_ssoconnection_org_id`.

**Alternativas rejeitadas**:
- Verificação apenas em código (SELECT antes do INSERT): janela de corrida entre requests;
  exatamente o defeito que a constraint elimina de graça.
- Unicidade por organização (`issuer, subject, org_id`): a identidade federada pertence à
  pessoa, não à organização — o mesmo `sub` no mesmo `iss` é sempre a mesma pessoa (ADR-05).
  Escopo por org permitiria duas contas locais para a mesma pessoa, o defeito que a spec
  proíbe (SC-003).

## 2. Normalização de issuer

**Decisão**: persistir o `iss` exatamente como validado criptograficamente pela feature 001
(comparação byte a byte com o `issuer_url` configurado), após normalização mínima aplicada
uma única vez no ponto de configuração: HTTPS obrigatório, host em minúsculas, sem barra
final, sem query/fragment. A comparação em runtime é igualdade estrita de string.

**Justificativa**: OIDC Discovery já exige que o `iss` do token seja idêntico ao issuer do
documento de discovery; qualquer normalização "esperta" em runtime (case-folding de path,
resolução de redirects) cria ambiguidade explorável. Normalizar na escrita da configuração e
comparar estritamente é o comportamento mais simples e o mais seguro.

**Alternativas rejeitadas**:
- Armazenar o issuer livre, comparar com normalização em cada login: duplicaria a regra em
  todos os pontos de leitura e abriria divergência entre gravação e comparação.
- Hash do issuer como chave: opaco, dificulta auditoria e revisão administrativa sem ganho.

## 3. Estratégia de linking: ordem de verificação e transação

**Decisão**: ordem estrita (FR-003), implementada em
`apps/api/src/services/auth/provisioning.py`:

1. `SELECT ExternalIdentity WHERE issuer = :iss AND subject = :sub` → achou: login na conta
   vinculada (atualiza `last_login_at`); usuário local desativado/bloqueado → negar sem
   recriar nada.
2. Não achou → `email_verified` do claim é `true`? Não → negar (`email_nao_verificado`),
   nenhuma escrita.
3. Domínio do e-mail permitido pela política? Não → negar (`dominio_nao_permitido`) com
   auditoria.
4. Existe conta local com o mesmo e-mail? Busca case-insensitive
   (`func.lower(User.email) == email`, mesmo padrão de `signWithGoogle` em
   `apps/api/src/services/auth/utils.py:151-153`, que existe justamente porque signup local
   não normaliza caixa).
   - Existe E política permite associação por e-mail E a conta pertence ao contexto da
     organização sem ambiguidade → vincular (criar `ExternalIdentity`, garantir membership).
   - Existe mas política não permite, ou a conta está em outra organização, ou já há outra
     identidade externa nesse usuário para o mesmo issuer → **conflito**: interromper sem
     escrita de vínculo, auditar para revisão administrativa (FR-005). Prosseguir com
     auto-provisionamento aqui é impossível de qualquer forma: `create_user` rejeita e-mail
     duplicado (`apps/api/src/services/users/users.py:252-262`).
5. Não existe conta → `auto_provision` ligado? Não → negar (`auto_provision_desativado`);
   sim → provisionar (item 5 abaixo) e criar a `ExternalIdentity`.

Sobre transação: `create_user` faz commits internos próprios (usuário, depois membership —
`users.py:274-290`). Em vez de refatorá-lo para participar de uma transação externa (mudança
invasiva num caminho crítico de signup), a atomicidade da *decisão* é garantida pela
constraint única do item 1: se dois logins concorrentes do mesmo `subject` provisionarem em
paralelo, o segundo INSERT de `ExternalIdentity` falha na constraint, e o perdedor
re-seleciona e entra na conta do vencedor. Sobra, no pior caso, um usuário órfão sem
identidade — mesmo perfil de risco do fluxo Google atual, aceito conscientemente.

**Alternativas rejeitadas**:
- Transação única envolvendo `create_user`: exigiria remover os commits internos de uma
  função usada por signup nativo, convite e OAuth Google — risco de regressão alto para
  proteger uma corrida que a constraint já resolve.
- Lock distribuído (Redis) por `issuer+subject`: infraestrutura nova para o mesmo resultado
  que a constraint dá de graça.

## 4. Política padrão restritiva

**Decisão**: `ProvisioningPolicy` com defaults: `auto_provision=False`,
`allow_link_by_email=False`, `allowed_email_domains=[]` (lista vazia = sem restrição de
domínio — a restrição é opt-in), `default_role_id=None` (cai no papel padrão de menor
privilégio da plataforma). Interface definida em `data-model.md`. **Backing store (decisão
coordenada com a feature 004, final)**: a feature 004 é a DONA do armazenamento da política —
tabela `oidc_provider_config`, criada pela migração da 004. Esta feature lê a política
exclusivamente pela interface `ProvisioningPolicy`, com leitura fail-closed: ausência de
configuração (ou erro de leitura) resulta nos defaults restritivos acima.

**Justificativa**: a spec assume padrão restritivo até configuração explícita (Assumptions).
A semântica "lista vazia = sem restrição" segue o padrão já estabelecido em
`apps/api/src/services/orgs/auth_policy.py` (`OrgAuthPolicy.method_restricted`: lista vazia
não restringe, para que um mis-save não tranque todo mundo) — aqui o análogo é: com
`auto_provision=False` por padrão, a lista de domínios só passa a importar quando o admin
ligou o provisionamento deliberadamente.

**Sobre a tabela órfã `ssoconnection`**: a migração órfã
`apps/api/migrations/versions/a1b2c3d4e5f6_add_sso_connection.py` criou a tabela
`ssoconnection` com `auto_provision_users` `server_default=TRUE` — o oposto do padrão
restritivo — e não existe nenhum modelo SQLModel nem serviço que a leia (grep confirma: o
único hit é a própria migração). DECISÃO FINAL: a `ssoconnection` NÃO será reaproveitada.
A migração da feature 004 fará o DROP dessa tabela órfã (documentado lá) junto com a criação
da `oidc_provider_config`. Esta feature NÃO toca a `ssoconnection` em nenhuma migração ou
código.

**Alternativas rejeitadas**:
- Guardar a política no blob `OrganizationConfig` (como `allowed_auth_methods` hoje): evitaria
  migração, mas a política referencia `default_role_id` (FK) e será editada pela tela da
  feature 004 junto com issuer/client — pertence à configuração OIDC, não ao blob genérico.
- `auto_provision=True` por padrão (comportamento da tabela órfã): viola a premissa da spec.

## 5. Reúso da criação de usuário e vínculo com organização

**Decisão**: provisionar chamando `create_user(request, db_session, current_user,
user_object, org_id, is_oauth=True, signup_provider="sso")`
(`apps/api/src/services/users/users.py:170`). O que ela já entrega de graça: validação de
org, quota de membros (`check_limits_with_usage("members", ...)`), anti-enumeração de
e-mail/username, `email_verified=True` para OAuth, criação do `UserOrganization`, analytics,
webhooks e e-mail de boas-vindas. Geração de username segue o padrão de `signWithGoogle`
(`utils.py:160-184`): nome + sufixo aleatório largo.

Uma mudança mínima é necessária: `create_user` fixa `role_id=4` no membership
(`users.py:283`). Adicionar parâmetro opcional `role_id: int = 4` (default preserva o
comportamento atual em todos os chamadores existentes) e o provisionamento passa o
`default_role_id` da política quando definido. Para linking de conta existente, reusar o
bloco de membership idempotente de `signWithGoogle` (`utils.py:233-276`): checar
`UserOrganization` existente, quota, criar vínculo, invalidar cache de sessão
(`_invalidate_session_cache`) e notificar (`notify_user_joined_org`) — extraído para função
compartilhada em vez de duplicado.

**Justificativa**: Princípio V; `create_user` é o único caminho que mantém quota, webhooks e
verificação de e-mail consistentes — reimplementar qualquer parte diverge.

**Alternativas rejeitadas**:
- INSERT direto de `User` + `UserOrganization` no serviço de provisionamento: perde quota,
  anti-enumeração, webhooks; duplicação proibida pela constituição.
- Refatorar `create_user` para receber a política inteira: a política é decisão do
  provisionamento; `create_user` só precisa do papel.

## 6. Rotação de refresh e concorrência: reusar o mecanismo existente (sem código novo)

**Decisão**: a sessão federada é emitida por `issue_session_or_challenge` /
`mint_session_tokens` (`apps/api/src/services/auth/session.py`) com `amr="sso"`
(`AUTH_METHOD_SSO` já existe em `apps/api/src/security/session_context.py:62`) e
`org_id` da organização do fluxo. FR-009 e FR-010 já são satisfeitos pelo mecanismo atual —
esta feature não escreve código de sessão.

Como o LearnHouse trata refresh concorrente hoje (lido do código):

- Cada refresh token JWT carrega `jti` aleatório (`create_refresh_token`,
  `apps/api/src/security/auth.py:224-246`).
- No endpoint `/auth/refresh` (`apps/api/src/routers/auth.py:292-458`), o `jti` é consumido
  atomicamente via Redis `SET NX` (`_mark_refresh_jti_used`, `security/auth.py:338-363`).
- Primeira apresentação: rotaciona o par e guarda o par novo em cache
  (`_store_refresh_grace`).
- Reapresentação do MESMO `jti` dentro da janela de graça
  (`REFRESH_GRACE_WINDOW_SECONDS = 5*60`, `security/auth.py:386`) — múltiplas abas, retry de
  rede, página server-rendered: o endpoint re-serve o MESMO par rotacionado (com polling
  curto para a corrida NX, `routers/auth.py:389-399`) → nenhuma aba perde a sessão
  (exatamente o cenário 2 da User Story 4).
- Reapresentação FORA da janela: tratada como roubo — `revoke_user_sessions_before` derruba
  todas as sessões e o evento é logado como `replay_detected` em WARNING com idade do token
  (`_log_refresh_outcome`, `routers/auth.py:240-276`) — cenário 3 da User Story 4.
- Cookies: `LH_access` (8h) e `LH_refresh` (30d), `httpOnly`, `samesite=lax`,
  `secure` fora de ambiente local (`set_auth_cookies`, `routers/auth.py:185-207`); espelhados
  no web em `apps/web/services/auth/cookies.ts`.

**Justificativa**: FR-009 exige "o mesmo mecanismo de sessão interna do login nativo" — a
implementação literal do requisito é não escrever nada. Testes existentes já cobrem parte
disso (`apps/api/src/tests/routers/test_auth_logout_revocation.py`,
`test_login_provenance.py`); a feature adiciona apenas um teste confirmando que a sessão SSO
carrega `amr="sso"`/`sorg` e rotaciona como as demais.

**Alternativas rejeitadas**:
- Sessão paralela para SSO: proibida pela spec (FR-009) e pela constituição (V).
- Vincular a rotação local à sessão upstream do Keycloak (documento-base §4.2): escopo da
  feature `003-logout-revogacao`, explicitamente fora daqui.

## 7. Atualização de perfil sem sobrescrever edições locais

**Decisão**: em logins subsequentes de identidade já vinculada, o serviço atualiza somente:
`ExternalIdentity.last_login_at` (sempre) e campos de perfil local **vazios**
(`first_name`, `last_name`, `avatar_image` — preencher apenas se `""`/`None`). Nunca
sobrescreve valor não-vazio: o usuário pode ter editado o próprio perfil. Mudança de e-mail
no provedor NÃO altera `User.email` nem `email_at_link_time` — apenas gera evento de
auditoria com o fato (sem transferir identidade, FR-007). Sincronização configurável de
perfil fica para a política da feature 004 se houver demanda.

**Justificativa**: edge case explícito da spec ("sem sobrescrever silenciosamente dados
editados pelo usuário"). O precedente no código é conservador no mesmo espírito:
`signWithGoogle` só faz *backfill* de `email_verified` e `signup_method` quando ausentes
(`utils.py:208-223`), nunca sobrescreve nome/avatar de conta existente.

**Alternativas rejeitadas**:
- Espelhar sempre os claims do provedor: destrói edições locais silenciosamente.
- Nunca atualizar nada: deixa contas provisionadas sem nome quando o provedor só envia os
  claims no segundo login; preencher-vazio é o meio-termo sem risco.

## 8. Auditoria: estender o registro durável existente

**Decisão**: eventos de provisionamento/vínculo/negação/conflito vão para a tabela
`user_audit_event` via `record_audit_event` (`apps/api/src/services/audit/audit.py`), com
novos tipos (`sso_provisioned`, `sso_linked`, `sso_login_denied`, `sso_conflict` — nomes e
campos em `contracts/provisioning.md`). Duas mudanças mínimas: (a) `user_audit_event.user_id`
passa a ser anulável — negações acontecem antes de existir usuário local; (b)
`record_audit_event` deixa de descartar eventos sem `user_id` para esses tipos (hoje há
early-return `if not user_id`, `audit.py:59-60`). Eventos de renovação permanecem no log
estruturado já existente (`auth.refresh outcome=...`, incluindo `replay_detected` em
WARNING), que já cumpre o "registrada" de FR-010/FR-011 para renovações. Nenhum token, código
ou segredo em nenhum dos dois canais (o log estruturado já obedece isso por construção).

**Justificativa**: SC-004 exige "registro visível para revisão administrativa" — precisa ser
durável e consultável por org, e `user_audit_event` é o único armazenamento durável de
auditoria (com `org_id`, `metadata` JSON e escrita em transação isolada que não quebra o
fluxo do usuário). Criar uma segunda tabela de auditoria violaria o Princípio V.

**Atenção (inconsistência encontrada)**: o docstring de `UserAuditEventType`
(`apps/api/src/db/user_audit_events.py:23-29`) declara escopo "somente ações de aprendizagem
do ALUNO" — mas o próprio código já registra `LOGIN` no caminho OAuth
(`utils.py:283-289`), então eventos de conexão/identidade já são prática. A extensão de
escopo deve ser deliberada: atualizar o docstring no mesmo PR.

**Alternativas rejeitadas**:
- Tabela nova `sso_decision_log`: segunda infraestrutura de auditoria para o mesmo formato de
  linha; a tela de revisão (feature 004) consultaria dois lugares.
- Apenas log estruturado para conflitos: não é consultável pela administração da org
  (SC-004), e logs têm retenção operacional, não legal.
