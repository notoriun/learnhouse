# Pesquisa (Fase 0): Validação Ponta a Ponta do Login Corporativo (Keycloak)

**Feature**: `008-testes-keycloak-local` | **Data**: 2026-08-06

Esta pesquisa foi feita **executando** o ambiente descrito na especificação, não apenas lendo
o código. Cada decisão abaixo tem a evidência que a sustenta.

---

## D-01 — Onde a validação vive: módulo novo na suíte de aceitação existente

**Decisão**: criar `apps/e2e/features/keycloak/` como novo módulo da suíte Playwright já
existente, apontada ao ambiente do compose local por variável de ambiente.

**Justificativa**: o risco levantado na especificação — "o harness de aceitação boota a imagem
publicada e não conhece o provedor de identidade" — **não se confirmou**.
[apps/e2e/core/instance.ts](../../apps/e2e/core/instance.ts) já expõe `E2E_BASE_URL` e
`E2E_SKIP_BOOT`, e `SKIP_BOOT` é ligado automaticamente quando `E2E_BASE_URL` está presente. A
suíte, portanto, já sabe rodar contra uma instância de pé que ela não subiu. Rodar contra o
compose local é `E2E_BASE_URL=http://localhost bun run test`.

Isso satisfaz o Princípio V (reúso antes de código novo): reaproveita `core/auth.ts`,
`core/client.ts`, `core/fixtures.ts`, o relatório HTML, os traces e os vídeos, e segue o padrão
de módulo por área (`api.ts`, `pages/`, `tests/`, `verify.ts`) já usado em `assignments` e
`scorm`.

**Alternativas consideradas**:
- *Suíte nova dedicada ao compose*: rejeitada — duplicaria harness, relatório e helpers de
  autenticação sem ganho, violando o Princípio V.
- *Testes pytest contra o Keycloak real*: rejeitada como caminho principal — as jornadas
  US1–US3 têm superfície de navegador (redirecionamento para a tela do provedor, cookies,
  retorno), que pytest não exercita fielmente. Fica como caminho **complementar** para o
  back-channel logout (ver D-05).

## D-02 — Conflito de porta 8080 não existe na prática

**Decisão**: nenhuma mudança de porta é necessária.

**Justificativa**: `E2E_PORT=8080` só é usado para compor `BASE_URL` **quando a suíte boota a
própria instância**. Com `E2E_BASE_URL=http://localhost`, `PORT` deixa de participar da URL. O
Keycloak segue na 8080 e a aplicação na 80, sem colisão. Verificado em
[apps/e2e/core/instance.ts](../../apps/e2e/core/instance.ts) e confirmado com as portas 80 e
8080 livres no host antes de subir.

**Alternativa considerada**: remapear o Keycloak para outra porta — rejeitada, quebraria o
issuer `http://localhost:8080/realms/dev` que o sidecar `keycloak-fwd` existe para fazer
funcionar nos dois lados.

## D-03 — O procedimento documentado está incompleto: falta o `.env` (DEFEITO DE DOCUMENTAÇÃO)

**Achado**: a documentação de ambiente local manda rodar
`docker compose -f docker-compose.local.yml up -d` e lista apenas as **4 variáveis de
Keycloak** a acrescentar no `.env`. Mas:

- `docker-compose.local.yml` declara `env_file: .env` para o serviço da aplicação;
- **não existe `.env` no repositório, nem `.env.example`, nem qualquer template** — verificado
  por varredura de `.env*` em toda a árvore fora de `node_modules`;
- o único gerador de `.env` do projeto é
  [apps/cli/src/templates/env.ts](../../apps/cli/src/templates/env.ts), acionado pelo
  `learnhouse setup` do fluxo de self-host, que não é o fluxo desta documentação.

Consequência: quem seguir a documentação ao pé da letra **não sobe o ambiente** — o compose
falha por arquivo de ambiente ausente. A documentação assume, sem dizer, um `.env` preexistente.

