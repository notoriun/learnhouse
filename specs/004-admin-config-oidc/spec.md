# Especificação de Feature: Administração da Configuração OIDC

**Feature Branch**: `004-admin-config-oidc`

**Created**: 2026-08-03

**Status**: Draft

**Input**: Descrição do usuário: "Crie especificações para implementar cada feature do documento
Plano_Implementacao_Fork_Keycloak_Identidade_Visual.docx" — item P1 do backlog: Administração
da configuração OIDC (issuer, client, políticas de provisionamento, segredo mascarado e
validação anti-SSRF).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configurar o provedor de identidade da organização (Priority: P1)

Um administrador da organização acessa as configurações de autenticação, informa os dados do
provedor corporativo (endereço do emissor, identificador do cliente, segredo e escopos), testa
a conexão e ativa o login corporativo — sem editar arquivos ou acionar suporte técnico.

**Why this priority**: Sem uma interface de configuração, cada organização exigiria intervenção
manual da operação para habilitar o SSO. É a porta de entrada administrativa de toda a
integração.

**Independent Test**: Testável configurando um provedor de desenvolvimento pela interface,
validando a conexão e completando um login corporativo em seguida.

**Acceptance Scenarios**:

1. **Given** um administrador na tela de configurações de autenticação, **When** ele informa
   emissor, cliente, segredo e escopos válidos e testa a conexão, **Then** o sistema confirma a
   descoberta dos endpoints do provedor e permite ativar o login corporativo.
2. **Given** um endereço de emissor inválido ou inacessível, **When** o administrador testa a
   conexão, **Then** recebe uma mensagem de erro clara em português, sem ativação.
3. **Given** uma configuração ativa, **When** o administrador desativa o provedor, **Then** o
   botão de login corporativo deixa de aparecer para a organização e as sessões já ativas
   seguem a política de sessão vigente.
4. **Given** um usuário sem papel administrativo, **When** ele tenta acessar ou alterar a
   configuração, **Then** o acesso é negado.

---

### User Story 2 - Segredo protegido de ponta a ponta (Priority: P1)

Um administrador cadastra o segredo do cliente OIDC uma única vez. A partir daí, nenhuma tela,
resposta de API, exportação ou registro exibe o valor — a interface mostra apenas que "há um
segredo configurado", e a única operação possível é substituí-lo por um novo.

**Why this priority**: O vazamento do segredo OIDC é classificado como risco de impacto alto no
plano. A proteção deve nascer com a tela de administração, não ser adicionada depois.

**Independent Test**: Auditável inspecionando todas as respostas administrativas, o código
entregue ao navegador e os registros de log após cadastrar um segredo conhecido: o valor não
pode aparecer em nenhum deles.

**Acceptance Scenarios**:

1. **Given** um segredo cadastrado, **When** o administrador reabre a tela de configuração,
   **Then** vê apenas a indicação de segredo configurado, nunca o valor.
2. **Given** um segredo cadastrado, **When** as respostas administrativas e os registros do
   sistema são auditados, **Then** o valor do segredo não aparece em nenhum deles.
3. **Given** a necessidade de rotação, **When** o administrador informa um novo segredo,
   **Then** o anterior é substituído e o novo passa a valer sem interrupção do login.

---

### User Story 3 - Políticas de provisionamento configuráveis (Priority: P2)

Um administrador define, pela mesma interface, como a organização admite usuários federados:
auto-provisionamento ligado ou desligado, domínios de e-mail permitidos, papel padrão de menor
privilégio e exigências de autenticação (nível mínimo e tolerância de relógio) — e as mudanças
passam a valer nos próximos logins.

**Why this priority**: Dá autonomia às organizações sobre a política de admissão descrita na
feature `002-identidade-provisionamento`. É P2 porque um padrão restritivo seguro cobre o
intervalo até a configuração fina.

**Independent Test**: Testável alterando cada política e verificando o efeito no login seguinte
de um usuário de teste (admitido, negado por domínio, papel atribuído).

**Acceptance Scenarios**:

1. **Given** auto-provisionamento desligado, **When** o administrador o ativa com domínio
   permitido e papel padrão definidos, **Then** o próximo primeiro acesso conforme cria conta
   com esse papel.
2. **Given** uma lista de domínios permitidos, **When** um usuário de domínio fora da lista
   tenta o primeiro acesso, **Then** é negado conforme a política.
3. **Given** uma mudança de política, **When** ela é salva, **Then** fica registrada em
   auditoria (quem, quando, o que mudou) e vale para os próximos logins sem afetar sessões já
   ativas.

---

### Edge Cases

- Endereço de emissor apontando para rede interna, endereço local ou serviço de metadados de
  nuvem: rejeitado pela validação de segurança (anti-SSRF), com mensagem clara.
