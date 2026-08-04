# Especificação de Feature: Logout Coordenado e Revogação de Sessão

**Feature Branch**: `003-logout-revogacao`

**Created**: 2026-08-03

**Status**: Draft

**Input**: Descrição do usuário: "Crie especificações para implementar cada feature do documento
Plano_Implementacao_Fork_Keycloak_Identidade_Visual.docx" — Fase 3 do roteiro: Logout e
governança (RP logout, back-channel, revogação, políticas e observabilidade).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sair encerra a sessão por completo (Priority: P1)

Um usuário autenticado via identidade corporativa clica em "Sair". A sessão na plataforma é
encerrada, os cookies de sessão são removidos e a sessão SSO no provedor também é finalizada
conforme a política — de modo que um novo acesso exija autenticação novamente, e a sessão do
provedor não permaneça ativa inadvertidamente (ADR-06).

**Why this priority**: Em computadores compartilhados (laboratórios, bibliotecas — cenário
típico de plataformas educacionais), um logout que deixa o SSO ativo permite que a próxima
pessoa entre com um clique. É o requisito central da feature.

**Independent Test**: Testável com um usuário autenticado: sair, tentar acessar uma página
autenticada (deve exigir login) e iniciar novo login (deve exigir credenciais no provedor, não
entrar silenciosamente).

**Acceptance Scenarios**:

1. **Given** um usuário autenticado via provedor corporativo, **When** ele clica em "Sair",
   **Then** a sessão local é revogada, todos os cookies de sessão aplicáveis são removidos e
   ele é conduzido ao encerramento da sessão no provedor, retornando a uma página pública
   previamente cadastrada.
2. **Given** um logout concluído, **When** o usuário tenta acessar uma página autenticada,
   **Then** é exigido novo login.
3. **Given** um logout concluído com encerramento SSO, **When** o usuário inicia novo login
   corporativo, **Then** o provedor exige credenciais novamente em vez de autenticar
   silenciosamente.
4. **Given** um usuário autenticado por e-mail e senha (login nativo), **When** ele sai,
   **Then** o logout local funciona exatamente como hoje, sem redirecionamento ao provedor.

---

### User Story 2 - Revogação corporativa encerra o acesso (Priority: P1)

Um administrador corporativo desativa um usuário no provedor de identidade (desligamento,
suspensão, incidente de segurança). Dentro do prazo definido pela política, todas as sessões
desse usuário na plataforma são encerradas — sem depender de o usuário sair voluntariamente.

