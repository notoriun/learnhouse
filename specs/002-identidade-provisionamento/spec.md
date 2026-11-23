# Especificação de Feature: Identidade Externa, Linking e Provisionamento

**Feature Branch**: `002-identidade-provisionamento`

**Created**: 2026-08-03

**Status**: Draft

**Input**: Descrição do usuário: "Crie especificações para implementar cada feature do documento
Plano_Implementacao_Fork_Keycloak_Identidade_Visual.docx" — Fase 2 do roteiro: Identidade e
sessão (ExternalIdentity, linking, provisioning, cookies, refresh e auditoria).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Primeiro acesso com provisionamento automático (Priority: P1)

Um colaborador da organização, que ainda não possui conta na plataforma, faz login com sua
identidade corporativa pela primeira vez. Se a política da organização permitir (e-mail
verificado, domínio autorizado, auto-provisionamento ativo), uma conta local é criada
automaticamente, vinculada à organização, com o papel padrão de menor privilégio — e ele já
entra na plataforma pronto para usar.

**Why this priority**: É o valor central da integração corporativa — usuários entram sem
cadastro manual, e a administração não precisa criar contas uma a uma. Sem isso, o login
federado só serviria a contas pré-existentes.

**Independent Test**: Testável com um usuário novo no provedor e uma organização com
auto-provisionamento ativo: após o primeiro login, verificar a conta criada, o vínculo com a
organização e o papel atribuído.

**Acceptance Scenarios**:

1. **Given** um usuário sem conta local, com e-mail verificado e domínio permitido pela
   política da organização, **When** ele completa o primeiro login corporativo, **Then** uma
   conta local é criada, vinculada à organização, com o papel padrão de menor privilégio.
2. **Given** um usuário sem conta local com e-mail não verificado no provedor, **When** ele
   tenta o primeiro login, **Then** o acesso é negado com orientação clara e nenhuma conta é
   criada.
3. **Given** uma organização com auto-provisionamento desligado, **When** um usuário sem conta
   tenta o primeiro login, **Then** o acesso é negado com orientação para contatar a
   administração, sem conta criada.
4. **Given** um usuário de domínio de e-mail não autorizado pela política, **When** ele tenta o
   primeiro login, **Then** o acesso é negado e o evento fica registrado para auditoria.

---

### User Story 2 - Identidade estável mesmo com troca de e-mail (Priority: P1)

Um usuário que já acessou a plataforma via identidade corporativa tem seu e-mail alterado no
provedor (mudança de nome, casamento, reorganização de domínio). No próximo login, ele continua
acessando a mesma conta, com os mesmos cursos, papéis e histórico — a identidade é reconhecida
pelo identificador estável do provedor, não pelo e-mail.

**Why this priority**: Evita o pior defeito de integrações federadas: contas duplicadas ou
troca de identidade por mudança de e-mail (ADR-05). É também a principal defesa contra
apropriação de conta por e-mail reciclado.

**Independent Test**: Testável alterando o e-mail de um usuário de teste no provedor e
verificando que o login seguinte cai na mesma conta local, sem criação de conta nova.

**Acceptance Scenarios**:

1. **Given** um usuário com identidade externa já vinculada, **When** seu e-mail muda no
   provedor e ele faz login, **Then** ele acessa a mesma conta local de antes, sem conta
   duplicada.
2. **Given** um novo usuário no provedor que recebe um e-mail antes pertencente a outra pessoa,
   **When** ele faz login, **Then** ele NÃO acessa a conta do antigo dono do e-mail — o vínculo
   é pelo identificador estável, e qualquer conflito interrompe o fluxo para revisão
   administrativa.

---

### User Story 3 - Vínculo seguro a conta pré-existente (Priority: P2)

Um usuário que já possui conta local (criada por cadastro nativo) faz seu primeiro login
corporativo. Quando a política da organização permite associação automática e o e-mail do
provedor é verificado e coincide com o da conta local, as identidades são vinculadas e ele
passa a poder entrar pelos dois caminhos. Em qualquer situação ambígua, o vínculo não é feito
automaticamente — o caso é interrompido e encaminhado para revisão administrativa.

