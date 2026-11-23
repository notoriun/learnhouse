<!--
Relatório de Impacto de Sincronização
=====================================
Mudança de versão: 1.0.0 → 1.1.0
Justificativa: MINOR — nova diretriz material adicionada (Idioma Oficial: português)
e tradução integral do documento para o português (pt-BR), que passa a ser o idioma
oficial de todos os artefatos do projeto.

Princípios modificados: nenhum redefinido ou removido (apenas traduzidos)
  - I. App Boundaries Are Contracts → I. Fronteiras entre Apps São Contratos
  - II. API-First Backend → II. Backend API-First
  - III. Schema Changes Ship With Migrations and Tests →
    III. Mudanças de Schema Exigem Migrações e Testes
  - IV. Multi-Tenant Security Is Non-Negotiable →
    IV. Segurança Multi-Tenant É Inegociável
  - V. Simplicity and Reuse First → V. Simplicidade e Reúso Primeiro
Seções adicionadas:
  - Idioma Oficial (nova subseção em Restrições e Padrões)
Seções removidas: nenhuma

Templates dependentes (propagação verificada em 2026-08-06):
  - ✅ .specify/templates/plan-template.md — "Constitution Check" agora lista os
    portões concretos dos Princípios I–V e da Stack Tecnológica; nota de idioma
    (pt-BR); layout do monorepo `apps/*` como estrutura padrão.
  - ✅ .specify/templates/tasks-template.md — nota de idioma (pt-BR); exceções
    obrigatórias do Princípio III (migração Alembic e teste de API mesmo quando
    testes não são pedidos) e do Princípio IV (RBAC por organização); convenção
    de caminhos do monorepo.
  - ✅ .specify/templates/spec-template.md — nota de idioma (pt-BR).
  - ✅ .specify/templates/checklist-template.md — nota de idioma (pt-BR).
  - ✅ .specify/templates/constitution-template.md — template genérico do Spec Kit,
    intencionalmente mantido com placeholders em inglês.
  - ⚠ .claude/skills/speckit-*/ — definições de comando fornecidas pelo Spec Kit,
    em inglês; não editadas para evitar conflito em atualizações da ferramenta. A
    regra de idioma é aplicada pelos templates acima.

Nota de versão: esta atualização apenas propaga a v1.1.0 para os templates e
registra o resultado; nenhum texto normativo da constituição mudou, portanto a
versão permanece 1.1.0 e a data da última emenda permanece 2026-08-03.

Itens adiados / TODOs: nenhum
-->

# Constituição do LearnHouse

## Princípios Fundamentais

### I. Fronteiras entre Apps São Contratos

O LearnHouse é um monorepo com quatro apps: Web (`apps/web`), API (`apps/api`),
Collab (`apps/collab`) e CLI (`apps/cli`). Cada app DEVE se comunicar com os
demais somente através de suas interfaces publicadas: os endpoints REST da API
e o protocolo WebSocket do servidor Collab. Nenhum app além da API pode
acessar o banco PostgreSQL ou o Redis diretamente. Uma funcionalidade que
atravesse apps DEVE ter seu contrato entre apps (endpoint, payload, evento)
definido antes do início da implementação.

Justificativa: a API atende Web, CLI e Collab simultaneamente; canais
paralelos não documentados quebram um consumidor sempre que outro evolui.

### II. Backend API-First

Toda funcionalidade de backend DEVE ser exposta como endpoints REST FastAPI
em `apps/api`, com persistência modelada em SQLModel. A lógica de negócio
vive na camada da API, não em componentes Web nem em comandos da CLI. O
código do frontend e da CLI DEVE tratar a API como fonte única da verdade e
NÃO DEVE duplicar regras do servidor (preços, controle de acesso, correção
automática) no cliente, exceto como dicas de UX sem autoridade.

Justificativa: lógica duplicada em quatro consumidores diverge; um backend
único e autoritativo mantém o comportamento consistente para self-hosters e
para o produto hospedado.

### III. Mudanças de Schema Exigem Migrações e Testes

Toda mudança de schema do banco DEVE vir acompanhada de uma migração Alembic
no mesmo pull request. Mudanças de comportamento da API DEVEM incluir ou
atualizar testes cobertos pela suíte de testes da API (acompanhada pela flag
de cobertura `api`). Um PR que altera modelos sem migração, ou altera o
comportamento de endpoints sem teste, está incompleto e NÃO DEVE ser mesclado.

Justificativa: instâncias self-hosted atualizam via `npx learnhouse update`;
uma migração esquecida ou uma regressão sem teste quebra instalações que o
time não controla e não consegue corrigir a quente.

