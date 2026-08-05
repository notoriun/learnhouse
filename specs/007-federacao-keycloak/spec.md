# Especificação de Feature: Federação de Identidade — Keycloak como Dono Único dos Usuários

**Feature Branch**: `007-federacao-keycloak`

**Created**: 2026-08-05

**Status**: Draft

**Input**: Descrição do usuário: "Federação de identidade com Keycloak como dono único dos
usuários (IdP-first). Contas nascem, trocam credencial e morrem no Keycloak; LearnHouse é
relying party puro via OIDC + JIT provisioning. Escopo: cadastro via registro do provedor,
migração one-shot dos usuários locais preservando a senha, bloqueio de gestão local de
credenciais para contas federadas. Sem dual-write em runtime; alvo é só o Keycloak da
plataforma, nunca IdP de terceiros."

## Clarifications

### Session 2026-08-05

- Q: Após a migração, o que acontece com o login por senha local das contas migradas, já que a
  troca local fica bloqueada e a senha do provedor pode divergir com o tempo? → A: Login local
  continua até a organização desligar o método "password" (configuração existente); a
  divergência entre senha local e do provedor é estado transitório aceito e documentado.
- Q: Qual é a estratégia de nome de usuário no provedor, considerando o realm compartilhado
  com o outro sistema? → A: O identificador de entrada no provedor pode ser e-mail ou CPF. A
  migração usa o e-mail como identificador único (o sistema não armazena CPF); o CPF é
  capturado e gerido no próprio provedor. O apelido local do LearnHouse permanece apenas como
  identidade de exibição.
- Q: Quando o caminho "Criar conta" pelo provedor deve aparecer na tela de login? → A: Sempre
  que o login corporativo estiver ativo para a organização; o cadastro local segue disponível
  apenas se a org o permitir (métodos de entrada existentes).
- Q: A migração leva todas as organizações de uma vez ou permite migrar por organização? → A:
  Filtro opcional por organização, com default "todas": permite piloto controlado numa org
  antes da virada completa.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Criar conta pelo provedor corporativo (Priority: P1)

Uma pessoa sem conta acessa a tela de login de uma organização em modo corporativo e escolhe
"Criar conta". Ela é levada à tela de registro do provedor de identidade da plataforma,
preenche seus dados lá, e ao concluir volta ao sistema já autenticada, com a conta criada
segundo a política de admissão da organização. A conta nasce no provedor — o sistema apenas a
reconhece.

**Why this priority**: É o coração da federação: sem um caminho de cadastro pelo provedor, o
único jeito de nascer usuário continua sendo o formulário local, perpetuando duas fontes de
identidade. Os outros dois cenários dependem deste modelo estar de pé.

**Independent Test**: Com uma organização em modo corporativo e auto-registro habilitado no
provedor, completar o registro de um usuário inédito pelo navegador e verificar que ele entra
autenticado, com conta e vínculo criados; nenhum cadastro local é envolvido.

**Acceptance Scenarios**:

1. **Given** uma organização com login corporativo ativo e auto-registro habilitado no
   provedor, **When** a pessoa escolhe "Criar conta" na tela de login, **Then** é levada à
   tela de registro do provedor e, ao concluir, retorna autenticada com a conta provisionada
   pela política da organização.
2. **Given** o auto-registro desabilitado no provedor, **When** a pessoa tenta o caminho de
   registro, **Then** o provedor informa que o registro não está disponível e o sistema não
   cria conta alguma.
3. **Given** o provedor de identidade indisponível, **When** a pessoa tenta criar conta,
   **Then** recebe uma mensagem clara de indisponibilidade em português e pode tentar de novo;
   nenhum estado parcial é criado.
4. **Given** um registro concluído com e-mail pertencente a conta de outra organização,
   **When** o retorno é processado, **Then** valem as mesmas regras de conflito da admissão
   já existente (nada é vinculado silenciosamente).

---

### User Story 2 - Usuários existentes migram mantendo a senha (Priority: P1)

A operação executa uma migração única que leva todas as contas locais de senha para o provedor
de identidade da plataforma. Cada usuário migrado mantém a senha atual e, no primeiro login
corporativo, entra direto — sem etapa de vínculo, sem conflito, sem redefinição forçada.

**Why this priority**: A federação só vira realidade quando o estoque de contas existentes
mora no provedor. Sem migração, o provedor é dono apenas dos usuários novos e o sistema segue
com duas populações de identidade indefinidamente.