**Why this priority**: Organizações que já usam a plataforma têm contas nativas; sem linking, o
primeiro login federado duplicaria usuários. É P2 porque depende das histórias P1 e tem
alternativa manual (revisão administrativa).

**Independent Test**: Testável com uma conta local pré-existente e um usuário do provedor com o
mesmo e-mail verificado: após o login, verificar que há uma única conta com os dois métodos de
acesso.

**Acceptance Scenarios**:

1. **Given** uma conta local cujo e-mail coincide com o e-mail verificado do provedor e uma
   política que permite associação, **When** o usuário faz o primeiro login corporativo,
   **Then** a identidade externa é vinculada à conta existente, sem conta nova.
2. **Given** o mesmo cenário mas com e-mail não verificado no provedor, **When** o usuário
   tenta o login, **Then** nenhum vínculo é criado e o acesso é negado com orientação.
3. **Given** um conflito (e-mail coincide com conta de outra organização, ou identidade externa
   já vinculada a outra conta), **When** o login é tentado, **Then** o fluxo é interrompido sem
   vínculo e o caso é sinalizado para revisão administrativa.

---

### User Story 4 - Sessão persistente e renovação transparente (Priority: P2)

Um usuário autenticado continua navegando pela plataforma ao longo do dia sem precisar fazer
login de novo: a sessão é renovada de forma transparente e segura, inclusive com múltiplas abas
abertas, e os artefatos de sessão permanecem inacessíveis ao JavaScript do navegador.

**Why this priority**: Sem renovação, o login federado obrigaria reautenticações frequentes,
anulando o benefício do SSO. É P2 porque a renovação já existe para o login nativo — aqui ela é
estendida à sessão federada.

**Independent Test**: Testável mantendo uma sessão ativa além do tempo de expiração do
credencial de curto prazo e verificando a renovação sem interação; repetir com abas
concorrentes.

**Acceptance Scenarios**:

1. **Given** uma sessão ativa próxima de expirar, **When** o usuário segue navegando, **Then**
   a sessão é renovada sem interação e sem interrupção perceptível.
2. **Given** duas abas do mesmo usuário renovando simultaneamente, **When** as renovações
   concorrem, **Then** nenhuma das abas perde a sessão.
3. **Given** um artefato de renovação já utilizado (replay), **When** ele é reapresentado,
   **Then** a renovação é negada e o evento é registrado.

---

### Edge Cases

- Identidade externa vinculada a usuário desativado localmente: login negado com mensagem
  adequada, sem recriar conta.
- Mesma pessoa em dois provedores (dois issuers): cada identidade externa é distinta; o vínculo
  de ambas à mesma conta requer política explícita, nunca fusão automática.
- Nome ou dados de perfil alterados no provedor: atualização do perfil local segue política
  definida, sem sobrescrever silenciosamente dados editados pelo usuário.
- Organização removida ou desativada entre logins: o login federado é negado com orientação,
  sem exclusão de dados.
- Auto-provisionamento desativado após contas já criadas: contas existentes continuam entrando;
  apenas novas contas deixam de ser criadas.
- Registro de auditoria nunca contém tokens, códigos ou segredos — somente issuer, subject,
  usuário, organização, resultado e motivo.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE identificar cada usuário federado pela combinação
  emissor + identificador estável (issuer + subject), única em toda a plataforma; e-mail NUNCA
  é a chave da identidade.
- **FR-002**: O sistema DEVE persistir cada identidade externa com: usuário local associado,
  organização do fluxo (quando houver), emissor normalizado, identificador estável, tipo de
  provedor, e-mail no momento do vínculo (somente auditoria) e datas de criação e último uso.
- **FR-003**: No primeiro acesso, o sistema DEVE aplicar, nesta ordem: localizar identidade
  externa existente; se ausente, verificar e-mail verificado, domínio permitido e política de
  auto-provisionamento antes de criar qualquer conta.
- **FR-004**: O sistema NUNCA DEVE vincular identidade externa a conta existente com base em
  e-mail não verificado; associação automática por e-mail exige e-mail verificado E política da
  organização que a permita.