**Decisão**: a feature entrega um template versionado de ambiente local (a ser tratado nas
tarefas) e corrige a documentação. Isto entra na exceção prevista na premissa da especificação
("correções na documentação estão fora do escopo, **salvo quando a validação provar que ela
está errada**") — a validação provou.

**Variáveis mínimas derivadas de `env.ts`** para o compose local: domínio e porta, o bloco
`NEXT_PUBLIC_*`, `NEXTAUTH_URL`/`NEXTAUTH_SECRET`, cadeias de conexão de PostgreSQL e Redis
apontando para os serviços `db` e `redis`, `LEARNHOUSE_COOKIE_DOMAIN=.localhost`,
`LEARNHOUSE_PORT=9000`, segredo JWT, credenciais e organização iniciais, `COLLAB_INTERNAL_KEY`,
entrega de conteúdo em `filesystem`, credenciais do PostgreSQL, mais as 4 variáveis de Keycloak.

## D-04 — `LEARNHOUSE_DEVELOPMENT_MODE=True` é obrigatório e a documentação não menciona

**Achado**: o issuer local é `http://localhost:8080/realms/dev`, sem TLS.
[url_validation.py:34](../../apps/api/src/services/security/url_validation.py#L34) só admite
esquema `http` quando `development_mode` está ligado. A documentação de ambiente local lista as
4 variáveis de Keycloak mas **não menciona** `LEARNHOUSE_DEVELOPMENT_MODE`.

**Decisão**: incluir `LEARNHOUSE_DEVELOPMENT_MODE=True` no template de ambiente local e na
documentação, com a razão explícita (issuer sem TLS).

## D-05 — US5 é inviável no ambiente local como está (BLOQUEIO DE ESCOPO)

**Achado**: a mesma `validate_external_https_url` que libera `http` em desenvolvimento
**rejeita todo endereço que resolva para loopback, faixa privada, link-local ou reservada** —
o docstring diz textualmente que bloqueia `localhost`
([url_validation.py:20-27](../../apps/api/src/services/security/url_validation.py#L20-L27)).
Ela é aplicada no caminho de **configuração OIDC por organização**
([oidc_config.py:303](../../apps/api/src/services/auth/oidc_config.py#L303) e
[:480](../../apps/api/src/services/auth/oidc_config.py#L480)).

Ou seja: cadastrar, pelo painel da organização, uma configuração apontando para o Keycloak
local em `localhost:8080` é recusado por proteção anti-SSRF — e essa recusa é **correta**, não
um defeito. Já o provedor da plataforma (`LEARNHOUSE_KEYCLOAK_ISSUER`, por variável de
ambiente) não passa por essa validação, então **US1–US4 não são afetadas**.

**Decisão**: manter US5 fora desta entrega, como já previsto em FR-016, agora com uma razão
técnica dura em vez de apenas priorização. Validar US5 contra um Keycloak real exigiria um
hostname que resolva para endereço público — decisão de ambiente que merece sua própria
feature. As jornadas de US5 que **não** dependem do provedor real (recusa de issuer inválido,
segredo nunca devolvido em leitura, efeito da desativação na tela de entrada) permanecem
cobertas pelos testes já existentes em
[test_oidc_config_service.py](../../apps/api/src/tests/services/test_oidc_config_service.py) e
[test_oidc_issuer_ssrf.py](../../apps/api/src/tests/security/test_oidc_issuer_ssrf.py).

## D-06 — US2 exige um coletor de e-mail no ambiente (LACUNA DE AMBIENTE)

**Achado**: `docker/keycloak/realm-dev.json` tem `registrationAllowed: true` e
`registrationEmailAsUsername: true`, mas **não define `smtpServer`**. A própria documentação de
login corporativo diz que "o realm deve verificar o e-mail (SMTP + verificação)" e que registro
com e-mail não verificado é recusado na admissão.

Resultado: o caminho **infeliz** de US2 (e-mail não verificado é recusado) é testável hoje,
porque o realm já traz o usuário `nao-verificado` com `emailVerified: false`. O caminho
**feliz** (registrar-se, verificar o e-mail e ser admitido) **não é** — sem SMTP, o Keycloak não
tem como enviar o e-mail de verificação, e a conta nasce não verificada.

**Decisão**: acrescentar ao compose local um coletor de e-mail descartável em contêiner
(padrão de mercado: um servidor SMTP de teste com interface e API de leitura), configurar
`smtpServer` no realm apontando para ele, e a validação lê o e-mail de verificação pela API do
coletor. Isso mantém o Princípio I (a validação lê o coletor, não o banco do Keycloak) e não
introduz dependência na aplicação — é serviço de ambiente de teste, não da stack de produto.

**Alternativa considerada**: marcar `emailVerified: true` pela API administrativa do Keycloak
logo após o registro. Rejeitada — atalharia exatamente a etapa que a jornada precisa comprovar,
e FR-001 proíbe simular o provedor em jornada declarada como validada.

### D-06.1 — `verifyEmail` no realm NÃO pode ser ligado (descoberto na implementação)

Ligar `verifyEmail: true` no realm é o caminho óbvio para o Keycloak disparar o e-mail de
verificação no registro. **Mas quebra a jornada T032**, já verificada: com `verifyEmail: true` o
Keycloak intercepta o usuário `nao-verificado@example.com` na própria tela e **nunca emite o
código de autorização** — de modo que a recusa na admissão feita pela plataforma, que é
exatamente o que US2 cenário 2 precisa comprovar, deixa de ser exercitada.

As duas necessidades são incompatíveis no mesmo ajuste de realm:

| `verifyEmail` | T031 (registro, caminho feliz) | T032 (e-mail não verificado recusado) |
|---|---|---|
| `true` | e-mail de verificação é enviado | **quebra** — provedor bloqueia antes do código |
| `false` (mantido) | nenhum e-mail é enviado no registro | funciona como verificado |

**Decisão**: manter `verifyEmail` **desligado** no realm, preservando o comportamento de T032 já
comprovado, e fazer T031 disparar a verificação pela ação de envio de e-mail do próprio provedor
sobre a identidade efêmera recém-registrada. O e-mail continua sendo enviado **pelo Keycloak** e
a verificação continua acontecendo **no Keycloak** — não há simulação, e FR-001 segue respeitado.
O que a validação faz é acionar uma ação do provedor, não substituí-la.

## D-07 — Usuários de teste: documentação **confere** (verificado na instância de pé)

**Suspeita inicial, levantada por leitura**: a documentação apresenta os usuários como
`teste@example.com` e `nao-verificado@example.com`, mas `docker/keycloak/realm-dev.json` traz
`username` como `teste` e `nao-verificado` — o que sugeria divergência.

**Verificação na instância**: consultando a interface administrativa do realm no ambiente de
pé, os usuários efetivos são:

```
nao-verificado@example.com | emailVerified: false
teste@example.com          | emailVerified: true
```

O Keycloak normaliza `username` para o e-mail no import, por efeito de
`registrationEmailAsUsername: true`. **A documentação está correta e não há divergência** — a
suspeita vinha de ler o arquivo do realm em vez do estado provisionado. Fica aqui registrada por
ser exatamente o tipo de conclusão errada que só a execução desfaz.

**Decisão (mantida por outra razão)**: a validação ainda **não** codifica o identificador em
constante solta. As credenciais de teste vêm de um único ponto de configuração do módulo, e uma
pré-condição verificável confirma que o usuário esperado existe e entra — falhando como problema
de preparação, e não como defeito de produto, quando não confere (FR-004, FR-007). A razão agora
é robustez a mudanças futuras no realm, não divergência atual.

## D-13 — DEFEITO DE PRODUTO: `redirect_uri` do login corporativo ignora o domínio configurado

**Achado, obtido executando o ambiente**: com o ambiente de pé e todas as pré-condições verdes,
a criação do fluxo de autorização devolve uma URL cuja `redirect_uri` é

```
http://localhost:3000/api/auth/keycloak/callback
```

enquanto o client `learnhouse` no realm registra exatamente

```
http://localhost/api/auth/keycloak/callback
```

Porta divergente. O Keycloak recusa a autorização por *redirect URI* não registrada, e o login
corporativo **não funciona** no ambiente local documentado. Este é o primeiro defeito real que a
validação expõe — e ela nem precisou de navegador para expor.

**Causa-raiz**: `get_callback_redirect_uri` monta a URI a partir de
`hosting_config.frontend_domain`
([keycloak_oidc.py:236-240](../../apps/api/src/services/auth/keycloak_oidc.py#L236-L240)). E
`frontend_domain` é resolvido em
[config.py:372-374](../../apps/api/config/config.py#L372-L374) como:

```python
frontend_domain = env_frontend_domain or yaml_config.get("hosting_config", {}).get(
    "frontend_domain", "localhost:3000"
)
```

Ou seja: só `LEARNHOUSE_FRONTEND_DOMAIN` sobrescreve. **Não há fallback para
`LEARNHOUSE_DOMAIN`**, e `apps/api/config/config.yaml` fixa `frontend_domain: localhost:3000`.

**Alcance — maior que o ambiente local**: `LEARNHOUSE_FRONTEND_DOMAIN` é emitido apenas pelo
template **Enterprise** ([ee.ts:136,141](../../apps/cli/src/templates/ee.ts#L136)). O template de
ambiente da edição community ([env.ts](../../apps/cli/src/templates/env.ts)) **nunca** o emite,
mesmo definindo `LEARNHOUSE_DOMAIN` com o domínio real. Logo, qualquer self-host community que
ligue o login corporativo herda `localhost:3000` como `redirect_uri` e tem o login corporativo
quebrado — não é defeito só de ambiente de desenvolvimento.

**Contorno verificado**: definir `LEARNHOUSE_FRONTEND_DOMAIN=localhost` no ambiente corrige a
`redirect_uri`.

**Decisão**: registrar como defeito de produto rastreável (FR-015, D-11), com correção fora do
escopo desta feature conforme a premissa da especificação. A jornada de US1 que comprova FR-002
(fluxo Authorization Code contra o provedor) é exatamente a que falharia — e deve permanecer
falhando até a correção. Duas frentes candidatas para a correção, a decidir na feature própria:
fazer `frontend_domain` cair para `LEARNHOUSE_DOMAIN` quando não informado, ou passar o template
community a emitir `LEARNHOUSE_FRONTEND_DOMAIN`. A primeira corrige instalações já existentes; a
segunda só as novas.

**Reforço para a validação**: este defeito nasceu de uma divergência entre a *redirect URI*
registrada no provedor e a que a plataforma emite. A validação DEVE ter uma jornada que compara
as duas diretamente, além das jornadas de navegador — é uma verificação baratíssima que pega uma
classe inteira de quebra de configuração.

## D-14 — US1 no ambiente local só fecha por vínculo por e-mail (COMPORTAMENTO CORRETO, LACUNA DE DOCUMENTAÇÃO)

**Achado**: corrigida a `redirect_uri` (D-13), o fluxo completou até o callback e a plataforma
**recusou** com `conta_nao_encontrada`, sem emitir sessão.

**Análise**: é comportamento **correto**, não defeito. Sem configuração OIDC por organização, o
callback usa a política de fallback `ProvisioningPolicy(allow_link_by_email=True)`
([keycloak_auth.py:319](../../apps/api/src/routers/keycloak_auth.py#L319)). Vínculo por e-mail
está ligado, mas **auto-provisionamento não** — e auto-provisionamento só vem de configuração por
organização (`allow_link_by_email=config.auto_provision_users`,
[provisioning.py:114](../../apps/api/src/services/auth/provisioning.py#L114)). Sem conta local
preexistente, não há a quem vincular, e a recusa é o desfecho projetado.

**Consequência dura, cruzando com D-05**: no ambiente local, auto-provisionamento exigiria
configuração por organização, que exigiria issuer não-loopback, que a proteção anti-SSRF recusa.
Portanto **a única via de US1 no ambiente local documentado é o vínculo por e-mail sobre conta
local preexistente**. Não é limitação a contornar — é a consequência de duas decisões de
segurança corretas se encontrando.

**Verificação**: criada a conta local `teste@example.com` (que nasce com `email_verified: true`),
o fluxo completo foi repetido e **passou**: o provedor emitiu o código, a plataforma consumiu,
redirecionou para a raiz e emitiu o cookie de sessão `LH_session`. O login corporativo **funciona
ponta a ponta contra o Keycloak real**.

**Decisão**: a validação cria a conta local de vínculo como parte do seu próprio preparo (FR-010,
D-09), e a documentação de ambiente local passa a registrar essa pré-condição — hoje ela não
menciona nada disso, e quem seguir a documentação bate em `conta_nao_encontrada` sem entender por
quê.

## D-15 — Resultados da bateria negativa (comprovados na instância)

| Jornada | Resultado observado | Veredito |
|---|---|---|
| Credencial verificada → sessão | Redirecionamento para a raiz, cookie `LH_session` emitido | **Aprovado** |
| Credencial inválida | Provedor não redireciona; nenhum código emitido; nenhuma sessão | **Aprovado** (FR-008) |
| E-mail não verificado | Provedor emite código; plataforma recusa; **nenhum** cookie de sessão | **Aprovado** (FR-008, US2 cenário 2) |

**Observação de experiência, não defeito**: a recusa por e-mail não verificado chega à interface
como `conta_nao_encontrada` — o mesmo código da conta inexistente. A especificação pede, em US2
cenário 2, "mensagem orientativa". O código genérico plausivelmente é deliberado (evita
enumeração de contas), mas a pessoa não descobre que o problema é o e-mail não verificado.
**Decisão**: registrar como questão de experiência a decidir com quem cuida do produto, e **não**
como defeito — a validação comprova a recusa e a ausência de sessão, que é o que o requisito de
segurança exige.

## D-16 — DEFEITO DE PRODUTO: recusa no login corporativo leva a uma página 404

**Achado, obtido executando as jornadas com navegador**: o callback do login corporativo
redireciona **toda** recusa para `/auth/login`
([callback/route.ts:28](../../apps/web/app/api/auth/keycloak/callback/route.ts#L28)):

```ts
const url = new URL('/auth/login', publicOrigin(request))
```

Mas `/auth/login` responde **404**. O caminho servido é `/login`.

**Verificação, nos dois níveis** (para descartar o proxy como causa):

| Caminho | Via nginx (porta 80) | Direto no servidor Next (porta 8000) |
|---|---|---|
| `/login` | 200 — título `Login — Default Organization` | 200 |
| `/auth/login` | 404 | 404 |
| `/orgs/default/auth/login` | — | 404 |

**Consequência para quem usa**: qualquer recusa no login corporativo — conta inexistente,
e-mail não verificado, organização sem o método SSO — leva a pessoa a uma página "Esta página não
existe ou foi removida". O código de erro que o BFF anexa (`?error=conta_nao_encontanda`,
`?error=sso_indisponivel`, etc.) **nunca é exibido**, porque a página que o leria não existe
naquele caminho. É exatamente o oposto do que a especificação 001 pede em FR-009 (negação com
orientação) e o que US2 cenário 2 chama de "mensagem orientativa".

Também explica, retroativamente, a observação de D-15: a recusa por e-mail não verificado
"chegava como `conta_nao_encontrada`" — na prática não chegava a lugar nenhum visível.

**Ponto ainda aberto**: *por que* `/auth/login` responde 404. O arquivo
`apps/web/app/auth/login/page.tsx` existe no código **e** no build do contêiner
(`/app/web/.next/server/app/auth/login`), não há `middleware` (manifesto vazio), não há reescrita
de `/login` em `next.config.mjs` e não há `notFound()` na página. Ainda assim `/login` resolve
para essa mesma página (o título vem do `generateMetadata` dela) e `/auth/login` não. Registrado
como pergunta aberta em vez de causa-raiz especulada — quem corrigir precisa decidir qual dos dois
caminhos é o canônico antes de mexer no redirecionamento.

**Decisão**: registrar como defeito de produto rastreável (FR-015). A correção está fora do escopo
desta feature. O módulo de validação usa `/login`, que é o caminho que funciona — corroborado por
`core/auth.ts`, escrito contra uma instância real por quem construiu a suíte existente.

**Reforço para a validação**: acrescentar às jornadas de recusa a asserção de que a pessoa **vê**
o motivo, não apenas que a sessão não foi criada. A verificação de "nenhuma sessão" passava com o
404 na tela — segurança preservada, experiência quebrada, e nenhuma das duas asserções originais
percebia.

## D-17 — D-05 alcança mais que US5: bloqueia o caminho feliz de US2 (ESCOPO)

**Achado**: a proteção anti-SSRF foi confirmada **empiricamente**, não só por leitura. Tentando
cadastrar a configuração OIDC da organização apontando para o Keycloak local:

```
PUT /api/v1/orgs/1/oidc-config  {"issuer_url": "http://localhost:8080/realms/dev", ...}
→ 400 {"code": "URL_INVALIDA",
       "message": "O endereço aponta para uma rede privada ou interna e não pode ser utilizado."}
```

**A consequência é maior do que o plano assumiu.** O plano registrou que isso bloqueava US5. Mas
`auto_provision` só é ligado por `config.auto_provision_users`
([provisioning.py:113](../../apps/api/src/services/auth/provisioning.py#L113)), que só existe em
configuração **por organização**. Sem ela, o callback usa a política de fallback
`ProvisioningPolicy(allow_link_by_email=True)`, na qual `auto_provision` fica `False` (valor
padrão do dataclass). E sem `auto_provision`, criar conta nova é recusado com
`auto_provision_desativado` ([provisioning.py:249](../../apps/api/src/services/auth/provisioning.py#L249)).

Ou seja, no ambiente local documentado:

| Jornada de US2 | Alcançável? | Por quê |
|---|---|---|
| T032 — e-mail não verificado recusado, sem sessão | **Sim** | Já comprovada |
| T034 — identidade externa persistida com vínculo correto | **Sim** | Vínculo por e-mail sobre conta local |
| T035 — e-mail de outra organização não vincula | **Sim** | Não depende de config por org |
| T031 — registro **provisiona** conta com menor privilégio | **Não** | Exige `auto_provision`, que exige config por org, que a anti-SSRF recusa |
| T033 — provedor de terceiro não oferece registro | **Não** | Exige uma config por org que não seja a da plataforma |

**Decisão**: implementar o que é alcançável e **declarar explicitamente** o que não é, com
`test.skip` que carrega a razão para o relatório. Silenciar seria pior que reprovar: um relatório
verde que não cobre o caminho feliz do registro é enganoso, e é exatamente o "no silent caps" que
a especificação pede em FR-007.

De T031 permanece verificável a parte que não depende de provisionamento: o registro **na tela do
provedor** cria a identidade no provedor, e a admissão recusa sem criar sessão nem conta local.

**Observação adicional**: a API colapsa deliberadamente todos os motivos de recusa em
`CONTA_NAO_ENCONTRADA` ([keycloak_auth.py:325](../../apps/api/src/routers/keycloak_auth.py#L325)),
então de fora **não se distingue** `auto_provision_desativado` de `email_nao_verificado` de
`email_em_outra_organizacao`. É plausivelmente deliberado (anti-enumeração), mas significa que as
jornadas de recusa comprovam *que* recusou e que nenhuma sessão nasceu — não *por que* recusou.
Combinado com D-16 (a recusa cai num 404), a pessoa não recebe orientação nenhuma.

## D-18 — Recriar o contêiner do Keycloak invalida os vínculos federados (PREPARAÇÃO)

**Achado**: depois de recriar o contêiner do Keycloak (para reimportar o realm com o
`backchannel.logout.url`), todas as jornadas de entrada passaram a falhar com **403** no callback,
sem emitir sessão.

**Causa**: o Keycloak em `start-dev` guarda os dados em memória. Recriar o contêiner reimporta o
realm e **gera novos `subject`** para os usuários de teste. A plataforma já tinha uma identidade
externa vinculada ao `subject` antigo, e o provisionamento recusa quando o mesmo emissor traz
`subject` diferente ([provisioning.py:345](../../apps/api/src/services/auth/provisioning.py#L345)):

```python
if same_issuer is not None and same_issuer.subject != claims.subject:
    return await _conflict(..., "identidade_conflitante")
```

**A recusa está correta** — é literalmente FR-004 e FR-005 da 002: nunca revincular identidade
externa com base em coincidência de e-mail. Se a plataforma aceitasse, quem conseguisse recriar o
realm assumiria contas existentes.

**Consequência operacional, não documentada em lugar nenhum**: recriar só o Keycloak deixa o
ambiente inconsistente. Os dois lados precisam ser recriados juntos:

```bash
docker compose -f docker-compose.local.yml down -v
docker compose -f docker-compose.local.yml up -d
```

**Decisão**: registrar na instrução de correção da pré-condição `local-link-account` e no
quickstart. Não é defeito, e classificar como preparação é justamente o que D-08 existe para
fazer — sem isso, esta falha entraria no relatório como defeito de produto grave ("login
corporativo quebrado, 403 em tudo") quando a causa era o ambiente.

## D-08 — Classificação de reprovação: como distinguir ambiente de produto

**Decisão**: a validação roda uma fase de pré-condições antes de qualquer jornada, e o
resultado dessa fase determina a categoria de FR-007:

| Verificação | Falha classifica como |
|---|---|
| Aplicação responde na rota de saúde | Indisponibilidade de serviço |
| Provedor responde no documento de descoberta do realm | Indisponibilidade de serviço |
| Rota de estado do login corporativo reporta ativo | Preparação de ambiente |
| Encaminhamento interno alcança o provedor de dentro da aplicação | Preparação de ambiente |
| Realm contém os clients e usuários de teste esperados | Preparação de ambiente |
| Método SSO habilitado nos métodos de entrada da organização | Preparação de ambiente |
| Qualquer jornada, com todas as pré-condições verdes | Defeito de produto |

A verificação de encaminhamento interno endereça diretamente o caso de borda do sidecar órfão
descrito na especificação: é o único sintoma que, sem essa distinção, se disfarça de provedor
fora do ar.

## D-09 — Repetibilidade sem recriar o ambiente

**Decisão**: cada execução deriva os dados que cria de um sufixo único por execução, no mesmo
padrão de `makeStudent` em [core/instance.ts](../../apps/e2e/core/instance.ts). Jornadas que
precisam de "primeiro acesso" (provisionamento inicial) criam um usuário novo no provedor para
aquela execução, em vez de reutilizar `teste`.

**Justificativa**: satisfaz FR-009 e FR-010 sem `down -v`, que a documentação registra como a
única forma de reimportar o realm — e que custaria minutos por execução, comprometendo SC-001.

**Restrição herdada**: o validador de e-mail da aplicação rejeita os TLDs reservados `.test`,
`.example` e `.localhost` (comentário explícito em
[core/instance.ts](../../apps/e2e/core/instance.ts)). Os e-mails gerados pela validação devem
usar um domínio de TLD comum.

## D-10 — Rastreabilidade ao requisito de origem (FR-014, SC-006)

**Decisão**: cada arquivo de teste declara, no título de cada jornada, o identificador do
requisito de origem (por exemplo `FR-005 (001-fundacao-oidc-keycloak)`), e o módulo mantém uma
matriz de cobertura que lista requisito → jornada. O relatório do Playwright, que já imprime
títulos, passa a carregar a rastreabilidade sem mecanismo novo.

**Alternativa considerada**: arquivo de matriz mantido à mão à parte dos testes — rejeitada,
desatualiza silenciosamente.

## D-11 — Registro dos defeitos encontrados (FR-015, SC-007)

**Decisão**: cada reprovação classificada como defeito de produto vira uma Issue no GitHub,
seguindo o fluxo do Princípio de desenvolvimento da constituição (bugs entram como Issue), com
referência à jornada e ao requisito violado. A validação **não** é ajustada para aceitar o
comportamento defeituoso; a jornada correspondente fica falhando e a Issue é o registro.

**Consequência aceita**: enquanto houver defeito aberto, a suíte fica vermelha. É o
comportamento desejado — foi para isso que ela existe — e é compatível com a suíte não ser
portão de pull request (FR-017).

## D-12 — Segredos fora dos registros (FR-012)

**Decisão**: a validação nunca imprime senha, segredo de cliente, código de autorização ou
token. Os recursos do Playwright que capturam estado (trace, vídeo, screenshot) ficam
restritos a falha e primeira repetição, como já configurado em
[playwright.config.ts](../../apps/e2e/playwright.config.ts), e o módulo não adiciona captura de
corpo de requisição.

**Ponto de atenção para as tarefas**: `trace: 'on-first-retry'` e `video:
'retain-on-failure'` capturam a tela do provedor no momento do preenchimento da senha. Como o
campo é do tipo senha, o valor não aparece renderizado; mesmo assim, os artefatos não devem ser
publicados fora do ambiente de execução.

---

## Estado da execução do ambiente

Registrado na seção de execução do [plan.md](./plan.md#execução-real-do-ambiente-fase-0).
