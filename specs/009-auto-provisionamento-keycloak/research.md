# Pesquisa (Fase 0) — Criação automática de conta no primeiro acesso via Keycloak

**Feature**: `009-auto-provisionamento-keycloak` | **Data**: 2026-08-07

Todo o mecanismo de identidade federada já existe (features 001–004, 007). Esta
pesquisa apura **onde exatamente** o comportamento pedido falha hoje e decide o
menor conjunto de mudanças que o entrega sem enfraquecer os invariantes de
segurança já estabelecidos.

## Estado atual apurado no código

### Achado 1 — o auto-provisionamento nasce desligado no caminho global

`provision_federated_login` só cria conta quando `policy.auto_provision` é
verdadeiro ([provisioning.py:249](../../apps/api/src/services/auth/provisioning.py#L249)).
A política vem de dois lugares:

- **Com config de org** (feature 004): `get_provisioning_policy` lê
  `auto_provision_users` da linha `OIDCProviderConfig`, cujo padrão é `False`.
- **Sem config de org** (fallback global por env/`config.yaml`): o router monta
  `ProvisioningPolicy(allow_link_by_email=True)`
  ([keycloak_auth.py:318](../../apps/api/src/routers/keycloak_auth.py#L318)) — e
  `auto_provision` fica no default `False`.

Consequência: identidade nova, sem conta local, cai em
`auto_provision_desativado` → o router transforma em
`403 CONTA_NAO_ENCONTRADA` → o BFF mapeia para `?error=conta_nao_encontrada` na
tela de entrada. É exatamente o sintoma descrito no pedido.

O ambiente local da feature 008 configura o Keycloak por variáveis de ambiente
(`.env` via `docker-compose.local.yml`), portanto **não existe linha de config de
org** e ele percorre justamente o caminho do fallback global.

### Achado 2 — o destino pós-acesso é o seletor de organizações, não o menu

A tela de entrada manda `redirect=/home` nos dois botões corporativos
([login.tsx:331](../../apps/web/app/auth/login/login.tsx#L331) e
[login.tsx:340](../../apps/web/app/auth/login/login.tsx#L340)). O valor
atravessa o fluxo (`create_flow` → Redis → `consume_flow`) e volta como
`redirect_to` na resposta do callback
([keycloak_auth.py:381](../../apps/api/src/routers/keycloak_auth.py#L381)); o BFF
o resolve contra `publicOrigin(request)`.

Mas `/home` é o **seletor de organizações**: o proxy o desvia do catch-all
tenant-scoped em qualquer modo de hospedagem
([proxy.ts:324](../../apps/web/proxy.ts#L324)). Ou seja, quem entra por
identidade corporativa nunca chega ao menu da organização — chega à página de
escolher organização.

### Achado 3 — o menu é a raiz do host da organização

A área com menu é o grupo de rotas `(withmenu)` sob
`apps/web/app/orgs/[orgslug]/`. O caminho público que chega até lá é `/` no host
da organização: o catch-all do proxy reescreve `/` para `/orgs/{slug}/`
([proxy.ts:566](../../apps/web/proxy.ts#L566)). Logo o **caminho** é sempre `/`;
só o **host** varia por modo de hospedagem.

Isso importa porque a URI de retorno cadastrada no client Keycloak é única e
fixa — `{scheme}://{frontend_domain}/api/auth/keycloak/callback`
([keycloak_oidc.py:236](../../apps/api/src/services/auth/keycloak_oidc.py#L236)).
Em `multi`, o callback sempre aterra no ápice, e `/` no ápice cai no ramo 10 do
proxy → `/home` ([proxy.ts:536](../../apps/web/proxy.ts#L536)). Um destino
relativo, portanto, resolve o problema em `single` mas não em `multi`.

### Achado 4 — colisão de nome de usuário derruba a criação inteira

`_create_and_link` deriva o username de `preferred_username`/e-mail/subject
([provisioning.py:280](../../apps/api/src/services/auth/provisioning.py#L280)) e
chama `create_user`, que responde 400 genérico ("Email or username is already in
use") tanto para e-mail quanto para username em uso
([users.py:262](../../apps/api/src/services/users/users.py#L262)). O `except
Exception` do provisionamento converte isso em conflito
`dados_inconsistentes`.

Hoje isso quase nunca aparece porque a criação está desligada. **Ao ligá-la,
passa a ser um caminho quente**: um Keycloak com `joao@empresa.com` gera username
`joao`; se já existir uma conta local `joao` com outro e-mail, o acesso falha
inteiro, com mensagem de erro interno. O caso de e-mail coincidente já é tratado
antes, no passo 4 (vínculo ou conflito), então este é especificamente o caso
"mesmo username, e-mail diferente".

## Decisões

### D1 — Ligar o auto-provisionamento apenas no caminho do provedor da plataforma

**Decisão**: no `keycloak_callback`, quando não existe linha de config de org
(`config_row is None`, isto é, o fluxo usa a config global da plataforma), a
política passa a ser `ProvisioningPolicy(auto_provision=True,
allow_link_by_email=True)`. Quando existe linha de config de org, nada muda:
`get_provisioning_policy` continua respeitando o `auto_provision_users` que a
administração gravou.

**Justificativa**: entrega FR-002 sem tocar em nenhum default de banco e sem
mexer no que a administração de uma organização já configurou. O caminho de
fallback global É, por definição, o provedor da própria plataforma — o mesmo
provedor onde a feature 007 já expõe autorregistro, ou seja, quem consegue se
autenticar nele já é um usuário legítimo da plataforma e a conta vai existir de
um jeito ou de outro. Ao mesmo tempo, IdP de terceiro configurado por
organização (feature 004) permanece fail-closed, preservando o Princípio IV: uma
organização não passa a admitir gente nova sem ter pedido.

`allowed_email_domains` fica vazia nesse caminho (a config global não tem lista
de domínios) e `default_role_id` fica `None`, caindo no papel de menor
privilégio `DEFAULT_MEMBER_ROLE_ID = 4` — FR-009 preservado sem código novo.

Evidência adicional de que o fallback global é o lugar certo para a mudança: a
documentação de ambiente local já registra que "o auto-provisionamento depende de
configuração por organização, que a proteção anti-SSRF recusa para issuer em
`localhost`"
([keycloak-local.mdx](../../docs/content/developers/contributing/keycloak-local.mdx)).
Ou seja, no ambiente local **não é possível** ligar a criação automática pela
config de organização — a guarda de SSRF rejeita o issuer. Se a mudança fosse
feita só na config por org, a feature seria inverificável localmente.

**Alternativas consideradas**:

- *Forçar `auto_provision=True` sempre que o issuer efetivo for o da plataforma,
  inclusive em linha de org* (via `_is_platform_config`): rejeitada. Uma linha de
  org é uma decisão explícita da administração; sobrescrevê-la remove o controle
  que a feature 004 entregou e não é distinguível de "a admin nunca mexeu no
  botão" com um booleano.
- *Tri-state no banco* (`NULL` = herda o padrão, `true`/`false` = explícito):
  rejeitada por Princípio V — exige coluna nova, migração Alembic e uma nuance
  que ninguém pediu, para resolver um caso hipotético.
- *Mudar o default da coluna `auto_provision_users` para `True`*: rejeitada —
  inverteria o padrão para todo IdP de terceiro, exatamente o que a decisão de
  escopo da spec (FR-002) descartou.

### D2 — O destino deixa de vir de entrada do usuário e passa a ser derivado da organização

**Decisão**: o destino não é mais um caminho carregado pelo fluxo. Em vez disso:

- A resposta de `POST /auth/keycloak/callback` troca `redirect_to` por
  **`org_slug`** (a organização do fluxo, que o router já resolveu).
- O BFF (`apps/web/app/api/auth/keycloak/callback/route.ts`) compõe o destino com
  `getUriWithOrg(org_slug, '/')`, já existente em
  [config.ts:281](../../apps/web/services/config/config.ts#L281), e resolve o
  resultado contra `publicOrigin(request)`.
- `POST /auth/keycloak/authorize` deixa de aceitar `redirect_to`; `create_flow`
  deixa de guardar o campo; a tela de entrada para de enviar `&redirect=/home`.

**Justificativa**: `getUriWithOrg` já resolve os três modos de hospedagem do
lado servidor — `single` devolve `/` (relativo, resolve no host que atendeu o
callback) e `multi` devolve `{proto}{slug}.{domain}/`, atravessando do ápice para
o subdomínio da organização. Reúso em vez de código novo (Princípio V). E a
divisão de responsabilidade fica correta em relação ao Princípio II: a API decide
*qual conta e qual organização* (regra de negócio); o BFF compõe *qual URL o
navegador deve visitar* (conhecimento de hospedagem que só o Web tem — o
`apps/api` não sabe o modo de tenancy nem o domínio de cada organização).

Sobre cookies em `multi`: a sessão é gravada no ápice com domínio `.{topDomain}`
([cookies.ts](../../apps/web/services/auth/cookies.ts)), então ela é legível em
`{slug}.{topDomain}` — a travessia funciona. `getUriWithOrg` server-side sempre
constrói o subdomínio (nunca um domínio custom de organização, que teria cookie
host-only e perderia a sessão), o que é justamente o comportamento desejado.

**Consequência deliberada sobre open redirect**: com o destino derivado da
organização, `sanitize_redirect` fica sem uso em produção e é removida junto com
`redirect_to`. A proteção não desaparece — ela deixa de ser uma sanitização de
entrada e passa a ser **estrutural**: não existe mais entrada do usuário no
cálculo do destino. As duas guardas que sobram no BFF (`publicOrigin`, que só
aceita o domínio configurado ou subdomínio dele, e a verificação de que o destino
composto é relativo ou está em host permitido) continuam valendo. A jornada e2e
`us1-redirect-allowlist` é reescrita para afirmar algo mais forte do que hoje: um
`redirect` malicioso na URL de autorização é **ignorado**, não apenas
neutralizado.

**Alternativas consideradas**:

- *Backend devolve a URL absoluta da organização*: rejeitada. Obrigaria o
  `apps/api` a conhecer tenancy, domínio custom e porta — conhecimento que hoje é
  do `apps/web` — e duplicaria `getUriWithOrg` em Python (Princípios I e II).
- *Manter `redirect_to` e passar a mandar `/` da tela de entrada*: rejeitada.
  Funciona em `single` e falha em `multi` (o `/` do ápice é o seletor), e deixa o
  destino dependendo de o cliente mandar o valor certo — a regra volta para o
  cliente, contra o Princípio II.
- *Manter `redirect_to` no contrato como campo aceito mas ignorado*: rejeitada por
  Princípio V (campo morto, confunde quem lê o contrato depois).
- *Cookie com o slug gravado no `authorize` e lido no `callback`*: rejeitada —
  mecanismo novo para transportar um dado que a resposta da API já pode carregar.

### D3 — Resolver colisão de nome de usuário em vez de falhar o acesso

**Decisão**: antes de chamar `create_user`, o provisionamento consulta se o
username derivado está livre; se não, tenta sufixos determinísticos (`joao-1`,
`joao-2`, … até 5 tentativas) e, esgotadas, um sufixo curto derivado do `subject`
(estável para a mesma identidade). Se `create_user` ainda falhar, uma única nova
tentativa com sufixo derivado do subject; falha persistente continua virando
conflito `dados_inconsistentes`.

**Justificativa**: sem isso, ligar a criação automática troca um erro
("conta não encontrada") por outro ("não foi possível concluir o acesso") para
uma parcela real de usuários. A consulta prévia é necessária porque `create_user`
funde conflito de e-mail e de username em um 400 genérico — de propósito, para
não permitir enumeração — e o provisionamento não consegue distinguir os dois
pela exceção.

**Alternativas consideradas**:

- *Deixar `create_user` expor qual campo colidiu*: rejeitada. O erro genérico é
  uma decisão de segurança deliberada (anti-enumeração) num endpoint público.
- *Usar o e-mail completo como username*: rejeitada — `create_user` tem guarda
  anti-URL que rejeita e-mail cru, e o comentário em
  [provisioning.py:277](../../apps/api/src/services/auth/provisioning.py#L277)
  registra que isso já foi um bug.
- *Sufixo aleatório*: rejeitada — não é reproduzível em teste e `Math.random`
  equivalente atrapalha a verificação da corrida.

### D4 — Sem mudança de schema, logo sem migração Alembic

**Decisão**: nenhuma entidade nova, nenhuma coluna nova. `ExternalIdentity`,
`User`, `UserOrganization` e `OIDCProviderConfig` são usados como estão.

**Justificativa**: as três decisões acima são de política, de contrato e de
derivação de valor — nada persistido muda de forma. O Princípio III exige
migração para mudança de schema; não havendo, a exigência que resta é a de
testes, que este plano cumpre (ver plan.md → Estratégia de Testes).

### D5 — Idempotência e corrida continuam garantidas pelo banco

**Decisão**: nenhuma trava nova. A `UniqueConstraint(issuer, subject)` de
`ExternalIdentity` mais o tratamento de `IntegrityError` já existente em
`_create_and_link` cobrem FR-011: a tentativa perdedora re-seleciona a identidade
vencedora e conclui como login.

**Justificativa**: constraint de banco antes de lógica de aplicação, como o
próprio módulo documenta. O que muda é que este caminho passa a ser exercitado de
verdade — daí o teste de concorrência explícito (SC-005) na estratégia de testes.

### D6 — Nada de etapa extra no primeiro acesso

**Decisão**: a conta recém-criada vai para o mesmo destino de quem já tinha
conta; nenhum aviso, aceite ou "complete seu perfil" é introduzido. A resposta do
callback **não** ganha um campo `outcome`.

**Justificativa**: o pedido é explícito ("a mesma coisa"). Um `outcome` na
resposta seria campo sem consumidor (Princípio V); a distinção entre criação,
vínculo e login já existe onde é necessária — nos eventos de auditoria
`SSO_PROVISIONED` / `SSO_LINKED` / `LOGIN`, que atendem FR-013 e SC-007 e são o
que os testes verificam.

## Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Ligar a criação automática amplia quem entra na plataforma pelo provedor global | Guardas preservadas e testadas: e-mail verificado (FR-008), papel de menor privilégio (FR-009), organização do fluxo, bloqueio de conta no chokepoint. Nenhuma guarda é relaxada. |
| Organização com IdP de terceiro esperar que passe a criar contas | Comportamento inalterado por decisão (D1) e coberto por SC-008; o caminho de habilitar é a tela da feature 004. |
| Remoção de `sanitize_redirect` ser lida como regressão de segurança | Justificativa registrada em D2; a jornada e2e passa a afirmar algo mais forte (destino ignora entrada do usuário) em vez de ser removida. |
| Travessia ápice → subdomínio em `multi` perder a sessão | Cookie de sessão em `multi` usa domínio `.{topDomain}`; `getUriWithOrg` server-side só constrói subdomínio, nunca domínio custom. Verificado em `cookies.ts`. |
| Colisão de username virar erro genérico para o usuário final | Resolvida em D3, com teste dedicado. |

## Contexto técnico resolvido

Nenhum item permaneceu como NEEDS CLARIFICATION. Linguagens, dependências,
armazenamento, testes e plataforma são os já estabelecidos pela stack da
constituição e pelos apps envolvidos (`apps/api` FastAPI/SQLModel, `apps/web`
Next.js, `apps/e2e` Playwright); nada novo é introduzido.
