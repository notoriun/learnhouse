# Research — Federação de Identidade (007)

Decisões técnicas da Phase 0. Nenhum NEEDS CLARIFICATION restante (as decisões de produto
foram fechadas em brainstorming e na sessão de clarificação de 2026-08-05).

## 1. Caminho de registro do Keycloak

**Decision**: montar a URL de registro trocando o path do `authorization_endpoint` descoberto
de `/protocol/openid-connect/auth` para `/protocol/openid-connect/registrations`, mantendo
exatamente os mesmos parâmetros do fluxo de login (client_id, redirect_uri, scope, state,
nonce, PKCE S256). A troca acontece em `build_authorization_url` (`keycloak_oidc.py`) quando
`action == "register"`.

**Rationale**: o endpoint `registrations` é nativo do Keycloak (estável desde a linha Quarkus)
e devolve o usuário ao `redirect_uri` com um authorization code normal — o callback e a
admissão existentes funcionam sem mudança. PKCE/state seguem válidos porque o registro É um
fluxo de autorização.

**Alternatives considered**: (a) link direto à página de registro do realm sem OIDC — quebra
o retorno autenticado e o PKCE; (b) `kc_action` — mecanismo de required actions de sessão
ativa, não serve para registro anônimo; (c) criar conta via Admin API no runtime — viola
FR-009 (sem dual-write) e foi rejeitada em brainstorming.

## 2. Importação do hash Argon2 na migração

**Decision**: o script lê o hash PHC do banco (`$argon2id$v=19$m=...,t=...,p=...$salt$digest`,
gerado por passlib/argon2-cffi), faz o parse dos parâmetros e cria a credencial via Admin API
com `credentials: [{type: "password", secretData: {value: <digest_b64>, salt: <salt_b64>},
credentialData: {algorithm: "argon2", hashIterations: t, additionalParameters: {memory: m,
parallelism: p, type: argon2id, version: 1.3}}}]`. Validação prática obrigatória no ambiente
docker local (quickstart passo 2) antes de qualquer execução real.

**Rationale**: Keycloak ≥ 24 tem provider Argon2 nativo (argon2id), e a representação de
credencial do Admin API aceita parâmetros por credencial — o usuário mantém a senha (SC-003).

**Alternatives considered**: (a) reset em massa — vira o modo de contingência
`--reset-passwords` (FR-007), não o caminho padrão; (b) validação de senha por proxy no
primeiro login (rehash-on-login) — exige caminho novo de autenticação em runtime, rejeitado
pelo custo e por FR-009; (c) exportação/import de realm JSON — exigiria parada do Keycloak e
não é idempotente por conta.

**Risco registrado**: se o mapeamento de parâmetros do provider divergir na prática (login
falha no teste do quickstart), o rollout usa `--reset-passwords` sem mudança de escopo — já
previsto na spec (FR-007, Assumptions).

## 3. Credencial administrativa da migração

**Decision**: client confidencial **dedicado** (`learnhouse-migration`) com *service account*
habilitado e apenas o papel `manage-users` do realm, informado ao script por variáveis de
ambiente no momento da execução (`LEARNHOUSE_KC_MIGRATION_CLIENT_ID/SECRET`). O client web
(`learnhouse`) permanece sem qualquer papel administrativo.

**Rationale**: menor privilégio — o caminho web nunca possui credencial admin (FR-009,
Assumption da spec); revogar o client de migração após o rollout é um clique, sem tocar no
client de login.

**Alternatives considered**: (a) reusar o client OIDC de login com service account — mistura
privilégios de runtime e migração, rejeitado; (b) usuário admin de realm — credencial pessoal,
sem escopo mínimo, rejeitado.

## 4. Detecção de "conta federada" para os bloqueios

**Decision**: helper único `is_platform_federated(db_session, user_id) -> bool` em
`apps/api/src/services/auth/federation.py`: existe `ExternalIdentity` do usuário cujo
`issuer` é o issuer global da plataforma (`get_keycloak_config().issuer`). Os serviços de
senha e e-mail consultam o helper e recusam com erro estruturado
`{code: "CONTA_FEDERADA", account_console_url: "<issuer>/account"}`.

**Rationale**: o vínculo `externalidentity` já é a fonte da verdade de federação (feature
002); comparar pelo issuer da plataforma exclui por construção os IdPs de terceiros da
feature 004 (FR-010).

**Alternatives considered**: (a) flag nova em `user` — estado duplicado que pode divergir do
vínculo, rejeitado; (b) checar `signup_method` — não cobre contas migradas (que nasceram como
"email"), rejeitado.

## 5. Configuração do realm (identificador de entrada)

**Decision**: realm da plataforma com `registrationEmailAsUsername: true` e
`duplicateEmailsAllowed: false` — e-mail é o identificador único de entrada; o CPF, quando
adotado, é atributo/identificador adicional gerido no próprio provedor (fork visual), fora do
LearnHouse. `docker/keycloak/realm-dev.json` passa a refletir isso para o ambiente local
(`registrationAllowed: true` para os cenários do quickstart).

**Rationale**: e-mail já é único entre os dois sistemas que compartilham o realm — elimina
colisão de username por construção (clarificação Q2); o LearnHouse não armazena CPF
(verificado no código), então qualquer captura de CPF pertence ao provedor.

**Alternatives considered**: username local como username do realm (com sufixo ou falha em
colisão) — rejeitado na clarificação por criar colisões evitáveis num realm compartilhado.

## 6. Visibilidade do registro federado no front

**Decision**: o botão "Criar conta pela identidade corporativa" aparece na tela de login
quando o login corporativo estiver ativo para a org **e** o provedor efetivo for o da
plataforma (`status.enabled && status.platform` — o `/status` ganha o campo `platform`;
guarda FR-010: org com IdP próprio de terceiro nunca recebe o caminho de registro, e a API
recusa `action=register` nesse caso com `REGISTRO_NAO_DISPONIVEL`); leva a
`/api/auth/keycloak/authorize?org=<slug>&action=register&redirect=/home`. O cadastro local
continua regido pelos métodos de entrada da organização (config existente).

**Rationale**: clarificação Q3 (opção B) — contas novas nascem no provedor o quanto antes,
sem esperar a org virar SSO-only.

**Alternatives considered**: só em org SSO-only (adia a federação dos novos cadastros);
toggle novo por org (config especulativa, rejeitada por YAGNI/Princípio V).
