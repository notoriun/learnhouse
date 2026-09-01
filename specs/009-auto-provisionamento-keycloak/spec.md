# Feature Specification: Criação automática de conta no primeiro acesso via Keycloak

**Feature Branch**: `009-auto-provisionamento-keycloak`

**Created**: 2026-08-07

**Status**: Draft

**Input**: User description: "agora vamos implementar o modulo que permite que quando um usuario se autenticar com o keycloack, crie automaticamente um ususario para ele no learn house, esse usuario vai ficar vinculado a conta do learnhouse e quando o usuario se autenticar novamente com essa conta do keycloack, vai entrar nessa conta que ele criou do learn house, nao se esqueca depois que o usuario for criado, redirecionar ele para o menu pois a conta dele acabou de ser criada, a mesma coisa quando ele se autenticar com sucesso e ja ter uma conta criada"

**Idioma**: o conteúdo preenchido DEVE ser escrito em português (pt-BR), conforme a
seção "Idioma Oficial" da constituição.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Primeiro acesso cria a conta e entra direto no menu (Priority: P1)

Uma pessoa que existe no provedor de identidade corporativo, mas nunca usou a
plataforma, escolhe entrar com sua identidade corporativa. Ela se autentica no
provedor e, ao voltar para a plataforma, sua conta já existe: foi criada na hora,
com nome e e-mail vindos do provedor, e ela chega autenticada na área principal
da organização — a tela com o menu de navegação. Nenhum administrador precisou
cadastrá-la antes, nenhum formulário adicional foi preenchido e a tela de entrada
não voltou com "conta não encontrada".

**Why this priority**: é o coração do pedido e o que hoje falha. Sem isso, toda
pessoa nova é recusada no retorno do provedor e o acesso corporativo só serve a
quem já tinha conta. Entregue isolada, esta história já habilita a adoção do
acesso corporativo por qualquer pessoa da organização.

**Independent Test**: com uma identidade que nunca acessou a plataforma, percorrer
o fluxo de entrada corporativa de ponta a ponta e verificar três coisas: a conta
passou a existir, a sessão está ativa e a página final é a área principal da
organização com o menu.

**Acceptance Scenarios**:

1. **Given** uma identidade corporativa com e-mail verificado e sem nenhuma conta
   correspondente na plataforma, **When** a pessoa conclui a autenticação no
   provedor, **Then** o sistema cria a conta, abre a sessão e apresenta a área
   principal da organização com o menu de navegação.
2. **Given** o mesmo cenário, **When** a conta é criada, **Then** ela recebe o
   papel de menor privilégio da organização do fluxo e passa a constar como
   membro dessa organização.
3. **Given** uma identidade corporativa cujo e-mail NÃO está verificado no
   provedor, **When** a pessoa conclui a autenticação, **Then** nenhuma conta é
   criada e a pessoa retorna à tela de entrada com uma orientação para verificar
   o e-mail no provedor.
4. **Given** uma identidade cujo domínio de e-mail está fora da lista de domínios
   permitidos da organização, **When** a pessoa conclui a autenticação, **Then**
   nenhuma conta é criada e a pessoa recebe a recusa correspondente.
5. **Given** uma organização cujo acesso corporativo aponta um provedor de
   identidade de terceiro e que não habilitou a criação automática, **When** uma
   identidade sem conta prévia conclui a autenticação, **Then** nenhuma conta é
   criada e a pessoa é orientada a contatar a administração — o padrão restritivo
   desses provedores permanece inalterado.
6. **Given** a mesma organização com provedor de terceiro, **When** a administração
   habilita a criação automática, **Then** o primeiro acesso passa a criar a conta e
   a levar à tela com o menu, como no cenário 1.

---

### User Story 2 - Acessos seguintes reentram na mesma conta e no mesmo menu (Priority: P1)

A mesma pessoa volta dias depois e entra novamente com a identidade corporativa.
Ela cai exatamente na conta criada no primeiro acesso — mesmos cursos, mesmo
progresso, mesmo perfil — e é levada à mesma área principal da organização com o
menu. Nenhuma segunda conta aparece, mesmo que seu nome, sobrenome ou e-mail
tenham mudado no provedor entre os dois acessos.

