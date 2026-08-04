# Tasks: Conformidade AGPL e Oferta de Código-Fonte

**Input**: Documentos de design em `/specs/006-conformidade-agpl/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/release-source.md, quickstart.md

**Tests**: incluídos apenas onde a constituição exige (Princípio III: mudança de comportamento de endpoint exige teste — `test_instance_router.py`). Sem schema, sem migração Alembic. A validação do pipeline é feita por release de ensaio (quickstart.md), não por suíte de testes.

**Organization**: tarefas agrupadas por user story para permitir implementação e teste independentes. Nota do plan.md: esta feature orienta o trabalho técnico e **não substitui parecer jurídico**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependências)
- **[Story]**: user story da tarefa (US1, US2, US3) — apenas nas fases de story
- Caminho exato de arquivo em toda descrição

## Path Conventions

Monorepo existente (plan.md): `apps/api/` (FastAPI), `apps/web/` (Next.js), `.github/workflows/` (CI/CD), `scripts/` (único diretório novo). Nenhuma entidade de banco.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: pré-condições compartilhadas por todas as stories — identidade única de versão e destino canônico da fonte

- [X] T001 Verificar e sincronizar a string de versão única nos três pontos existentes: `apps/api/pyproject.toml` (`version = "1.3.4"`), `apps/api/app.py` (linha 74, `FastAPI(version=...)`) e `apps/web/package.json` — a tag git numérica é a identidade canônica da release (research.md §1, FR-005)
- [X] T002 [P] Definir a URL canônica do repositório do fork (`https://github.com/<org-fork>/<repo>`) e registrá-la nos pontos de consumo: constante do link em `apps/web/components/Footers/LegalFooters.tsx` e valor das labels OCI em `.github/workflows/release.yaml` e `.github/workflows/build-community.yaml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: expor a versão em execução pela API — fonte única da verdade (Princípio II) da qual dependem o link do rodapé (US1) e a correlação release ↔ instância (US2)

**⚠️ CRITICAL**: nenhuma user story pode começar antes desta fase

- [X] T003 Estender o teste existente `apps/api/src/tests/routers/test_instance_router.py` exigindo o campo `version` na resposta de `GET /api/v1/instance/info`, idêntico à versão de `apps/api/pyproject.toml` e sem alterar os campos existentes (escrever primeiro; deve FALHAR antes da implementação — Princípio III)
- [X] T004 Adicionar o campo `version` à resposta de `GET /api/v1/instance/info` em `apps/api/src/routers/instance.py`, lido dos metadados do pacote da API (mesma string de `apps/api/pyproject.toml` / `apps/api/app.py`), preservando campos existentes, ausência de autenticação e cache (contracts/release-source.md, Contrato 2)

**Checkpoint**: a instância declara sua versão — `curl /api/v1/instance/info | jq .version` retorna a tag implantada

---

## Phase 3: User Story 1 - Usuário remoto acessa o código-fonte correspondente (Priority: P1) 🎯 MVP

**Goal**: link visível e permanente "Código-fonte (AGPL-3.0)" em ≤ 2 cliques de qualquer página, apontando para a fonte da exata versão em execução (FR-001, FR-005, SC-002)

**Independent Test**: acessar a aplicação como usuário final, seguir o link do rodapé e conferir que a release aberta tem a mesma versão reportada por `GET /api/v1/instance/info` (quickstart.md, passo 3)

### Implementation for User Story 1

- [X] T005 [P] [US1] Adicionar chave de tradução do link "Código-fonte (AGPL-3.0)" em `apps/web/locales/en.json`, `apps/web/locales/pt.json` e demais arquivos de `apps/web/locales/*.json` (react-i18next)
- [X] T006 [US1] Estender `apps/web/components/Footers/LegalFooters.tsx` com o link "Código-fonte (AGPL-3.0)" no `CopyrightFooter`, ao lado de Terms/Privacy: href montado com `version` vinda de `GET /api/v1/instance/info` → `https://github.com/<org-fork>/<repo>/releases/tag/<version>`; fallback para `https://github.com/<org-fork>/<repo>/releases` quando `version` indisponível (o link nunca desaparece — FR-001)
- [X] T007 (link no CopyrightFooter, 2 cliques; validação visual runtime pendente de stack) [US1] Validar a regra dos 2 cliques nas superfícies principais (home, página de curso, login) e o cenário de rollback (instância revertida → link aponta para a versão antiga), conforme quickstart.md passo 3 (SC-002)

**Checkpoint**: US1 funcional e testável de forma independente — qualquer usuário alcança a fonte da versão em execução

---

## Phase 4: User Story 2 - Release sempre acompanhada da fonte correspondente (Priority: P1)

**Goal**: toda release (incluindo hotfix, sempre via tag `[0-9]*`) gera, valida e publica automaticamente o pacote de fonte; publicação falha sem fonte; imagens carregam referência à fonte (FR-002, FR-003, FR-004, FR-009, SC-001, SC-003)

**Independent Test**: publicar uma tag de ensaio e verificar que a GitHub Release contém `source-<tag>.tar.gz` + `SHA256SUMS` antes de qualquer imagem; teste negativo com segredo fake aborta tudo (quickstart.md, passos 1–2)