- Emissor sem HTTPS: rejeitado em qualquer ambiente não local.
- Provedor com descoberta lenta ou intermitente durante o teste de conexão: tempo limite com
  mensagem de erro distinguindo "inacessível" de "configuração inválida".
- Configuração salva mas provedor posteriormente reconfigurado (rotação de chaves, mudança de
  endpoints): o sistema acompanha pela descoberta periódica; erros passam a ser reportados na
  tela de configuração.
- Duas organizações apontando para o mesmo emissor: permitido; cada organização tem sua própria
  configuração e política, sem interferência.
- Exclusão da configuração com identidades externas já vinculadas: exige confirmação explícita,
  desativa o login corporativo e preserva contas e vínculos para eventual reativação.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Administradores da organização DEVEM poder cadastrar, editar, testar, ativar,
  desativar e excluir a configuração do provedor OIDC pela interface administrativa; usuários
  sem papel administrativo NÃO DEVEM ter acesso.
- **FR-002**: A configuração DEVE incluir: endereço do emissor, identificador do cliente,
  segredo, escopos, situação (ativo/inativo), domínios de e-mail permitidos, chave de
  auto-provisionamento, papel padrão, nível mínimo de autenticação exigido e tolerância de
  relógio.
- **FR-003**: O sistema DEVE validar o endereço do emissor antes de salvar: HTTPS obrigatório
  fora de ambiente local, resolução bloqueada para redes privadas, endereços locais e
  link-local, e descoberta OIDC bem-sucedida.
- **FR-004**: O segredo do cliente DEVE ser armazenado cifrado com chave mantida fora do banco
  de dados, e NUNCA DEVE ser retornado em leituras administrativas, exportações, respostas de
  API, código entregue ao navegador ou registros — leituras informam apenas se há segredo
  configurado.
- **FR-005**: A única operação sobre um segredo existente DEVE ser a substituição por um novo
  valor, sem interrupção dos logins em andamento.
- **FR-006**: O sistema DEVE oferecer um teste de conexão que confirme descoberta dos endpoints
  e coerência da configuração, com mensagens de erro em português que distingam configuração
  inválida de provedor inacessível.
- **FR-007**: A desativação da configuração DEVE remover a opção de login corporativo da
  organização imediatamente, sem afetar contas, vínculos ou o login nativo.
- **FR-008**: Toda criação, alteração, ativação, desativação e exclusão de configuração DEVE
  gerar registro de auditoria com autor, momento e campos alterados — sem incluir o segredo.
- **FR-009**: Mudanças de política DEVEM valer para os próximos logins, sem encerrar sessões já
  ativas (o encerramento de sessões é regido pela feature `003-logout-revogacao`).

### Key Entities

- **Configuração do Provedor OIDC**: os dados de conexão e política de uma organização —
  emissor, cliente, segredo (cifrado), escopos, situação, domínios permitidos,
  auto-provisionamento, papel padrão, exigências de autenticação e tolerâncias.
- **Registro de Auditoria Administrativa**: trilha de mudanças de configuração — autor, data,
  operação e campos alterados (sem valores sensíveis).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um administrador configura e ativa um provedor válido, do zero ao primeiro login
  corporativo bem-sucedido, em menos de 15 minutos, sem intervenção da operação da plataforma.
- **SC-002**: O valor do segredo não aparece em nenhuma resposta administrativa, exportação,
  código entregue ao navegador ou registro de log — zero ocorrências em auditoria automatizada
  após cadastro de um segredo conhecido.
- **SC-003**: 100% das tentativas de configurar emissores maliciosos ou internos (endereços
  privados, locais, link-local, sem HTTPS) são rejeitadas nos testes de segurança.
- **SC-004**: 100% das mudanças de configuração aparecem na trilha de auditoria com autor e
  momento corretos.
- **SC-005**: Após desativação do provedor, o botão de login corporativo desaparece da página
  de login da organização imediatamente (próximo carregamento da página).

## Assumptions

- Depende da feature `001-fundacao-oidc-keycloak` (que consome esta configuração) e complementa
  a `002-identidade-provisionamento` (que aplica as políticas aqui definidas).
- O papel autorizado a gerenciar a configuração é o de administrador da organização, seguindo o
  modelo de papéis interno existente; nenhuma permissão nova de plataforma é criada.
- Uma organização possui no máximo um provedor OIDC ativo por vez no primeiro release;
  múltiplos provedores simultâneos ficam para evolução futura.
- O mapeamento de grupos do provedor para papéis locais (item P2 do backlog) está fora do
  escopo; quando existir, será uma extensão desta tela com lista de permissões explícita.
- A chave de cifragem do segredo é provisionada pela operação (variável de ambiente ou cofre de
  segredos), fora do banco de dados, conforme exigência do plano.
- A topologia do provedor (realm dedicado ou corporativo) é decisão pendente de
  Segurança/Infra; esta feature é neutra — aceita qualquer emissor válido que passe na
  validação.