**Why this priority**: P1 junto com a US1 porque uma criação que não é reconhecida
depois vira conta duplicada a cada acesso — pior do que não criar. As duas
histórias formam o mínimo utilizável, mas são testáveis de forma independente: a
US2 pode ser validada sobre uma conta já vinculada, sem exercitar a criação.

**Independent Test**: partindo de uma identidade já vinculada, repetir o acesso e
conferir que o identificador da conta de destino é o mesmo do acesso anterior, que
o total de contas na plataforma não aumentou e que o destino final é a tela com o
menu.

**Acceptance Scenarios**:

1. **Given** uma identidade corporativa já vinculada a uma conta, **When** a
   pessoa entra novamente, **Then** a sessão é aberta na mesma conta e a página
   final é a área principal da organização com o menu.
2. **Given** uma identidade já vinculada cujo e-mail foi alterado no provedor,
   **When** a pessoa entra, **Then** ela acessa a mesma conta de antes; nenhuma
   conta nova é criada e nenhum dado é transferido para outra conta.
3. **Given** uma identidade já vinculada cuja conta na plataforma está bloqueada,
   **When** a pessoa entra, **Then** o acesso é recusado com a orientação de
   contatar a administração e nenhuma sessão é aberta.

---

### User Story 3 - Conta local pré-existente é reaproveitada, não duplicada (Priority: P2)

Alguém que já tinha conta na plataforma (criada por convite ou por senha) passa a
entrar pela identidade corporativa. Em vez de ganhar uma segunda conta, sua
identidade corporativa é vinculada à conta que ela já usava, preservando cursos e
progresso — e o destino é a mesma tela com o menu.

**Why this priority**: P2 porque afeta a migração de quem já usa a plataforma, não
o primeiro acesso de gente nova. Sem ela o valor da US1 já existe; com ela a
transição de base existente deixa de gerar contas paralelas.

**Independent Test**: com uma conta local existente na organização e uma
identidade corporativa de mesmo e-mail verificado, executar o acesso corporativo e
confirmar que a sessão abre na conta antiga, com seu histórico, sem criação de
conta nova.

**Acceptance Scenarios**:

1. **Given** uma conta existente na organização do fluxo com o mesmo e-mail
   verificado da identidade corporativa, **When** a pessoa entra pela identidade
   corporativa, **Then** a identidade é vinculada à conta existente, a sessão abre
   nessa conta e o destino é a área principal da organização com o menu.
2. **Given** um e-mail que coincide com uma conta de OUTRA organização, **When** a
   pessoa entra, **Then** nenhum vínculo é criado, nenhuma conta é criada, e a
   pessoa recebe uma mensagem de conflito orientando contato com a administração.

---

### Edge Cases

- **Duas abas ao mesmo tempo**: a mesma identidade nova conclui o retorno do
  provedor em dois pedidos simultâneos — o resultado DEVE ser exatamente uma
  conta, com o segundo pedido entrando nela como acesso normal.
- **Nome de usuário já em uso**: o identificador sugerido pelo provedor coincide
  com o de uma conta existente — a criação DEVE concluir com um identificador
  alternativo, sem falhar o acesso e sem colidir com a conta alheia.
- **Provedor manda o e-mail como nome de usuário**: a conta criada DEVE ter um
  identificador local válido, sem endereço completo.
- **Provedor sem dados de perfil**: sem nome/sobrenome nos dados recebidos, a
  conta DEVE ser criada de todo modo, com o perfil incompleto e editável depois.
- **Perfil já editado pela própria pessoa**: acessos seguintes NÃO DEVEM
  sobrescrever nome ou sobrenome que ela mesma alterou na plataforma.
- **Organização inativa ou sem acesso corporativo habilitado**: nenhuma conta é
  criada e a recusa não revela se a organização existe.
- **Falha no meio da criação**: uma criação interrompida NÃO DEVE deixar conta sem
  vínculo, vínculo sem conta, nem membresia órfã.
