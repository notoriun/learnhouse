# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

**Idioma**: o conteúdo preenchido DEVE ser escrito em português (pt-BR), conforme a
seção "Idioma Oficial" da constituição. Nomes de arquivos, identificadores de código e
termos técnicos consagrados permanecem em inglês.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*PORTÃO: DEVE passar antes da pesquisa da Fase 0. Reverificar após o design da Fase 1.*

Marque cada portão como PASSA / N/A / VIOLAÇÃO (violações vão para Complexity Tracking):

- [ ] **I. Fronteiras entre Apps São Contratos** — se a feature atravessa
  `apps/web`, `apps/api`, `apps/collab` ou `apps/cli`, o contrato (endpoint, payload,
  evento) está definido antes da implementação. Nenhum app além da API acessa
  PostgreSQL ou Redis diretamente.
- [ ] **II. Backend API-First** — a lógica de negócio fica em endpoints FastAPI em
  `apps/api` com persistência em SQLModel; Web e CLI não duplicam regras do servidor.
- [ ] **III. Mudanças de Schema Exigem Migrações e Testes** — toda alteração de modelo
  tem migração Alembic planejada e toda mudança de comportamento da API tem teste
  planejado no mesmo PR.
- [ ] **IV. Segurança Multi-Tenant É Inegociável** — todo endpoint novo ou alterado
  aplica RBAC com escopo de organização; consultas são limitadas à organização do
  requisitante; validação nas fronteiras de confiança preservada.
- [ ] **V. Simplicidade e Reúso Primeiro** — dependências novas, abstrações com uma
  única implementação e configuração especulativa estão justificadas; separação
  open-source (AGPL-3.0) / Enterprise mantida.
- [ ] **Stack Tecnológica** — não introduz nova linguagem, framework, banco ou serviço
  externo fora da stack estabelecida (caso contrário, é decisão constitucional).

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 0: LearnHouse monorepo (DEFAULT for this repository)
apps/
├── web/       # Next.js + React + TypeScript
├── api/       # FastAPI + SQLModel + migrações Alembic
├── collab/    # Hocuspocus / Yjs sobre WebSocket
└── cli/       # Node.js + Commander

# [REMOVE IF UNUSED] Option 1: Single project
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