### Implementation for User Story 2

- [X] T008 [P] [US2] Criar `scripts/package-source.sh`: `git archive --format=tar.gz -o source-<tag>.tar.gz <tag>`, geração de `SHA256SUMS`, validações de conteúdo que falham o processo — `LICENSE` na raiz do tarball, `Dockerfile`, `apps/api/pyproject.toml`, `apps/web/package.json` presentes; versão em `apps/api/pyproject.toml` idêntica à tag (FR-004, FR-005); o script DEVE embutir a varredura de segredos: executar gitleaks (mesma config `.gitleaks.toml` de T009) sobre o conteúdo extraído do tarball, encerrando com código ≠ 0 em qualquer finding não suprimido — assim a via local de emergência (hotfix com CI indisponível) roda a mesma varredura por construção; pré-requisito da execução local: binário gitleaks instalado (SC-003)
- [X] T009 [P] [US2] Criar config versionada `.gitleaks.toml` na raiz do repositório para supressão auditável de falsos positivos da varredura de segredos (research.md §3)
- [X] T010 [US2] Adicionar o job `source-package` em `.github/workflows/release.yaml` (gatilho existente: push de tag `[0-9]*`): checkout da tag com `fetch-depth: 0`, instalação do binário gitleaks e invocação de `scripts/package-source.sh` — a varredura de segredos roda **dentro do script** (T008); o job NÃO duplica a lógica de varredura, apenas falha se o script falhar (qualquer finding não suprimido = falha antes de qualquer publicação — SC-003); anexo de `source-<tag>.tar.gz` + `SHA256SUMS` à GitHub Release da tag (criando-a se não existir)
- [X] T011 [US2] Condicionar os jobs de imagem/manifesto existentes de `.github/workflows/release.yaml` ao sucesso do job `source-package` (`needs:`) — nenhuma imagem é publicada sem a fonte anexada (FR-004; contracts/release-source.md, Contrato 1)
- [X] T012 [US2] Adicionar labels OCI no build-push de `.github/workflows/release.yaml`: `org.opencontainers.image.source=<URL do fork>`, `.version=<tag>`, `.revision=<sha>`, `.licenses=AGPL-3.0-or-later` (FR-009)
- [X] T013 [P] [US2] Adicionar as mesmas labels OCI no build de `.github/workflows/build-community.yaml` (builds por branch)
- [X] T014 [US2] Executar o teste negativo do pipeline em tag de ensaio: injetar um padrão de segredo fake (ex.: `AKIA...`) e confirmar que nenhum artefato é publicado e o erro do log é claro (quickstart.md passo 1, edge case de segredo no histórico)

**Checkpoint**: US1 e US2 independentes — release sem fonte é impossível; imagens referenciam a fonte

---

## Phase 5: User Story 3 - Avisos, licença e independência preservados (Priority: P2)

**Goal**: LICENSE e avisos preservados, declaração de independência no README e na área legal, ausência de código Enterprise provada mecanicamente a cada release (FR-006, FR-007, FR-008, SC-005)

**Independent Test**: inspeção do repositório contra a checklist (licença, avisos, declaração, ausência de `ee/`) e execução das auditorias automatizadas em tag de ensaio (quickstart.md, passo 5)

### Implementation for User Story 3

- [X] T015 [P] [US3] Estender `README.md` com a seção de licença: atribuição ao projeto de origem ("baseado no LearnHouse (AGPL-3.0)", link ao upstream, sem uso promocional de nome/logo) e declaração de independência ("produto independente, não afiliado e não patrocinado pela LearnHouse, Inc.") — FR-007
- [X] T016 [P] [US3] Adicionar a declaração de independência e a atribuição na área legal da aplicação em `apps/web/components/Footers/LegalFooters.tsx`, com chaves de tradução em `apps/web/locales/*.json` (conteúdo obrigatório definido aqui; superfície visual integrada com a feature 005-rebranding-visual)
- [X] T017 [P] [US3] Verificar `LICENSE` íntegra na raiz (diff contra o texto oficial da AGPL-3.0) e avisos de copyright do upstream preservados nos arquivos alterados pelo fork (FR-006; contracts/release-source.md, Contrato 3, itens 1–2)
- [X] T018 [US3] Adicionar auditoria Enterprise em `scripts/package-source.sh`: falha se o diretório `ee/` existir na working tree da tag ou no conteúdo do tarball (FR-008; os hooks AGPL `apps/api/src/core/ee_hooks.py` e `apps/api/src/core/deployment_mode.py` permanecem intactos — research.md §4)
- [X] T019 [US3] Adicionar passo pós-build de auditoria da imagem em `.github/workflows/release.yaml`: falha se `/app/api/ee` existir na imagem publicada (`docker run ... test -d /app/api/ee`), confirmando `LEARNHOUSE_PUBLIC=true` nos builds (remove `/app/api/ee` — `Dockerfile:99`)

**Checkpoint**: todas as stories independentes — auditoria de atribuição e Enterprise verde em tag de ensaio

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: checklist operacional, nota jurídica e validação ponta a ponta