- **Página pretendida carregada no fluxo**: mesmo quando o fluxo carrega uma página
  interna pretendida, ela é ignorada e o destino é a área principal da organização —
  o que também elimina qualquer chance de um destino externo ou malformado ser usado
  como redirecionamento.
- **Organização do fluxo sem área principal acessível à conta criada**: se, por
  qualquer motivo, a área principal não puder ser apresentada, a pessoa DEVE
  permanecer autenticada e receber uma orientação — nunca ser devolvida à tela de
  entrada como se o acesso tivesse falhado.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Ao concluir com sucesso a autenticação no provedor corporativo, quando
  não existir conta associada àquela identidade, o sistema DEVE criar a conta e
  concluir o acesso na mesma tentativa — sem intervenção administrativa e sem
  devolver a pessoa à tela de entrada com recusa de conta inexistente.
- **FR-002**: A criação automática DEVE estar habilitada por padrão quando o provedor
  do fluxo é o provedor de identidade da própria plataforma. Para provedores de
  identidade de terceiros configurados por organização, ela DEVE permanecer desligada
  até que a administração daquela organização a habilite explicitamente — o padrão
  restritivo existente para esses provedores NÃO DEVE mudar.
- **FR-003**: A conta criada DEVE ficar permanentemente vinculada à identidade do
  provedor, por um identificador estável que não dependa de e-mail, nome ou nome de
  usuário.
- **FR-004**: Em todo acesso posterior com a mesma identidade corporativa, o sistema
  DEVE abrir a sessão na MESMA conta vinculada no primeiro acesso, nunca criando uma
  segunda conta — inclusive quando e-mail, nome ou nome de usuário mudarem no
  provedor.
- **FR-005**: Imediatamente após a criação automática da conta, o sistema DEVE
  apresentar a área autenticada principal da organização do fluxo — a tela que exibe
  o menu de navegação — com a sessão já ativa.
- **FR-006**: Após um acesso bem-sucedido de identidade já vinculada (ou recém
  vinculada a conta existente), o destino DEVE ser o mesmo da FR-005.
- **FR-007**: O destino de retorno DEVE ser sempre a área principal da organização com
  o menu, inclusive quando a pessoa chegou ao acesso corporativo tentando abrir uma
  página interna específica (ex.: um curso por link direto) — essa página pretendida
  NÃO é usada como destino. O destino NUNCA DEVE ser a tela de entrada nem uma página
  de escolha de organização.
- **FR-008**: A criação automática DEVE exigir e-mail verificado no provedor e DEVE
  respeitar as restrições de domínio de e-mail configuradas pela organização;
  qualquer uma dessas condições não atendida resulta em recusa sem criação de conta.
- **FR-009**: A conta criada DEVE receber o papel de menor privilégio previsto para a
  organização do fluxo e DEVE passar a constar como membro dessa organização; a
  criação automática NUNCA DEVE conceder papel administrativo.
- **FR-010**: Quando o e-mail verificado coincidir com uma conta já existente na
  organização do fluxo, o sistema DEVE vincular a identidade a essa conta em vez de
  criar uma nova; quando coincidir com conta de outra organização, DEVE registrar
  conflito e NÃO DEVE vincular nem criar.
- **FR-011**: Tentativas simultâneas da mesma identidade nova DEVEM resultar em
  exatamente uma conta e um vínculo; a tentativa perdedora DEVE concluir como acesso
  normal a essa conta.
- **FR-012**: Nenhuma recusa, conflito ou falha DEVE deixar registro parcial — conta
  sem vínculo, vínculo sem conta ou membresia órfã.
- **FR-013**: O sistema DEVE registrar em auditoria, de forma distinguível, os
  desfechos de criação automática, vínculo a conta existente, acesso de identidade já
  conhecida, recusa e conflito, com a organização e a identidade envolvidas.
- **FR-014**: Mensagens de recusa apresentadas à pessoa DEVEM ser genéricas e em
  português, sem revelar existência de contas, existência de organizações nem detalhes
  técnicos do provedor.

### Key Entities *(include if data involved)*