### IV. Segurança Multi-Tenant É Inegociável

Todo endpoint da API DEVE aplicar autorização com escopo de organização
(RBAC). As consultas DEVEM ser limitadas à organização do usuário
requisitante; acesso a dados entre organizações é um defeito de segurança,
não um bug comum. Validação de entrada nas fronteiras de confiança,
verificações de autenticação e integridade do fluxo de pagamentos (Stripe)
NÃO DEVEM ser simplificadas, adiadas ou contornadas por conveniência —
inclusive em testes e atalhos de desenvolvimento. Vulnerabilidades suspeitas
são reportadas em privado para security@learnhouse.app, nunca em issues
públicas.

Justificativa: o LearnHouse roda instâncias multi-organização; uma única
consulta sem escopo vaza dados de um cliente para outro.

### V. Simplicidade e Reúso Primeiro

Prefira, nesta ordem: não construir (YAGNI), reusar um helper ou padrão já
existente no código, a biblioteca padrão, uma dependência já instalada e, só
então, código novo. Dependências novas, abstrações com uma única
implementação e configurações especulativas DEVEM ser justificadas na
descrição do PR. As funcionalidades open-source (AGPL-3.0) e Enterprise
DEVEM permanecer claramente separadas, de modo que o núcleo open-source
continue plenamente funcional por si só.

Justificativa: uma plataforma mantida por um time pequeno e por
contribuidores da comunidade sobrevive com código simples, mínimo e bem
separado.

## Restrições e Padrões

### Idioma Oficial

O português (pt-BR) é o idioma oficial do projeto. Todos os artefatos do
Spec Kit (constituição, especificações, planos, tarefas, checklists e
análises), a documentação interna e a comunicação com o usuário DEVEM ser
escritos em português. Identificadores de código, mensagens de commit e
termos técnicos consagrados (ex.: endpoint, pull request) PODEM permanecer
em inglês quando a tradução prejudicar a clareza.

### Stack Tecnológica

A stack estabelecida é o padrão; desvios exigem justificativa explícita e
aprovação de um mantenedor antes da implementação:

- **Web**: Next.js, React, TypeScript, TailwindCSS, Radix UI, Tiptap
- **API**: Python, FastAPI, SQLModel, Alembic
- **Dados**: PostgreSQL (armazenamento primário), Redis (cache/filas),
  object storage compatível com S3
- **Collab**: Hocuspocus, Yjs sobre WebSocket
- **CLI**: Node.js, Commander
- **Pagamentos**: Stripe (Enterprise) — nenhum manuseio direto de cartões
  neste código
- **Deploy**: Docker; instâncias gerenciadas pela CLI `learnhouse`

Introduzir uma nova linguagem, framework, banco de dados ou serviço externo
é uma decisão de nível constitucional, não de nível de feature.

## Fluxo de Desenvolvimento e Portões de Qualidade

- Funcionalidades começam como uma Discussion no GitHub (ideias) ou uma
  Issue (bugs) e recebem um aval antes de trabalho significativo de
  implementação.
- Contribuições seguem o modelo fork → branch → pull request; todas as
  mudanças chegam à `dev` (branch padrão) por PRs revisados — sem push
  direto.
- Um PR DEVE passar no CI (build, lint, testes) e na revisão de código antes
  do merge.
- Revisores DEVEM verificar a conformidade com os Princípios I–V; violações
  do Princípio IV (segurança multi-tenant) bloqueiam o merge sem exceção.
- O desenvolvimento local usa `npx learnhouse dev`; mudanças DEVERIAM ser
  verificadas nesse ambiente antes da abertura do PR.

## Governança

Esta constituição prevalece sobre práticas ad-hoc em todo o trabalho neste
repositório. Quando outros documentos (README, CONTRIBUTING, templates)
conflitarem com ela, a constituição vence até que seja emendada.

- **Emendas**: propostas via PR que modifica este arquivo, incluindo um
  Relatório de Impacto de Sincronização em comentário e um incremento de
  versão. É exigida aprovação de um mantenedor; emendas mescladas entram em
  vigor imediatamente.
- **Versionamento**: versionamento semântico. MAJOR para princípios
  removidos ou redefinidos, MINOR para novos princípios ou orientações
  materialmente ampliadas, PATCH para esclarecimentos e ajustes de redação.
- **Revisão de conformidade**: a revisão de PR é o ponto de aplicação.
  Qualquer desvio deliberado e temporário DEVE ser marcado no código e
  acompanhado até a resolução; desvios permanentes exigem uma emenda, não
  uma exceção.

**Versão**: 1.1.0 | **Ratificada**: 2026-08-03 | **Última Emenda**: 2026-08-03
