# Especificação de Feature: Conformidade AGPL e Oferta de Código-Fonte

**Feature Branch**: `006-conformidade-agpl`

**Created**: 2026-08-03

**Status**: Draft

**Input**: Descrição do usuário: "Crie especificações para implementar cada feature do documento
Plano_Implementacao_Fork_Keycloak_Identidade_Visual.docx" — seção 11 do plano e item P1 do
backlog: Licenciamento, atribuição e oferta do código-fonte correspondente.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Usuário remoto acessa o código-fonte correspondente (Priority: P1)

Qualquer usuário que interage com a plataforma pela rede encontra, em local visível da
aplicação, um link "Código-fonte" (ou "Licença") que o leva ao código-fonte completo e
correspondente à exata versão que está utilizando — atendendo à obrigação central da AGPL-3.0
para versões modificadas oferecidas como serviço.

**Why this priority**: É a obrigação jurídica que viabiliza o fork; o descumprimento é
classificado como risco de impacto alto no plano. Sem isso, nenhuma release pode ir a produção.

**Independent Test**: Testável acessando a aplicação como usuário final, seguindo o link e
conferindo que o código obtido corresponde à versão em execução.

**Acceptance Scenarios**:

1. **Given** um usuário em qualquer página da aplicação, **When** ele procura a origem do
   software, **Then** encontra um link visível de código-fonte/licença em no máximo dois
   cliques.
2. **Given** o link de código-fonte, **When** o usuário o segue, **Then** obtém acesso ao
   código completo da versão em execução, sem custo e sem barreiras além das previstas pelo
   modelo de implantação.
3. **Given** uma versão implantada, **When** o código oferecido é comparado com ela, **Then**
   corresponde à mesma release (mesma identificação de versão).

---

### User Story 2 - Release sempre acompanhada da fonte correspondente (Priority: P1)

O responsável pela publicação de uma nova versão tem um processo automatizado que gera e
disponibiliza o pacote de código-fonte correspondente junto de cada release implantada —
incluindo os scripts necessários para gerar, instalar e executar a versão entregue, sem
segredos operacionais — de modo que a conformidade não dependa de disciplina manual.

**Why this priority**: A obrigação da AGPL é contínua: cada versão implantada precisa da sua
fonte. Um processo manual falharia na primeira release apressada. A automação no processo de
publicação é a mitigação prevista no plano.

**Independent Test**: Testável publicando uma release em ambiente de teste e verificando que o
pacote de fonte correspondente foi gerado, publicado e validado automaticamente.

**Acceptance Scenarios**:

1. **Given** o processo de publicação de release, **When** uma nova versão é publicada,
   **Then** o pacote de código-fonte correspondente é gerado e disponibilizado
   automaticamente no mesmo processo.
2. **Given** o pacote de fonte de uma release, **When** inspecionado, **Then** contém o código
   completo e os scripts de geração, instalação e execução — e nenhum segredo operacional
   (chaves, senhas, tokens, configuração de produção).
3. **Given** uma tentativa de publicar release sem a fonte correspondente, **When** o processo
   executa, **Then** a publicação falha com erro claro.
4. **Given** uma imagem de distribuição (por exemplo, imagem de contêiner), **When**
   distribuída, **Then** vem acompanhada da referência ao código correspondente e das
   instruções de construção.

---

### User Story 3 - Avisos, licença e independência preservados (Priority: P2)

Um avaliador (jurídico, cliente corporativo ou comunidade) inspeciona o repositório do fork e
constata: a licença AGPL-3.0 preservada, os avisos de copyright do projeto original mantidos, o
histórico de modificações identificável, e o fork claramente marcado como independente, não
afiliado e não patrocinado pela LearnHouse, Inc. — sem qualquer código do módulo Enterprise.

**Why this priority**: Complementa a oferta de fonte com as demais obrigações de atribuição e a
diretriz central do plano (não usar código Enterprise). É P2 por ser verificação e curadoria
sobre o repositório, com menor risco de regressão contínua que as histórias P1.

**Independent Test**: Testável por inspeção do repositório contra uma lista de verificação:
licença, avisos, declaração de independência e ausência de código Enterprise.

**Acceptance Scenarios**:

1. **Given** o repositório do fork, **When** inspecionado, **Then** a licença AGPL-3.0 e os
   avisos de copyright originais estão preservados.
2. **Given** a documentação do fork (README e área legal), **When** lida, **Then** declara o
   produto como independente, não afiliado e não patrocinado pela LearnHouse, Inc., com
   atribuição ao projeto de origem sem uso promocional da marca.
3. **Given** a base de código do fork, **When** auditada, **Then** não contém código, ativação
   ou reprodução do módulo Enterprise do projeto original.

