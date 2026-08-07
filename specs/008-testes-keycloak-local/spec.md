# Especificação de Feature: Validação Ponta a Ponta do Login Corporativo (Keycloak)

**Feature Branch**: `008-testes-keycloak-local`

**Created**: 2026-08-06

**Status**: Draft

**Input**: Descrição do usuário: "preciso que teste as funcionalidades do keycloack, ja tem
um docker compose (docker-compose.local.yml) e uma documentacao
(https://notoriun.github.io/learnhouse/developers/contributing/keycloak-local/)"

**Idioma**: escrito em português (pt-BR), conforme a seção "Idioma Oficial" da constituição.

## Contexto

As funcionalidades de identidade corporativa foram especificadas e implementadas nas features
001 a 004 e 007 (fundação OIDC, identidade e provisionamento, logout e revogação,
administração da configuração OIDC, federação com o provedor como dono único dos usuários).
Hoje elas são exercitadas apenas por testes que simulam o provedor de identidade. Não existe
evidência de que as jornadas funcionem contra um Keycloak real — nem sequer um procedimento
repetível que produza essa evidência.

O ambiente para isso já existe e está documentado: um compose local que sobe a plataforma
junto de um Keycloak 26.x com o realm `dev` importado, clients e usuários de teste prontos.
Esta feature transforma esse ambiente em uma **validação repetível com veredito de
aprovado/reprovado** sobre as jornadas de identidade corporativa, e usa essa validação para
levantar os defeitos que hoje estão invisíveis.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Comprovar que o login corporativo funciona de ponta a ponta (Priority: P1)

Uma pessoa responsável pela qualidade prepara o ambiente local seguindo a documentação,
dispara a validação e recebe, sem intervenção manual, um veredito de que a jornada de entrada
por identidade corporativa funciona: a opção de entrada aparece, a autenticação acontece na
tela do provedor real, a pessoa retorna autenticada e passa a navegar com sessão válida da
plataforma.

**Why this priority**: é a jornada central da identidade corporativa e a que carrega mais
risco — se ela estiver quebrada, nenhuma das demais importa. Entregue isoladamente, já
substitui a verificação manual que hoje ninguém consegue reproduzir com confiança.

**Independent Test**: subir o ambiente conforme a documentação, executar a validação e
conferir que ela reporta aprovado quando o login funciona e reprovado — com a etapa exata que
falhou — quando o ambiente é sabotado de propósito, por exemplo desligando o provedor.

**Acceptance Scenarios**:

1. **Given** o ambiente local no ar e a entrada por identidade corporativa habilitada na
   organização, **When** a validação executa a jornada de entrada com a credencial de teste de
   e-mail verificado, **Then** ela reporta aprovado e comprova que a sessão resultante permite
   acessar uma área que exige autenticação.
2. **Given** o mesmo ambiente, **When** a validação executa a jornada com credencial inválida,
   **Then** ela reporta que o acesso foi negado sem que nenhuma sessão da plataforma tenha sido
   criada.
3. **Given** o provedor de identidade indisponível, **When** a validação executa a jornada de
   entrada, **Then** ela reporta reprovado identificando a etapa de indisponibilidade do
   provedor, e comprova que sessões já ativas continuam utilizáveis.
4. **Given** uma execução concluída, **When** a pessoa consulta o resultado, **Then** encontra
   um relatório que nomeia cada jornada verificada, o veredito de cada uma e evidência
   suficiente para investigar as falhas sem repetir a execução.

---

### User Story 2 - Comprovar o registro pela identidade corporativa e a recusa de e-mail não verificado (Priority: P2)

A mesma pessoa obtém veredito sobre o caminho de criação de conta pelo provedor da plataforma:
quem se registra com e-mail verificado entra e recebe conta provisionada com o papel de menor
privilégio; quem chega com e-mail não verificado é recusado na admissão, com orientação clara e
sem conta criada.

**Why this priority**: é o segundo caminho de entrada de usuários e o que tem a regra de
admissão mais delicada. O ambiente local já traz os dois usuários de teste exatamente para
distinguir esses dois desfechos, então o custo de cobrir é baixo e o valor é alto.

**Independent Test**: executar somente as jornadas de registro e de admissão recusada,
verificando que a conta aprovada existe na plataforma com o papel esperado e que a recusada não
deixou conta nem sessão.

**Acceptance Scenarios**:

1. **Given** o auto-registro habilitado no provedor da plataforma, **When** a validação percorre
   a criação de conta pela identidade corporativa com e-mail verificado, **Then** reporta
   aprovado e comprova que a conta foi criada com vínculo de identidade externa e papel de menor
   privilégio.
2. **Given** o usuário de teste com e-mail **não** verificado, **When** a validação tenta a
   admissão, **Then** reporta que o acesso foi recusado com mensagem orientativa e comprova que
   nenhuma conta nova foi criada.
3. **Given** uma organização cujo provedor não é o da plataforma, **When** a validação verifica a
   superfície de entrada, **Then** comprova que a opção de registro não é oferecida e que a
   tentativa direta é recusada.

---

### User Story 3 - Comprovar o encerramento de sessão coordenado (Priority: P3)

A pessoa obtém veredito de que sair da plataforma encerra também a sessão no provedor, e de que
uma sessão derrubada no provedor deixa de valer na plataforma.

**Why this priority**: sessão que não morre é risco de segurança, e é o tipo de defeito que
passa despercebido em verificação manual porque exige checar dois sistemas ao mesmo tempo —
justamente o que só um Keycloak real permite comprovar.

**Independent Test**: entrar por identidade corporativa, sair, e comprovar que uma nova
tentativa de acesso exige autenticação de novo nos dois sistemas; separadamente, derrubar a
sessão pelo provedor e comprovar que a plataforma passa a recusar a sessão.

**Acceptance Scenarios**:

1. **Given** uma sessão ativa iniciada por identidade corporativa, **When** a pessoa sai pela
   plataforma, **Then** a validação comprova que a sessão local foi revogada, que os cookies de
   sessão foram removidos e que o provedor também encerrou a sessão.
2. **Given** a mesma sessão ativa, **When** ela é encerrada diretamente no provedor, **Then** a
   validação comprova que a plataforma deixa de aceitar aquela sessão.
3. **Given** uma sessão de origem nativa (e-mail e senha), **When** a pessoa sai, **Then** a
   validação comprova que o encerramento nativo continua funcionando sem depender do provedor.

---

### User Story 4 - Comprovar as guardas de conta federada (Priority: P4)

A pessoa obtém veredito de que contas federadas não podem trocar senha nem e-mail dentro da
plataforma, sendo direcionadas à central de conta do provedor, enquanto os demais campos de
perfil seguem editáveis.

**Why this priority**: define a fronteira de propriedade dos dados de credencial. É uma regra já
implementada e de verificação rápida, mas cuja quebra silenciosa criaria divergência entre
plataforma e provedor.

**Independent Test**: com uma conta federada, tentar trocar senha e e-mail e comprovar a recusa
com orientação para a central de conta; em seguida editar um campo de perfil comum e comprovar
que é aceito.

**Acceptance Scenarios**:

1. **Given** uma conta federada, **When** ela tenta trocar a senha ou o e-mail na plataforma,
   **Then** a validação comprova a recusa e a presença do endereço da central de conta do
   provedor na orientação.
2. **Given** a mesma conta, **When** ela edita nome, biografia ou avatar, **Then** a validação
   comprova que a alteração é aceita.
3. **Given** uma conta puramente local (não federada), **When** ela troca a própria senha,
   **Then** a validação comprova que a troca continua permitida.

---

### User Story 5 - Comprovar a administração da configuração de identidade por organização (Priority: P5)

Uma pessoa administradora da organização comprova que cadastrar, testar, ativar e desativar a
configuração de identidade corporativa produz o efeito esperado na tela de entrada, e que o
segredo do cliente nunca é devolvido para leitura.

**Why this priority**: é a superfície de administração e afeta a operação real, mas depende de as
jornadas de entrada já estarem comprovadas — validá-la antes teria pouco significado.

**Independent Test**: cadastrar uma configuração, executar o teste de conexão contra o Keycloak
local, ativar e comprovar que a opção de entrada aparece; desativar e comprovar que desaparece;
em toda leitura da configuração, comprovar que o segredo não é retornado.

**Acceptance Scenarios**:

1. **Given** uma organização sem configuração de identidade, **When** a administração cadastra
   uma configuração apontando para o Keycloak local e executa o teste de conexão, **Then** a
   validação comprova que o teste confirma a descoberta dos endpoints do provedor.
2. **Given** uma configuração ativa, **When** ela é desativada, **Then** a validação comprova que
   a opção de entrada corporativa desaparece da tela de entrada da organização e que sessões já
   ativas não são encerradas.
3. **Given** uma configuração com segredo salvo, **When** a configuração é consultada, **Then** a
   validação comprova que o segredo não é devolvido em nenhuma forma legível.
4. **Given** um endereço de emissor inválido ou sem HTTPS fora de desenvolvimento, **When** a
   administração tenta salvar, **Then** a validação comprova a recusa antes da gravação.

---

### User Story 6 - Comprovar a migração de contas locais para o provedor (Priority: P6)

Uma pessoa responsável pela operação comprova que a migração de contas locais para o provedor de
identidade opera por padrão em simulação, é idempotente e grava o vínculo de identidade sem
duplicar contas.

**Why this priority**: é uma operação de uso pontual e não bloqueia nenhuma jornada de usuário,
mas é irreversível na prática — vale ter evidência antes do primeiro uso real. Fica por último
porque exige um preparo adicional de permissões no provedor que a documentação hoje descreve
como passo manual.

**Independent Test**: executar a migração em modo de simulação sobre um conjunto conhecido de
contas locais e comprovar que nada foi escrito; executar em modo efetivo, comprovar as contas
criadas no provedor e os vínculos gravados; executar de novo e comprovar que nada é duplicado.

**Acceptance Scenarios**:

1. **Given** contas locais de teste, **When** a migração roda sem pedir efetivação, **Then** a
   validação comprova que o modo simulação é o padrão e que nada foi criado no provedor.
2. **Given** o mesmo conjunto, **When** a migração roda em modo efetivo e depois é repetida,
   **Then** a validação comprova que a segunda execução não cria nem altera nada.
3. **Given** contas migradas, **When** elas entram por identidade corporativa, **Then** a
   validação comprova que caem na conta preexistente, sem criar conta nova.

---

### Edge Cases

- **Ambiente meio-subido**: quando a validação começa antes de a plataforma ou o provedor
  estarem prontos para atender, ela deve aguardar a prontidão de ambos até um limite e, esgotado
  o limite, reprovar apontando qual serviço não ficou pronto — nunca reportar falha de jornada
  quando a causa foi ambiente indisponível.
- **Encaminhamento de rede órfão**: a documentação registra que recriar apenas a aplicação deixa
  o encaminhamento para o provedor órfão, e o sintoma é a entrada corporativa falhando como se o
  provedor estivesse fora. A validação deve distinguir esse defeito de ambiente de um defeito de
  produto.
- **Estado residual entre execuções**: contas provisionadas, vínculos e sessões de uma execução
  anterior podem alterar o desfecho da seguinte (por exemplo, o primeiro acesso deixa de ser o
  primeiro). Cada jornada deve produzir o mesmo veredito em execuções repetidas sobre o mesmo
  ambiente, sem exigir recriação do ambiente do zero.
- **Realm não reimportado**: o provisionamento do realm só ocorre na primeira criação do volume
  de dados. A validação deve detectar que o realm ou os usuários de teste esperados não existem e
  reprovar como problema de preparação, com a instrução de correção.
- **Conflito de identidade**: e-mail que coincide com conta de outra procedência deve levar a
  recusa, e não a vínculo automático — a validação deve comprovar a recusa.
- **Divergência de relógio** entre plataforma e provedor além da tolerância configurada deve
  levar a negação de acesso, não a aceitação silenciosa.
- **Defeitos encontrados**: a validação provavelmente vai reprovar em pontos hoje desconhecidos.
  Reprovações legítimas de produto devem ser registradas como defeitos rastreáveis, e não
  silenciadas para deixar a execução verde.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A validação DEVE exercitar as jornadas de identidade corporativa contra um provedor
  de identidade real em execução, e NÃO DEVE substituir o provedor por uma simulação em nenhuma
  jornada declarada como validada.
- **FR-002**: A validação DEVE ser executável por uma pessoa que siga apenas a documentação do
  ambiente local, sem conhecimento prévio do código, em um único comando após o ambiente estar no
  ar.
- **FR-003**: A validação DEVE verificar a prontidão da plataforma e do provedor antes de executar
  qualquer jornada, e DEVE reprovar com causa explícita de ambiente quando a prontidão não for
  atingida no limite de tempo.
- **FR-004**: A validação DEVE verificar que o ambiente contém as pré-condições esperadas (realm
  provisionado, clients e usuários de teste previstos na documentação) e DEVE reprovar como
  problema de preparação, com instrução de correção, quando faltar alguma.
- **FR-005**: A validação DEVE produzir, ao final, um relatório que liste cada jornada verificada,
  seu veredito individual e um veredito agregado de aprovado ou reprovado.
- **FR-006**: Para cada jornada reprovada, o relatório DEVE conter evidência suficiente para
  investigar sem reexecutar: a etapa exata onde falhou, o resultado observado e o esperado.
- **FR-007**: O relatório DEVE distinguir três categorias de reprovação: defeito de produto,
  problema de preparação do ambiente e indisponibilidade de serviço.
- **FR-008**: A validação DEVE comprovar, para cada jornada de negação de acesso, que nenhuma
  sessão da plataforma foi criada.
- **FR-009**: A validação DEVE ser repetível: duas execuções consecutivas sobre o mesmo ambiente,
  sem recriação de dados, DEVEM produzir o mesmo veredito por jornada.
- **FR-010**: A validação NÃO DEVE depender de dados criados manualmente por uma pessoa; qualquer
  dado além do que o ambiente documentado já provisiona DEVE ser criado pela própria validação.
- **FR-011**: A validação DEVE terminar com resultado distinguível de forma automática entre
  aprovado e reprovado, de modo a poder ser encadeada em automação.
- **FR-012**: A validação NÃO DEVE registrar credenciais, segredos de cliente nem artefatos de
  sessão em texto legível no relatório ou nos registros de execução.
- **FR-013**: A validação NÃO DEVE alcançar nenhum provedor de identidade externo ao ambiente
  local, nem enviar dados para fora dele.
- **FR-014**: Cada jornada verificada DEVE ser rastreável ao requisito de origem nas features 001
  a 004 e 007, de modo que a cobertura da validação possa ser auditada contra as especificações
  existentes.
- **FR-015**: Toda reprovação classificada como defeito de produto DEVE ser registrada como
  defeito rastreável; a validação NÃO DEVE ser ajustada para aceitar o comportamento defeituoso
  como esperado.
- **FR-016**: A amplitude de jornadas cobertas nesta entrega DEVE ser entrada, registro,
  encerramento de sessão e guardas de conta federada (User Stories 1 a 4). Administração da
  configuração por organização (US5) e migração de contas (US6) ficam documentadas nesta
  especificação e entram em entrega posterior.
- **FR-017**: A execução da validação DEVE ser possível sob demanda na máquina de quem
  desenvolve, usando o ambiente local documentado, e DEVE também rodar de forma agendada e sob
  demanda na automação do repositório, sem ser portão obrigatório por pull request.

### Key Entities

- **Jornada verificada**: uma sequência de passos com desfecho esperado, associada ao requisito de
  origem que ela comprova, ao veredito da última execução e à evidência coletada.
- **Execução de validação**: um disparo completo, com instante de início, ambiente-alvo, conjunto
  de jornadas executadas, veredito agregado e relatório.
- **Pré-condição de ambiente**: um fato que precisa ser verdadeiro antes de qualquer jornada
  (serviço pronto, realm provisionado, usuário de teste presente), com sua instrução de correção
  quando ausente.
- **Credencial de teste**: um par identificador/segredo previsto pelo ambiente documentado, com a
  situação que ele representa (e-mail verificado, e-mail não verificado).
- **Defeito levantado**: uma reprovação classificada como defeito de produto, com a jornada que a
  expôs, o requisito violado e o registro rastreável correspondente.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma pessoa que nunca executou a validação consegue, seguindo apenas a documentação,
  obter um veredito completo em menos de 20 minutos de ponta a ponta, contando o preparo do
  ambiente.
- **SC-002**: 100% das jornadas de identidade corporativa dentro da amplitude acordada têm
  veredito automático, sem nenhum passo de verificação manual.
- **SC-003**: Nenhuma jornada declarada como validada usa provedor simulado — verificável
  auditando a validação contra a lista de jornadas.
- **SC-004**: Em 3 execuções consecutivas sobre o mesmo ambiente, o veredito por jornada é
  idêntico nas 3 (nenhuma jornada intermitente).
- **SC-005**: Ao sabotar deliberadamente uma jornada — por exemplo, tornando o provedor
  indisponível ou desativando a configuração — a validação reprova a jornada correspondente e
  classifica corretamente a causa em 100% dos casos testados.
- **SC-006**: Toda jornada verificada aponta para um requisito de origem identificável nas
  especificações 001 a 004 e 007, sem jornada órfã.
- **SC-007**: Todo defeito de produto exposto pela validação tem registro rastreável aberto até o
  encerramento desta feature, com nenhum defeito conhecido sem registro.
- **SC-008**: Quando a validação reprova, a pessoa identifica a etapa que falhou pelo relatório em
  menos de 2 minutos, sem reexecutar a validação e sem ler o código da validação.

## Assumptions

- O ambiente-alvo é o compose local já existente com o provedor de identidade provisionado, e a
  documentação de ambiente local descreve fielmente como prepará-lo; correções na própria
  documentação estão fora do escopo, salvo quando a validação provar que ela está errada.
- As funcionalidades de identidade corporativa das features 001 a 004 e 007 estão implementadas, e
  o propósito aqui é comprová-las contra um provedor real, não implementá-las de novo.
- Corrigir os defeitos que a validação expuser está fora do escopo desta feature: o escopo entrega
  a validação e o registro rastreável dos defeitos; a correção de cada um é trabalho próprio,
  priorizado à parte.
- As credenciais e o realm de teste previstos na documentação do ambiente local são suficientes
  para as jornadas; nenhuma conta ou provedor real de terceiro é usado.
- O ambiente é descartável e a validação pode criar, alterar e apagar dados nele livremente.
- A validação exercita as jornadas pela superfície que a pessoa usuária realmente usa, sempre que a
  jornada tiver superfície visível; jornadas sem superfície visível (como notificação de
  encerramento vinda do provedor) são exercitadas pela interface de integração correspondente.
- O passo hoje manual de conceder permissão de gestão de usuários à conta de serviço da migração
  continua manual, e a validação o trata como pré-condição verificável em vez de automatizá-lo.
- Rodar na automação do repositório sem ser portão por pull request segue o precedente da suíte de
  aceitação já existente, que roda de forma agendada e sob demanda.
