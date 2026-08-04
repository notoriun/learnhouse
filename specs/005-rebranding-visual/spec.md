# Especificação de Feature: Identidade Visual do Fork (Rebranding)

**Feature Branch**: `005-rebranding-visual`

**Created**: 2026-08-03

**Status**: Draft

**Input**: Descrição do usuário: "Crie especificações para implementar cada feature do documento
Plano_Implementacao_Fork_Keycloak_Identidade_Visual.docx" — Fase 4 do roteiro: Rebranding
(nome, logo, tokens visuais, assets, textos, e-mails e páginas legais).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Experiência sem a marca original (Priority: P1)

Um usuário final (aluno, instrutor ou administrador) percorre toda a plataforma — login,
cadastro, recuperação de senha, painel, cursos, e-mails recebidos, páginas de erro, favicon e
pré-visualizações em redes sociais — e encontra exclusivamente a nova marca: nome, logo, cores,
tipografia e tom de voz próprios, sem nenhum vestígio visível da marca LearnHouse.

**Why this priority**: É o objetivo central da feature e um critério de aceite do primeiro
release ("identidade visual original não aparece na experiência do usuário"). Reduz o risco de
confusão com a marca original apontado no plano.

**Independent Test**: Testável percorrendo o inventário de superfícies (telas, e-mails, erros,
metadados, assets) e verificando ausência da marca original e presença consistente da nova.

**Acceptance Scenarios**:

1. **Given** qualquer tela da experiência autenticada ou pública, **When** um usuário a
   visualiza, **Then** apenas a nova marca aparece (nome, logo, cores e textos).
2. **Given** um e-mail transacional (boas-vindas, recuperação de senha, notificação), **When**
   o usuário o recebe, **Then** remetente, assunto, corpo e rodapé usam somente a nova marca.
3. **Given** um link da plataforma compartilhado em rede social ou mensageiro, **When** a
   pré-visualização é gerada, **Then** título, descrição e imagem mostram a nova marca.
4. **Given** uma página de erro (não encontrada, erro interno, manutenção), **When** exibida,
   **Then** usa a nova marca e o novo tom de voz em português.

---

### User Story 2 - Atribuição legal e declaração de independência (Priority: P2)

Um visitante interessado na origem do produto encontra, em uma área legal discreta, a
atribuição ao projeto de origem, a licença aplicável e a declaração de que o produto é
independente, não afiliado e não patrocinado pela LearnHouse, Inc. — sem uso promocional do
nome ou logo originais em qualquer superfície comercial.

**Why this priority**: Obrigação de atribuição e mitigação do risco jurídico de confusão de
marca. É P2 porque depende do rebranding P1 estar aplicado, mas é indispensável antes do
release.

**Independent Test**: Testável verificando a existência e o conteúdo da área legal e a ausência
do nome/logo originais fora dela.

**Acceptance Scenarios**:

1. **Given** a área legal da aplicação, **When** um visitante a acessa, **Then** encontra a
   atribuição ao projeto de origem, a licença e a declaração de independência.
2. **Given** qualquer superfície promocional ou comercial (páginas públicas, materiais, loja de
   apps, metadados), **When** inspecionada, **Then** o nome e o logo originais não aparecem.

---

### User Story 3 - Continuidade técnica para usuários e operadores (Priority: P2)

Usuários com sessões ativas e operadores com implantações configuradas não percebem quebra
alguma com a chegada da nova marca: sessões continuam válidas, variáveis de configuração
existentes seguem funcionando e nenhuma migração manual é exigida — a mudança é visual, não
estrutural (ADR-07).

**Why this priority**: O plano determina desacoplar o rebranding visível dos identificadores
legados para preservar atualizações do upstream e evitar quebra de sessões. Um rebranding que
derruba sessões ou implantações geraria suporte e desconfiança.

**Independent Test**: Testável iniciando uma sessão antes da atualização de marca e
verificando-a depois; e subindo uma implantação com a configuração antiga inalterada.

**Acceptance Scenarios**:

1. **Given** uma sessão ativa iniciada antes da atualização, **When** a nova marca entra no ar,
   **Then** a sessão permanece válida sem novo login.
2. **Given** uma implantação com variáveis de configuração legadas, **When** atualizada para a
   versão com nova marca, **Then** sobe normalmente sem alteração de configuração.
3. **Given** a auditoria automatizada de marca, **When** executada sobre uma release, **Then**
   nomes internos técnicos (variáveis, cookies, tabelas, diretórios) não são sinalizados como
   pendência — somente superfícies visíveis ao usuário contam.

---

### Edge Cases

- Conteúdo criado por usuários citando o nome original (fóruns, cursos): não é alterado — a
  auditoria de marca cobre apenas superfícies do produto, não conteúdo de usuários.
- Telas raras e estados vazios (listas sem itens, primeiro acesso, modo manutenção): incluídos
  no inventário; são os lugares onde marca residual costuma escapar.