- **Identidade corporativa**: a pessoa como o provedor a conhece. Identificada de
  forma estável e independente de e-mail; carrega e-mail, situação de verificação
  desse e-mail, nome, sobrenome e nome de usuário sugerido.
- **Conta da plataforma**: a conta do usuário no LearnHouse, com perfil, papel,
  organização de membresia e todo o histórico de aprendizagem.
- **Vínculo identidade ↔ conta**: a associação durável que garante que a mesma
  identidade corporativa sempre chegue à mesma conta. Registra a organização do
  fluxo no momento do vínculo, o e-mail observado então (apenas para auditoria) e o
  último acesso.
- **Política de admissão da organização**: define se contas podem ser criadas
  automaticamente, quais domínios de e-mail são aceitos e qual papel padrão a conta
  criada recebe.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma pessoa sem conta prévia completa o primeiro acesso pela identidade
  corporativa em uma única jornada, sem nenhuma etapa manual e em menos de 30
  segundos entre aprovar o acesso no provedor e ver a tela com o menu.
- **SC-002**: Em 100% dos acessos bem-sucedidos — conta recém-criada, conta recém
  vinculada ou conta já conhecida — a página final é a área principal da organização
  com o menu, nunca a tela de entrada e nunca uma página de escolha de organização.
- **SC-003**: Zero recusas de "conta não encontrada" para identidades válidas do
  provedor da própria plataforma com e-mail verificado e domínio permitido.
- **SC-004**: Zero contas duplicadas: após 10 acessos consecutivos da mesma
  identidade, existe exatamente 1 conta e 1 vínculo, e todo o histórico de
  aprendizagem permanece acessível.
- **SC-005**: 20 retornos simultâneos da mesma identidade nova produzem exatamente 1
  conta.
- **SC-006**: Nenhuma conta criada por este fluxo recebe papel administrativo, e
  nenhuma delas obtém acesso a dados de organização diferente da organização do
  fluxo.
- **SC-007**: 100% dos desfechos (criação, vínculo, acesso, recusa, conflito) são
  localizáveis na auditoria por organização e por identidade.
- **SC-008**: Em organizações com provedor de identidade de terceiro que não
  habilitaram a criação automática, o comportamento permanece idêntico ao atual: zero
  contas criadas automaticamente.

## Assumptions

- "O menu" citado no pedido é a área autenticada principal da organização — a tela
  inicial que exibe o menu de navegação lateral/superior da organização — e não uma
  tela nova a ser criada.
- A organização de destino é a que iniciou o fluxo de acesso corporativo; a criação
  automática não escolhe nem adivinha organização.
- A verificação de e-mail e o segundo fator, quando exigidos, são responsabilidade
  do provedor corporativo; a plataforma não repete esses desafios para a conta criada.
- A conta criada por este fluxo entra pela identidade corporativa; ela não nasce com
  senha utilizável e não passa a permitir entrada por senha por efeito desta feature.
- Nenhuma etapa extra de boas-vindas, aceite ou completar-perfil é introduzida no
  primeiro acesso: o pedido é explícito em que o destino após a criação é o mesmo do
  acesso de quem já tem conta.
- Decisão de escopo (FR-002): a criação automática nasce ligada apenas para o provedor
  da própria plataforma. Provedores de terceiros por organização mantêm o padrão
  restritivo já entregue, de modo que nenhuma organização passa a admitir gente nova
  sem ter pedido.
- Decisão de escopo (FR-007): retomar a página pretendida após o acesso (deep link)
  está fora do escopo desta feature — o destino é sempre a área principal com o menu.
  Se isso se mostrar necessário, entra como feature própria.
- Reaproveita o mecanismo de sessão interna já usado pelos demais métodos de entrada;
  esta feature não altera duração, renovação nem encerramento de sessão.
- Depende do fluxo de acesso corporativo já entregue (features 001 e 007), do
  mecanismo de identidade e provisionamento federado (feature 002), da configuração
  de provedor por organização (feature 004) e do encerramento coordenado de sessão
  (feature 003) — este trabalho ajusta o comportamento padrão e o destino de retorno,
  não recria essas bases.
- O ambiente local com Keycloak (feature 008) é o ambiente de verificação desta
  feature.