- [X] T020 [P] Operacionalizar a checklist de auditoria pré-release do Contrato 3 em `specs/006-conformidade-agpl/contracts/release-source.md`: confirmar que os itens automatizados (1, 3, 5, 6, 8) rodam no pipeline e registrar responsáveis/momento dos itens manuais (2, 4, 7, 9, 10) antes de cada release maior (SC-005)
- [X] T021 [P] Incluir na seção de licença de `README.md` a nota de que a conformidade técnica desta feature **não substitui parecer jurídico** (nota do plan.md e seção 11 do documento-base)
- [ ] T022 (PENDENTE — release de ensaio no CI; script validado localmente: caminho feliz + negativos de segredo e versão) Executar a validação ponta a ponta de `specs/006-conformidade-agpl/quickstart.md` (passos 1–5): release de ensaio, verificação do pacote, link até a fonte, reconstrução apenas com as instruções incluídas (SC-004) e auditoria final — todos verdes, incluindo o teste negativo

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — início imediato
- **Foundational (Phase 2)**: depende de T001 (versão sincronizada) — BLOQUEIA todas as stories
- **US1 (Phase 3)**: depende da Phase 2 (campo `version` na API) e de T002 (URL canônica)
- **US2 (Phase 4)**: depende da Phase 2 (correlação versão ↔ tag) e de T002; independente de US1
- **US3 (Phase 5)**: T015–T017 dependem só da Phase 1; T018 depende de T008 (script existe); T019 depende de T010–T012 (job e build em `release.yaml` existem)
- **Polish (Phase 6)**: T020–T021 após US2/US3; T022 (quickstart completo) por último, com tudo integrado

### Task Dependencies (dentro das fases)

- T003 (teste, falhando) antes de T004 (implementação)
- T005 (chave de tradução) antes de T006 (componente que a usa); T007 valida T006
- T008 e T009 antes de T010; T010 → T011 → T012 (mesmo arquivo `release.yaml`, sequencial); T014 após T010–T013
- T018 após T008; T019 após T012 (mesmo arquivo `release.yaml`)

### Parallel Opportunities

- T002 em paralelo com T001
- T005 em paralelo com o fim da Phase 2
- T008, T009 e T013 em paralelo entre si (arquivos diferentes)
- T015, T016 e T017 em paralelo entre si
- US1 (Phase 3) e US2 (Phase 4) em paralelo por pessoas diferentes após a Phase 2 — não compartilham arquivos

---

## Parallel Example: User Story 2

```bash
# Após a Phase 2, lançar em paralelo (arquivos diferentes, sem dependências):
Task: "T008 Criar scripts/package-source.sh (git archive + SHA256SUMS + validações)"
Task: "T009 Criar .gitleaks.toml na raiz (config versionada de supressões)"
Task: "T013 Adicionar labels OCI em .github/workflows/build-community.yaml"

# Em paralelo com US2, outra pessoa executa US1:
Task: "T005 Chave de tradução do link em apps/web/locales/*.json"
Task: "T006 Link Código-fonte em apps/web/components/Footers/LegalFooters.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup (T001–T002)
2. Phase 2: Foundational (T003–T004) — campo `version` na API, com teste
3. Phase 3: US1 (T005–T007) — link do rodapé para a fonte da versão em execução
4. **PARAR e VALIDAR**: quickstart.md passo 3 (link em ≤ 2 cliques, versão correta)
5. MVP entregue: a obrigação central da AGPL (oferta visível de fonte) está atendida com o repositório público e as tags existentes, antes mesmo da automação de release

### Incremental Delivery

1. Setup + Foundational → instância declara a versão
2. US1 → link visível validado → **MVP**
3. US2 → release de ensaio com pacote de fonte, gitleaks e labels OCI → nenhuma release futura sem fonte (SC-001)
4. US3 → atribuição, independência e auditoria de `ee/` → checklist SC-005 verde
5. Polish → checklist operacional + quickstart completo → pronto para a primeira release real do fork

### Parallel Team Strategy

1. Time completa Setup + Foundational juntos
2. Depois da Phase 2:
   - Dev A: US1 (Web — rodapé e traduções)
   - Dev B: US2 (CI — script, workflow, gitleaks, labels)
   - Dev C: US3 (README, área legal, auditorias — T018/T019 sincronizados com Dev B por tocarem os mesmos arquivos)
3. Polish fecha com a validação ponta a ponta (T022)

---

## Notes

- [P] = arquivos diferentes, sem dependências entre si
- Sem banco, sem migração Alembic (Princípio III) — o único teste de código exigido é o do endpoint (T003)
- Única dependência nova: gitleaks — usada pelo CI via `scripts/package-source.sh` e pré-requisito da via local de emergência (Princípio V, justificada por SC-003)
- Os hooks EE sob AGPL (`ee_hooks.py`, `deployment_mode.py`, `FeatureGate.tsx`) NÃO são removidos — a garantia FR-008 é a ausência da pasta `ee/`, provada mecanicamente a cada release
- Commits após cada tarefa ou grupo lógico; parar em qualquer checkpoint para validar a story de forma independente
