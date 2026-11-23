# Especificação de Feature: Login Corporativo via Keycloak (Fundação OIDC)

**Feature Branch**: `001-fundacao-oidc-keycloak`

**Created**: 2026-08-03

**Status**: Draft

**Input**: Descrição do usuário: "Crie especificações para implementar cada feature do documento
Plano_Implementacao_Fork_Keycloak_Identidade_Visual.docx" — Fase 1 do roteiro: Fundação OIDC
(configuração Keycloak, discovery, state/nonce/PKCE, authorize e callback server-side).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Login com identidade corporativa (Priority: P1)

Um usuário (aluno, instrutor ou administrador) acessa a página de login da sua organização e
escolhe "Entrar com identidade corporativa". Ele é redirecionado ao Keycloak, autentica-se com
suas credenciais corporativas (incluindo MFA quando exigido pelo provedor) e retorna à
plataforma já autenticado, na página de destino esperada, com uma sessão interna válida.

**Why this priority**: É o núcleo da feature — sem o fluxo de login funcional, nenhuma das
demais capacidades (provisionamento, logout, administração) tem valor. Entrega o login técnico
validado exigido como saída de aprovação da Fase 1.

**Independent Test**: Pode ser testado de ponta a ponta com um realm de desenvolvimento e um
usuário de teste: iniciar o login na página da organização, autenticar no Keycloak e verificar
que a sessão interna foi criada e a página de destino carregou.

**Acceptance Scenarios**:

1. **Given** um usuário com credenciais válidas no provedor corporativo da organização,
   **When** ele escolhe "Entrar com identidade corporativa" e conclui a autenticação no
   provedor, **Then** ele retorna à plataforma autenticado, com sessão interna ativa, na página
   de destino solicitada.
2. **Given** um usuário que cancela a autenticação no provedor, **When** ele retorna à
   plataforma, **Then** vê a página de login com uma mensagem clara de que o acesso não foi
   concluído, sem sessão criada.
3. **Given** um fluxo de login iniciado para a organização A, **When** a resposta do provedor
   retorna, **Then** a sessão criada pertence ao contexto da organização A e o destino final é
   um caminho interno da própria plataforma.

---

### User Story 2 - Nenhum token exposto ao navegador (Priority: P1)

Um responsável de segurança audita o fluxo de login e confirma que nenhum token de
autenticação do provedor (access, refresh ou ID token) transita pelo JavaScript do navegador,
por fragmentos de URL ou por armazenamento local — todo o processamento sensível ocorre no
servidor, e o navegador recebe apenas cookies de sessão adequados e redirects internos.

**Why this priority**: É uma exigência de segurança inegociável do plano (ADR-02, ADR-03) e um
critério de aceite do primeiro release. Um vazamento aqui compromete toda a arquitetura.

**Independent Test**: Auditável de forma independente com as ferramentas de desenvolvedor do
navegador: inspecionar todas as respostas de rede, o estado da aplicação e o armazenamento
local durante um login completo e confirmar a ausência de tokens do provedor.

**Acceptance Scenarios**:

1. **Given** um login completo bem-sucedido, **When** todas as respostas de rede visíveis ao
   navegador são inspecionadas, **Then** nenhuma contém access token, refresh token ou ID token
   do provedor.
2. **Given** um login completo bem-sucedido, **When** localStorage, sessionStorage e o estado
   da aplicação no navegador são inspecionados, **Then** nenhum token do provedor está presente.
3. **Given** o retorno do provedor após autenticação, **When** a URL de retorno é inspecionada,
   **Then** ela contém apenas código de autorização e state — nunca tokens em fragmento de URL.

---

### User Story 3 - Falhas de autenticação tratadas com segurança (Priority: P2)

Um usuário cujo fluxo de login falha (parâmetro de segurança inválido, código expirado,
resposta adulterada ou provedor indisponível) recebe uma mensagem de erro clara em português e
pode tentar novamente — e em nenhum caso de falha uma sessão é criada.

**Why this priority**: Falhas são frequentes em fluxos federados (timeouts, replays, links
antigos). Tratá-las sem criar sessão é requisito de segurança; tratá-las com clareza é
requisito de experiência.

**Independent Test**: Testável simulando cada condição de falha (state reutilizado, código
expirado, assinatura inválida, provedor fora do ar) e verificando a mensagem exibida e a
ausência de sessão.

**Acceptance Scenarios**:

1. **Given** um retorno de login com parâmetro de segurança (state) inválido, reutilizado ou
   expirado, **When** o callback é processado, **Then** o acesso é negado com mensagem clara e
   nenhuma sessão é criada.
2. **Given** um código de autorização expirado ou já utilizado, **When** o callback tenta
   trocá-lo, **Then** o acesso é negado sem sessão e o usuário pode reiniciar o login.
3. **Given** o provedor de identidade indisponível, **When** o usuário tenta iniciar o login,
   **Then** recebe uma mensagem de indisponibilidade temporária, sem erro técnico exposto.

---

### Edge Cases

- State ou nonce reutilizado (replay): a tentativa deve falhar sem sessão, mesmo que os demais
  parâmetros sejam válidos — os valores são de uso único e expiram rapidamente.
- Rotação de chaves do provedor durante uma sessão de login: a validação deve obter as chaves
  atualizadas e concluir ou falhar de forma segura, nunca aceitar assinatura inválida.
- Token com issuer, audience ou cliente autorizado incorretos: rejeição sem sessão, com
  registro de auditoria.