---

### Edge Cases

- Modelo de implantação ainda não decidido (interno, clientes identificados ou SaaS público): a
  forma de disponibilização varia (repositório interno, portal autenticado ou repositório
  público), mas a obrigação e o processo automatizado são os mesmos — a decisão muda o destino
  da publicação, não o mecanismo.
- Correção urgente (hotfix) implantada fora do ciclo normal: o processo automatizado cobre
  também esse caminho; nenhuma via de implantação pode contornar a geração da fonte.
- Rollback para versão anterior: a fonte da versão anterior já publicada permanece acessível;
  o link da aplicação aponta para a versão em execução.
- Dependências de terceiros com licenças próprias: os avisos exigidos pelas licenças das
  dependências são preservados no pacote.
- Segredo acidentalmente presente no histórico do código: o processo de publicação inclui
  verificação de segredos; em ocorrência, a publicação falha antes da exposição.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A aplicação DEVE exibir um link visível e permanente de "Código-fonte" ou
  "Licença", acessível de qualquer página em no máximo dois cliques, apontando para o código
  correspondente à versão em execução.
- **FR-002**: Cada release implantada DEVE ter seu código-fonte completo correspondente
  disponibilizado gratuitamente aos usuários remotos, na forma adequada ao modelo de
  implantação vigente.
- **FR-003**: O pacote de fonte DEVE incluir os scripts necessários para gerar, instalar e
  executar a versão entregue, e NÃO DEVE conter segredos operacionais.
- **FR-004**: O processo de publicação DEVE gerar e publicar a fonte correspondente
  automaticamente e DEVE falhar quando a fonte não puder ser gerada, publicada ou validada.
- **FR-005**: A identificação da versão em execução DEVE permitir correlacionar,
  inequivocamente, a implantação com o pacote de fonte correspondente.
- **FR-006**: O repositório DEVE preservar a licença AGPL-3.0, os avisos de copyright do
  projeto original e o histórico identificável de modificações.
- **FR-007**: O fork DEVE declarar-se independente, não afiliado e não patrocinado pela
  LearnHouse, Inc., no README e na área legal da aplicação, com atribuição sem uso promocional
  do nome ou logo originais.
- **FR-008**: A base de código do fork NÃO DEVE conter, ativar ou reproduzir código do módulo
  Enterprise do projeto original; distribuições DEVEM ser auditáveis quanto a isso.
- **FR-009**: Imagens de distribuição (contêineres, pacotes) DEVEM ser acompanhadas da
  referência ao código correspondente e das instruções de construção.

### Key Entities

- **Release**: uma versão publicada do produto — identificação de versão, data, artefatos de
  implantação e pacote de fonte correspondente.
- **Pacote de Fonte Correspondente**: o código completo de uma release com scripts de geração,
  instalação e execução — o objeto da obrigação AGPL.
- **Declaração de Atribuição**: o conjunto de textos legais — licença, avisos de copyright,
  atribuição ao projeto de origem e declaração de independência.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das releases implantadas (incluindo hotfixes) têm pacote de fonte
  correspondente publicado e acessível, verificado automaticamente a cada publicação.
- **SC-002**: O link de código-fonte está acessível em no máximo dois cliques a partir de
  qualquer página da aplicação, na versão correta.
- **SC-003**: Zero segredos operacionais nos pacotes de fonte publicados, verificado por
  varredura automatizada em cada publicação.
- **SC-004**: Uma pessoa técnica externa consegue gerar e executar a versão a partir do pacote
  de fonte seguindo apenas as instruções incluídas.
- **SC-005**: Auditoria de repositório confirma licença, avisos e declaração de independência
  presentes, e ausência de código Enterprise, antes de cada release maior.

## Assumptions

- Esta especificação orienta o planejamento técnico e não substitui parecer jurídico; a
  operação comercial validará o modelo final com profissional especializado em software livre e
  marcas, conforme a nota da seção 11 do plano.
- O modelo de implantação (interno, clientes identificados ou SaaS público) é decisão pendente
  de Negócio/Arquitetura; o processo automatizado é o mesmo para os três, mudando apenas o
  destino de publicação (repositório interno, portal autenticado ou repositório público).
- A escolha entre repositório público e portal autenticado para a fonte é decisão pendente de
  Jurídico/DevOps; assume-se repositório acessível a todos os usuários do serviço como padrão
  seguro para conformidade.
- A atribuição visível na interface é implementada pela feature `005-rebranding-visual` (área
  legal); esta feature define o conteúdo obrigatório e verifica a conformidade.
- O fork mantém o vínculo com o repositório original (upstream) para incorporar correções, e o
  processo de atualização preserva as obrigações desta feature a cada nova versão.