**Independent Test**: Rodar a migração num ambiente com contas locais conhecidas; verificar o
relatório (criados/pulados/falhas), confirmar que cada usuário aparece no provedor, que o
login corporativo com a senha antiga funciona e que rodar a migração de novo não duplica nada.

**Acceptance Scenarios**:

1. **Given** contas locais de senha existentes, **When** a migração é executada, **Then** cada
   conta passa a existir no provedor com a mesma senha e com o vínculo de identidade gravado
   para cada organização da qual o usuário é membro.
2. **Given** uma migração já executada, **When** ela é executada novamente, **Then** contas já
   migradas são puladas e o resultado final é o mesmo (idempotência), com relatório indicando
   criados, pulados e falhas.
3. **Given** o modo de simulação (padrão), **When** a migração é executada, **Then** nenhuma
   mudança é feita e o relatório mostra o que aconteceria.
4. **Given** um ambiente em que a importação de senha não é compatível, **When** a migração é
   executada no modo de contingência, **Then** as contas são criadas com exigência de
   redefinição de senha e o usuário é notificado por e-mail.
5. **Given** um usuário migrado, **When** ele faz o primeiro login corporativo, **Then** entra
   direto pela identidade vinculada, sem depender de política de vínculo por e-mail.

---

### User Story 3 - Credenciais federadas se gerenciam no provedor (Priority: P2)

Um usuário com conta federada tenta trocar a senha ou o e-mail dentro do sistema. O sistema
recusa com orientação clara e o direciona à central de conta do provedor, onde a mudança é
feita uma única vez e vale para todos os sistemas conectados. O e-mail alterado no provedor
continua se refletindo no sistema automaticamente no login seguinte.

**Why this priority**: Evita a divergência silenciosa de credenciais — o risco central que a
federação elimina. Vem depois porque só produz efeito sobre contas já federadas pelas stories
1 e 2.

**Independent Test**: Com uma conta federada, tentar trocar senha e e-mail pelo sistema e
verificar a recusa com o direcionamento correto; alterar o e-mail no provedor e confirmar que
o sistema o reflete no login seguinte.

**Acceptance Scenarios**:

1. **Given** uma conta federada, **When** o usuário tenta trocar a senha no sistema, **Then**
   a operação é recusada com mensagem em português apontando a central de conta do provedor.
2. **Given** uma conta federada, **When** o usuário tenta alterar o e-mail no sistema,
   **Then** a operação é recusada com o mesmo direcionamento.
3. **Given** uma conta local não federada, **When** o usuário troca senha ou e-mail, **Then**
   tudo funciona como hoje — nada muda para contas não federadas.
4. **Given** um e-mail alterado no provedor, **When** o usuário faz o login corporativo
   seguinte, **Then** o sistema passa a exibir o novo e-mail (comportamento já existente,
   preservado).

---

### Edge Cases

- Registro concluído no provedor com e-mail não verificado: valem as regras de admissão já
  existentes (entrada negada com orientação para verificar o e-mail).
- Provedor cai entre o início do registro e o retorno: mensagem de indisponibilidade clara,
  sem estado parcial no sistema.
- Migração interrompida no meio: reexecução completa o restante sem duplicar (idempotência por
  conta).
- Conta local cujo e-mail já existe no provedor (criada lá por outro sistema): a migração não
  cria duplicata; grava apenas o vínculo de identidade e reporta como "pulada/vinculada".
- Contas que entraram por provedores sociais (ex.: Google) não têm senha local: ficam fora da
  migração de credencial e são reportadas como puladas.
- Usuário federado que também possui senha local antiga (pré-migração): o login por senha
  local permanece funcionando até a organização desligar o método "password" (configuração
  existente, decisão operacional). Nesse período de transição, a senha local congelada pode
  divergir da senha do provedor — estado transitório aceito; a troca local segue bloqueada
  (FR-008).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sempre que o login corporativo estiver ativo para a organização **e o provedor
  efetivo for o da plataforma**, a tela de login DEVE oferecer um caminho de criação de conta
  que leva à tela de registro do provedor de identidade da plataforma, preservando as mesmas
  garantias de segurança do fluxo de login corporativo existente; organizações com provedor
  próprio de terceiro (feature 004) NÃO recebem o caminho de registro (ver FR-010). O
  cadastro local permanece disponível somente se os métodos de entrada da organização o
  permitirem.
- **FR-002**: O retorno do registro DEVE ser processado pelo mesmo fluxo de admissão e
  provisionamento já existente, com as mesmas políticas e mensagens de erro — nenhuma regra
  de admissão nova.