- Pequenas diferenças de relógio entre plataforma e provedor: tolerância limitada e
  configurável; fora dela, rejeição.
- Usuário abre múltiplas abas e inicia logins simultâneos: cada fluxo tem seus próprios
  parâmetros de uso único; a conclusão de um não pode ser aceita com parâmetros de outro.
- Destino de redirecionamento manipulado (open redirect): apenas caminhos relativos internos ou
  destinos previamente cadastrados são aceitos; URLs do tipo `//host` e esquemas externos são
  rejeitados.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE oferecer a opção "Entrar com identidade corporativa" na página de
  login das organizações que tiverem um provedor de identidade configurado e ativo.
- **FR-002**: O sistema DEVE conduzir a autenticação pelo fluxo OIDC Authorization Code com
  PKCE (S256), sem uso de fluxo implícito e sem tokens em fragmentos de URL.
- **FR-003**: O sistema DEVE gerar, para cada fluxo de login, parâmetros de segurança (state,
  nonce e verificador PKCE) aleatórios, de uso único, com validade curta e vinculados à
  organização e ao destino solicitados.
- **FR-004**: O sistema DEVE processar o retorno do provedor exclusivamente no servidor; access
  tokens, refresh tokens e ID tokens do provedor NÃO DEVEM transitar pelo JavaScript do
  navegador nem ser gravados em armazenamento local do navegador.
- **FR-005**: O sistema DEVE validar integralmente o token de identidade recebido: assinatura,
  emissor esperado, audiência e cliente autorizado, janelas de validade temporal e
  correspondência do nonce — rejeitando o login se qualquer verificação falhar.
- **FR-006**: O sistema DEVE descobrir os endpoints do provedor a partir do issuer configurado
  e manter as chaves públicas de validação atualizadas, tolerando rotação de chaves.
- **FR-007**: Após validação bem-sucedida, o sistema DEVE emitir a sessão interna da plataforma
  (mesmo modelo de sessão já usado pelo login nativo), gravada em cookies seguros e inacessíveis
  ao JavaScript.
- **FR-008**: O sistema DEVE redirecionar o usuário, ao final do login, somente para caminhos
  internos sanitizados ou destinos previamente cadastrados.
- **FR-009**: Toda falha de validação DEVE resultar em negação de acesso sem criação de sessão,
  com mensagem de erro em português compreensível ao usuário final e registro de auditoria sem
  dados sensíveis.
- **FR-010**: O sistema DEVE registrar eventos de auditoria para início de fluxo, callback,
  sucesso e cada tipo de falha, sem incluir códigos, tokens ou segredos nos registros.
- **FR-011**: A indisponibilidade do provedor de identidade NÃO DEVE afetar sessões internas já
  ativas nem o login nativo por e-mail e senha das organizações que o utilizam.

### Key Entities

- **Fluxo de autenticação**: representa uma tentativa de login em andamento — parâmetros de
  segurança de uso único (state, nonce, verificador), organização de origem, destino solicitado
  e expiração curta.
- **Sessão interna**: a sessão da plataforma emitida após o login federado — idêntica em
  direitos e formato à sessão emitida pelo login nativo, sem privilégios adicionais.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um usuário corporativo completa o login — da escolha da opção até a página de
  destino — em menos de 15 segundos em condições normais de rede, sem etapas manuais além da
  autenticação no provedor.
- **SC-002**: 100% dos casos negativos de validação (state inválido/reutilizado, nonce
  incorreto, código expirado, emissor/audiência incorretos, assinatura inválida, chave
  desconhecida) terminam sem sessão criada, comprovados por testes automatizados.
- **SC-003**: Nenhum token do provedor é encontrado em respostas de rede acessíveis ao
  navegador, no armazenamento local ou no estado da aplicação, em auditoria com ferramentas de
  desenvolvedor durante um ciclo completo de login.
- **SC-004**: O login nativo por e-mail e senha continua funcionando sem regressão para todas
  as organizações, com e sem provedor configurado.
- **SC-005**: Com o provedor de identidade indisponível, usuários já autenticados continuam
  navegando normalmente e novos logins nativos não são afetados.

## Assumptions

- O provedor de identidade é um Keycloak operado pela própria organização (realm dedicado ao
  produto, conforme recomendação do plano), configurado como cliente confidencial com fluxo
  padrão ativado, fluxo implícito desativado e PKCE S256 obrigatório.
- MFA, políticas de senha e federação LDAP/AD são responsabilidade do Keycloak; a plataforma
  não repete desafio de MFA local para logins via SSO.
- A sessão interna existente da plataforma (formato, expiração e renovação) é reutilizada sem
  alteração de contrato; esta feature apenas adiciona uma nova porta de entrada.
- Escopo desta feature: apenas o fluxo de login e a validação. Provisionamento de usuários,
  vínculo de identidade externa e política de primeiro acesso são a feature
  `002-identidade-provisionamento`; logout coordenado é a feature `003-logout-revogacao`;
  a tela de administração do provedor é a feature `004-admin-config-oidc`.
- A implementação usa exclusivamente o código público AGPL e os padrões OIDC — nenhum código do
  módulo Enterprise do LearnHouse é copiado, ativado ou consultado.
- Em organizações com o SSO Enterprise habilitado, o login corporativo Keycloak (OSS) tem
  precedência e apenas um botão de identidade corporativa é exibido na página de login; o fluxo
  SSO Enterprise não é reutilizado — a integração limita-se à interface pública de login
  (a página de login AGPL do repositório público).
- SAML e sincronização SCIM estão fora do escopo do primeiro ciclo.