- **FR-005**: Em qualquer conflito de identidade (e-mail coincidente com conta de outra
  organização, identidade já vinculada a outra conta, dados inconsistentes), o sistema DEVE
  interromper o fluxo sem criar vínculo e sinalizar o caso para revisão administrativa.
- **FR-006**: Contas criadas por provisionamento DEVEM receber o papel padrão de menor
  privilégio definido pela organização; nenhum papel administrativo é atribuído
  automaticamente a partir de dados do provedor.
- **FR-007**: A mudança de e-mail no provedor NÃO DEVE criar conta nova nem transferir
  identidade; o acesso permanece na conta vinculada ao identificador estável.
- **FR-008**: A autorização de cursos, organizações e administração DEVE permanecer regida
  exclusivamente pelos papéis internos da plataforma; papéis e grupos do provedor não alteram
  permissões locais nesta feature.
- **FR-009**: A sessão federada DEVE usar o mesmo mecanismo de sessão interna do login nativo,
  com credenciais em cookies inacessíveis ao JavaScript, seguras fora de ambiente local, e com
  renovação por rotação — artefato de renovação usado é invalidado.
- **FR-010**: Renovações concorrentes legítimas (múltiplas abas/dispositivos) NÃO DEVEM
  derrubar a sessão; reapresentação de artefato já rotacionado DEVE ser negada e registrada.
- **FR-011**: O sistema DEVE registrar eventos de auditoria para provisionamento, vínculo,
  negação (com motivo), conflito e renovação — sem tokens, códigos ou segredos.

### Key Entities

- **Identidade Externa (ExternalIdentity)**: o vínculo entre um usuário local e uma identidade
  federada — emissor + identificador estável (único), usuário, organização opcional, tipo de
  provedor, e-mail no momento do vínculo (auditoria), criação e último uso.
- **Política de Provisionamento**: regras da organização — auto-provisionamento ligado ou
  desligado, domínios de e-mail permitidos, papel padrão de menor privilégio e permissão (ou
  não) de associação automática por e-mail verificado.
- **Conta Local**: o usuário da plataforma, com seus papéis, organizações e histórico —
  inalterado em estrutura; ganha a possibilidade de múltiplos métodos de acesso.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos primeiros acessos conformes à política (e-mail verificado, domínio
  permitido, auto-provisionamento ativo) terminam com conta criada e utilizável em uma única
  passagem, sem intervenção administrativa.
- **SC-002**: Zero vínculos criados a partir de e-mail não verificado, comprovado por testes
  automatizados de todos os caminhos de vínculo.
- **SC-003**: Zero contas duplicadas após mudança de e-mail no provedor, comprovado por teste
  de regressão dedicado.
- **SC-004**: 100% dos conflitos de identidade terminam sem vínculo automático e com registro
  visível para revisão administrativa.
- **SC-005**: Usuários mantêm sessão ativa ao longo de um dia de uso típico sem novo login, e
  renovações concorrentes em até 5 abas simultâneas não causam perda de sessão.
- **SC-006**: As permissões de cursos e administração de usuários pré-existentes não apresentam
  nenhuma regressão após a ativação do provisionamento (verificado pela suíte de autorização).

## Assumptions

- Depende da feature `001-fundacao-oidc-keycloak` (login e validação); esta feature começa no
  ponto em que a identidade do provedor já foi validada criptograficamente.
- A política de provisionamento padrão para novas organizações é restritiva: associação
  automática por e-mail desligada e auto-provisionamento desligado até configuração explícita
  (a interface de configuração é a feature `004-admin-config-oidc`).
- O modelo proposto no plano (automático, convite prévio ou híbrido) está pendente de decisão
  de produto; esta especificação cobre os três por configuração, com padrão restritivo.
- Mapeamento de grupos e papéis do provedor para papéis locais está fora do escopo (item P2 do
  backlog); contas sem mapeamento recebem sempre o papel padrão de menor privilégio.
- Sincronização administrativa de usuários (SCIM) está fora do escopo do primeiro release.
- A vinculação da renovação local à sessão do provedor (renovação upstream) é tratada na
  feature `003-logout-revogacao`, que rege revogação e encerramento coordenado.