- **FR-003**: A disponibilidade do auto-registro DEVE ser controlada exclusivamente no
  provedor de identidade; o sistema não mantém configuração própria de "registro aberto".
- **FR-004**: A migração DEVE criar no provedor da plataforma cada conta local de senha,
  preservando e-mail, nome, estado de verificação de e-mail e a senha atual do usuário. O
  e-mail é o identificador único da conta no provedor; o CPF, quando o provedor o suportar
  como identificador de entrada, é capturado e gerido no próprio provedor (o sistema não o
  armazena). O apelido local permanece como identidade de exibição no sistema.
- **FR-005**: A migração DEVE gravar o vínculo de identidade (provedor + identificador do
  usuário) para cada organização da qual o usuário migrado é membro, garantindo primeiro
  login corporativo direto.
- **FR-006**: A migração DEVE ser idempotente, operar por padrão em modo de simulação e
  produzir relatório de criados, pulados e falhas; falha em uma conta não interrompe as
  demais. DEVE aceitar um filtro opcional por organização (default: todas as organizações),
  permitindo piloto controlado antes da migração completa.
- **FR-007**: A migração DEVE oferecer um modo de contingência que cria as contas com
  exigência de redefinição de senha e notificação por e-mail, para o caso de a importação de
  senha não ser compatível.
- **FR-008**: O sistema DEVE recusar troca local de senha e de e-mail para contas federadas
  ao provedor da plataforma, com mensagem em português direcionando à central de conta do
  provedor; contas não federadas permanecem intocadas.
- **FR-009**: Nenhuma operação de runtime do sistema DEVE escrever no provedor de identidade;
  a única escrita administrativa permitida é a migração, executada fora do caminho web.
- **FR-010**: O caminho de registro e as recusas de gestão local NUNCA devem se aplicar a
  provedores OIDC de terceiros configurados por organização — somente ao provedor da
  plataforma.

### Key Entities

- **Conta federada**: conta de usuário cuja identidade pertence ao provedor da plataforma,
  reconhecível pelo vínculo de identidade externa (provedor + identificador); suas
  credenciais são geridas exclusivamente no provedor.
- **Vínculo de identidade externa**: associação já existente entre usuário, organização e
  identidade no provedor (emissor + identificador único); passa a ser criado também pela
  migração, não apenas pelo login.
- **Relatório de migração**: resultado da execução da migração — contas criadas, puladas
  (já existentes/sem senha local) e falhas, com motivo por conta.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma pessoa sem conta completa o registro pelo provedor e chega autenticada ao
  sistema em uma única jornada, sem passar por formulário local de cadastro.
- **SC-002**: 100% das contas locais de senha elegíveis passam a existir no provedor após a
  migração, com relatório que explica cada conta não migrada.
- **SC-003**: Usuários migrados fazem login corporativo com a senha que já usavam, sem etapa
  extra de vínculo ou redefinição (fora do modo de contingência).
- **SC-004**: Nenhuma tela do sistema permite alterar senha ou e-mail de conta federada; 100%
  das tentativas recebem a orientação de usar a central de conta do provedor.
- **SC-005**: Reexecutar a migração produz zero duplicatas e zero alterações em contas já
  migradas.
- **SC-006**: Fluxos de login, admissão e conflito existentes permanecem com o mesmo
  comportamento observável para organizações que não usam o provedor da plataforma.

## Assumptions

- O provedor de identidade da plataforma é um Keycloak operado pelo próprio deployment (o
  fork visual), com auto-registro controlável por realm; provedores de terceiros configurados
  por organização (feature 004) ficam fora de qualquer escrita ou redirecionamento de
  registro.
- O algoritmo de hash de senha do sistema (Argon2) é importável pelo provedor; se os
  parâmetros não forem compatíveis na prática, vale o modo de contingência (FR-007) — decisão
  verificada durante a implementação, sem mudança de escopo.
- A migração roda com credencial administrativa dedicada, fora do caminho web, executada pela
  operação; o caminho web do sistema nunca possui credencial administrativa do provedor.
- O e-mail alterado no provedor já se propaga ao sistema no login seguinte (comportamento da
  feature 002, preservado sem mudanças).
- Desligar métodos locais de entrada por organização é configuração já existente e é decisão
  operacional, não parte desta feature.
- O segundo sistema que compartilha o provedor consome o mesmo modelo (relying party); nada
  nesta feature depende dele.