**Why this priority**: É o principal risco listado no plano ("sessão local sobrevive à
revogação upstream" — impacto alto). Sem isso, um colaborador desligado continua acessando
cursos e dados da organização.

**Independent Test**: Testável desativando um usuário de teste no provedor e medindo o tempo
até que suas sessões ativas na plataforma sejam encerradas.

**Acceptance Scenarios**:

1. **Given** um usuário com sessão ativa na plataforma, **When** ele é desativado ou tem a
   sessão revogada no provedor, **Then** suas sessões locais são encerradas dentro do SLA
   definido pela política da organização.
2. **Given** a notificação de logout do provedor (back-channel) recebida para uma sessão,
   **When** ela é validada, **Then** as sessões locais associadas àquela sessão do provedor são
   revogadas imediatamente.
3. **Given** um usuário revogado no provedor, **When** a plataforma tenta renovar a sessão
   local, **Then** a renovação verifica primeiro a situação no provedor, é negada
   definitivamente e a sessão local é encerrada.

---

### User Story 3 - Falha transitória não derruba o usuário (Priority: P2)

Durante uma indisponibilidade temporária do provedor (timeout, erro de rede, manutenção), um
usuário com sessão ativa continua trabalhando: a renovação distingue falha transitória de
rejeição definitiva, preserva a sessão dentro dos limites da política e tenta novamente —
apenas a rejeição definitiva encerra a sessão.

**Why this priority**: Sem essa distinção, qualquer instabilidade do provedor derrubaria todos
os usuários ativos — risco de "dependência excessiva do Keycloak" apontado no plano. É P2 por
ser refinamento de resiliência sobre o comportamento P1.

**Independent Test**: Testável simulando indisponibilidade do provedor durante renovações e
verificando que sessões ativas sobrevivem dentro do limite da política, e que uma rejeição
definitiva (usuário desabilitado) encerra a sessão mesmo nesse cenário.

**Acceptance Scenarios**:

1. **Given** o provedor temporariamente indisponível, **When** uma renovação de sessão ocorre,
   **Then** a sessão é preservada e uma nova tentativa é feita depois, sem encerramento.
2. **Given** o provedor responde com rejeição definitiva (credencial revogada, usuário
   desabilitado), **When** a renovação ocorre, **Then** a sessão local é encerrada
   imediatamente.
3. **Given** indisponibilidade prolongada além do tempo máximo de sessão definido pela
   política, **When** o limite é atingido, **Then** a sessão expira e o usuário precisa
   autenticar-se novamente quando o provedor voltar.

---

### Edge Cases

- Logout com cookies em dois escopos (host-only e de domínio): ambos os conjuntos devem ser
  removidos; nenhum cookie residual pode manter a sessão viva.
- Notificação back-channel referente a sessão já encerrada ou desconhecida: processada de forma
  idempotente, sem erro visível e com registro de auditoria.
- Notificação back-channel inválida (assinatura incorreta, emissor inesperado): rejeitada sem
  efeito sobre sessões, com registro do evento.
- Usuário com múltiplos dispositivos: a revogação no provedor encerra as sessões de todos os
  dispositivos associados àquela identidade, conforme a política.
- Destino de retorno pós-logout: somente destinos previamente cadastrados; tentativa de retorno
  a URL arbitrária é rejeitada.
- Logout iniciado com sessão já expirada: conduz à página pública normalmente, sem erro.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Ao sair, o sistema DEVE revogar a sessão local e invalidar o artefato de
  renovação interno antes de qualquer redirecionamento.
- **FR-002**: Ao sair, o sistema DEVE remover todas as variantes de cookies de sessão
  aplicáveis (host-only e com escopo de domínio).
- **FR-003**: Para sessões iniciadas via provedor corporativo, o logout DEVE conduzir o
  navegador ao encerramento de sessão do provedor, com identificação do cliente e destino de
  retorno previamente cadastrado.
- **FR-004**: O sistema DEVE aceitar notificações de logout do provedor (back-channel),
  validá-las criptograficamente e revogar as sessões locais associadas à sessão do provedor
  identificada.
- **FR-005**: A cada renovação de sessão local de origem federada, o sistema DEVE validar ou
  renovar primeiro a sessão junto ao provedor; somente depois rotacionar o artefato de
  renovação local.
- **FR-006**: Rejeição definitiva do provedor (revogação, usuário desabilitado) DEVE encerrar a
  sessão local imediatamente; falha transitória DEVE preservar a sessão e permitir nova
  tentativa, dentro de um tempo máximo de sessão definido por política.
- **FR-007**: Toda sessão de origem federada DEVE ter um tempo máximo de vida absoluto, mesmo
  sem qualquer sinal do provedor, configurável por política.
- **FR-008**: O sistema DEVE registrar eventos de auditoria duráveis para logout local, logout
  iniciado pela aplicação, notificação back-channel aceita, revogação e encerramento por
  política; notificações back-channel rejeitadas DEVEM gerar registro em log estruturado de
  auditoria operacional, sem atribuição de usuário. Em ambos os canais, os registros NÃO PODEM
  conter tokens ou segredos.
- **FR-009**: O sistema DEVE expor métricas operacionais que permitam distinguir falhas
  transitórias de rejeições definitivas e alertar sobre aumento anormal de revogações ou erros.
- **FR-010**: O logout de sessões nativas (e-mail e senha) DEVE permanecer funcional e
  inalterado para o usuário final.

### Key Entities

- **Sessão Upstream**: o vínculo entre a sessão local e a sessão no provedor — identificador de
  sessão do provedor (sid), artefato de renovação upstream protegido, situação e datas.
- **Evento de Revogação**: registro de encerramento de sessão — origem (logout do usuário,
  back-channel, renovação negada, política), sessões afetadas e momento.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Após "Sair", 100% das tentativas de acesso autenticado exigem novo login, e o
  novo login corporativo exige credenciais no provedor (sem SSO silencioso), em todos os
  navegadores suportados.
- **SC-002**: A desativação de um usuário no provedor encerra todas as suas sessões na
  plataforma dentro do SLA definido pela política (imediato com back-channel habilitado; no
  máximo até a próxima renovação, sem exceder o tempo configurado).
- **SC-003**: Zero cookies de sessão válidos remanescentes após logout, verificado por
  inspeção automatizada das duas variantes de escopo.
- **SC-004**: Durante uma indisponibilidade simulada do provedor de até 10 minutos, ao menos
  95% das sessões ativas permanecem utilizáveis, e 100% das rejeições definitivas ainda
  encerram sessão.
- **SC-005**: Notificações back-channel inválidas têm efeito zero sobre sessões ativas em 100%
  dos testes negativos.

## Assumptions

- Depende das features `001-fundacao-oidc-keycloak` e `002-identidade-provisionamento` (sessões
  federadas existentes e identificador de sessão do provedor capturado no login).
- O SLA de revogação é uma decisão pendente do plano (imediato por back-channel ou janela curta
  por renovação); esta especificação exige suporte a ambos, com o SLA efetivo definido por
  configuração da organização. Padrão assumido: back-channel habilitado quando o provedor
  oferecer, com janela de renovação curta como garantia mínima.
- O provedor suporta logout iniciado pela aplicação e back-channel logout (recursos padrão do
  Keycloak); quando o back-channel estiver desabilitado, a garantia recai sobre a renovação.
- A observabilidade usa a infraestrutura de métricas e auditoria existente da plataforma; esta
  feature define o que registrar, não uma nova plataforma de monitoramento.
- Runbooks operacionais (indisponibilidade do provedor, rotação de segredo) são produzidos como
  parte desta feature, mas a operação de produção (Fase 6 do plano) está fora do escopo.