- Modo escuro e telas de alta densidade: logo e cores devem ter versões legíveis (reduzida,
  monocromática) mantendo contraste adequado.
- E-mails já enfileirados com template antigo no momento da virada: aceitáveis por um curto
  período de transição; novos envios usam o novo template.
- Nome definitivo ainda não decidido no início da implementação: o trabalho estrutural (sistema
  de temas, tokens visuais, pontos de substituição) avança com marca provisória, e a troca
  final do nome é uma substituição de configuração, não um retrabalho.
- Capturas de tela na documentação: atualizadas para a nova marca; capturas antigas não podem
  permanecer em documentação visível ao usuário.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Todas as superfícies visíveis ao usuário DEVEM exibir exclusivamente a nova
  marca: cabeçalhos, menus, tela inicial, login, cadastro, recuperação de senha, MFA, painel
  administrativo, mensagens de erro, páginas 404/500 e modo manutenção.
- **FR-002**: Todos os assets DEVEM ser substituídos: favicon, ícones de aplicativo, manifest,
  metadados, imagens Open Graph e sociais, splash e imagens de e-mail — nenhum asset original
  permanece visível.
- **FR-003**: E-mails transacionais DEVEM usar a nova marca em remetente, assunto, corpo,
  rodapé e links de suporte.
- **FR-004**: A nova identidade DEVE incluir versões de logo horizontal, símbolo, monocromática
  e reduzida, legíveis em 16 px e em fundos claro e escuro.
- **FR-005**: A paleta de cores DEVE atender contraste WCAG AA em todos os pares texto/fundo
  usados na interface.
- **FR-006**: A tipografia DEVE ter licença adequada para uso web e boa renderização nos
  navegadores suportados.
- **FR-007**: Textos de produto, erros e onboarding DEVEM seguir o novo tom de voz, em
  português claro e com terminologia consistente.
- **FR-008**: A aplicação DEVE manter uma área legal discreta com atribuição ao projeto de
  origem, licença e declaração de independência — único local onde o nome original aparece, sem
  uso promocional.
- **FR-009**: Identificadores técnicos legados (cookies, variáveis de configuração, tabelas,
  colunas e diretórios) NÃO DEVEM ser renomeados nesta feature; sessões ativas e implantações
  existentes DEVEM continuar funcionando sem intervenção.
- **FR-010**: Uma auditoria automatizada DEVE varrer cada release em busca de marca original
  visível (textos, assets, metadados, e-mails, documentos) e falhar quando encontrar
  ocorrências em superfícies de usuário.
- **FR-011**: Textos próprios de privacidade, termos, suporte e política de segurança DEVEM
  substituir os originais.
- **FR-012**: Nomes apresentados ao usuário em integrações externas (telemetria, monitoramento
  de erros, analytics) DEVEM refletir a nova marca.

### Key Entities

- **Kit de Marca**: o conjunto aprovado de nome, logos, paleta, tipografia, iconografia e tom
  de voz — fonte única para todas as superfícies.
- **Inventário de Rebranding**: a lista verificável de superfícies (telas, e-mails, assets,
  metadados, documentos, integrações) com situação de substituição — insumo da auditoria
  automatizada.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A auditoria automatizada de marca encontra zero ocorrências visíveis da marca
  original em superfícies de usuário na release candidata.
- **SC-002**: 100% das superfícies do inventário de rebranding estão marcadas como substituídas
  e verificadas antes do release.
- **SC-003**: 100% dos pares de cor texto/fundo da interface atendem contraste WCAG AA em
  verificação automatizada.
- **SC-004**: Zero sessões invalidadas e zero implantações quebradas atribuíveis à virada de
  marca (medido por reclamações de suporte e monitoramento na semana da virada).
- **SC-005**: A área legal com atribuição e declaração de independência está acessível em no
  máximo dois cliques a partir de qualquer página.

## Assumptions

- O nome definitivo, o kit visual aprovado e a pesquisa de domínio/marca são entregas da Fase 0
  do plano (Produto/Jurídico) e são pré-requisitos para a conclusão — não para o início — desta
  feature; até lá, usa-se marca provisória.
- A renomeação gradual de cookies e variáveis de configuração para a nova marca (com leitura
  dupla e depreciação) é o item P2 do backlog e fica fora desta feature.
- A tela de login do provedor de identidade corporativo (Keycloak) pode receber tema próprio;
  personalizá-la é desejável, mas o mínimo exigido é que a plataforma em si não exiba a marca
  original.
- A verificação de conformidade de licença e oferta de código-fonte é a feature
  `006-conformidade-agpl`; esta feature cuida apenas da atribuição visível e da identidade.
- Esta especificação não define o conteúdo criativo da marca (nome, desenho de logo, cores
  específicas) — define as superfícies, os critérios de qualidade e a verificação.
