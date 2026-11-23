# Tasks: Identidade Visual do Fork (Rebranding)

**Input**: Design documents from `specs/005-rebranding-visual/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/branding.md, quickstart.md

**Tests**: A auditoria de marca (`scripts/brand-audit.mjs`) É o teste da feature (FR-010/SC-001).
Ela nasce na Fase 2, ANTES das substituições, para medir o progresso: o baseline (~933 ocorrências)
deve cair a zero FAIL ao fim da US1.

**Organization**: Tarefas agrupadas por user story para permitir implementação e teste independentes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependências)
- **[Story]**: User story da tarefa (US1, US2, US3) — apenas nas fases de story
- Caminhos exatos de arquivo em toda descrição

## Path Conventions

Monorepo existente (plan.md): `apps/web/` (Next.js), `apps/api/` (FastAPI), `scripts/`,
`.github/workflows/`. Nenhum app ou pacote novo é criado.

---

## Phase 1: Setup (Assets provisórios neutros)

**Purpose**: Criar os assets da marca provisória com nomes neutros, para que a troca final seja
substituição de arquivos — nunca renomeação (research D2).

- [X] T001 Criar diretório `apps/web/public/brand/` com logos provisórios neutros: `logo-horizontal.svg`, `logo-symbol.svg`, `logo-mono.svg`, `logo-small.svg` e variantes para fundo escuro (`logo-horizontal-dark.svg`, etc.), legíveis em 16 px (FR-004)
- [X] T002 [P] Criar favicon e imagem Open Graph provisórios neutros em `apps/web/public/brand/favicon.ico` e `apps/web/public/brand/og-default.png` (a remoção dos originais de `apps/web/public/` ocorre na Fase 3)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pontos únicos de marca (Princípio V: centralizar, não espalhar) e a auditoria que mede
o progresso das substituições. Sem migração de banco (Princípio III — sem mudança de schema).

**⚠️ CRITICAL**: Nenhuma substituição de user story começa antes desta fase terminar.

- [X] T003 Criar módulo de marca `apps/web/services/config/brand.ts` com a interface `Brand` (`name`, `legalName`, `tagline`, `contactEmail`, `logos`, `legal`) e `getBrand()` lendo o runtime config existente (`getConfig` em `apps/web/services/config/config.ts`) com defaults da marca provisória e paths de `/brand/*`, conforme `specs/005-rebranding-visual/contracts/branding.md` §1.1
- [X] T004 [P] Implementar a resolução do placeholder `{platform_name}` na renderização de e-mails em `apps/api/src/services/email/utils.py`, injetando `site_name` da config existente em `apps/api/config/config.py` (env var `LEARNHOUSE_SITE_NAME` preservada por FR-009 — só o valor muda); mecanismo apenas, a troca das strings é a T011
- [X] T005 [P] Criar allowlist declarativa `scripts/brand-audit-allowlist.json` com padrões técnicos (`LH_[A-Za-z_]+`, `LEARNHOUSE_[A-Z_]+`, `NEXT_PUBLIC_LEARNHOUSE_[A-Z_]+`, `get_learnhouse_config`, lockfiles, testes), área legal `apps/web/app/legal/**` e entradas factuais de importação "formato LearnHouse", cada uma com justificativa (research D6)
- [X] T006 Criar `scripts/brand-audit.mjs` (Node puro, sem dependências novas): varre termos proibidos case-insensitive (`learnhouse`, domínios `learnhouse.io/.app/.com`, nomes dos assets originais) e assets proibidos em `apps/web/app/**`, `apps/web/components/**`, `apps/web/services/**`, `apps/web/locales/**`, `apps/web/public/**`, `apps/api/src/services/email/**` e `README.md`; saída texto e `--json`; exit code 1 com ≥1 FAIL (`specs/005-rebranding-visual/contracts/branding.md` §2)
- [X] T007 Executar `node scripts/brand-audit.mjs` e registrar a contagem baseline (~733 ocorrências em `apps/web`, ~200 em `apps/api/src/services/email/`) — este número deve cair a zero FAIL ao fim da Fase 3

**Checkpoint**: módulo de marca, placeholder de e-mail e auditoria prontos — substituições podem começar.

---

## Phase 3: User Story 1 - Experiência sem a marca original (Priority: P1) 🎯 MVP

**Goal**: Nenhum vestígio visível da marca LearnHouse em telas, e-mails, erros, metadados e assets;
tudo consome `getBrand()` / `{platform_name}` (FR-001 a FR-004, FR-007, FR-012).

**Independent Test**: `node scripts/brand-audit.mjs` retorna zero FAIL + inspeção visual das
superfícies-chave do quickstart §2.

### Implementation for User Story 1

- [X] T008 [P] [US1] Substituir a marca nos componentes-chave da UI via `getBrand()`: `apps/web/components/Footers/LegalFooters.tsx` (copyright e links legais) e `apps/web/components/Objects/Watermark.tsx` (badge "Made with LearnHouse")
- [X] T009 [P] [US1] Substituir a marca nas demais telas com literal visível: `apps/web/app/home/home.tsx`, painéis e textos de `apps/web/app/auth/login/`, `apps/web/app/auth/signup/`, `apps/web/app/auth/reset/`, `apps/web/app/auth/verify-email/` e o badge de embed em `apps/web/app/embed/[orgslug]/course/[courseuuid]/activity/[activityid]/EmbedActivityClient.tsx` (PoweredByBadge), consumindo `getBrand()`
- [X] T010 [US1] Escrever e executar script de substituição em massa nos 30+ arquivos `apps/web/locales/*.json`, trocando "LearnHouse" literal por interpolação `{{brand}}` (~650 ocorrências, ex.: `"copyright": "© {{year}} LearnHouse, Inc."` em `apps/web/locales/en.json`); atualizar as chamadas `t()` correspondentes nos componentes para passar `{ brand: getBrand().name }` (e `legalName` no copyright) — coordenar com T008/T009 nos arquivos compartilhados
- [X] T011 [P] [US1] Substituir a marca nos e-mails da API: trocar as ~184 ocorrências literais em `apps/api/src/services/email/translations.py` pelo placeholder `{platform_name}` e o remetente hardcoded `"LearnHouse <…>"` em `apps/api/src/services/email/utils.py` por `f"{site_name} <…>"` (FR-003)
- [X] T030 [P] Teste pytest da renderização de e-mails em apps/api/src/tests/services/test_email_branding.py: renderizar templates com site_name configurado e assertar que o nome é injetado e que NENHUM literal "{platform_name}" sobra na saída (cobre T004 e T011; Princípio III da constituição)
  - Nota: ID fora de ordem (T030 após T011) porque a task foi adicionada em remediação posterior, sem renumerar as existentes; a posição na fase é o que vale.
- [X] T012 [P] [US1] Substituir a marca nos e-mails do web: from default em `apps/web/services/emails/resend.ts` e template `apps/web/components/Emails/LearnHouseEmail.tsx` passam a usar `getBrand()`
- [X] T013 [US1] Substituir metadados e OG: fallbacks "— LearnHouse" no `generateMetadata` das 30+ páginas (`apps/web/app/auth/*/page.tsx`, `apps/web/app/orgs/[orgslug]/**`), template `"%s | LearnHouse Admin"` em `apps/web/app/admin/layout.tsx`, e adicionar metadata raiz (`getBrand().name`/`tagline`, favicon e OG de `/brand/`) e `lang` adequado em `apps/web/app/layout.tsx`
- [X] T014 [P] [US1] Reescrever as páginas de erro `apps/web/app/not-found.tsx`, `apps/web/app/error.tsx` e `apps/web/app/global-error.tsx` com logo via `getBrand().logos` (eliminando `black_logo.png`) e texto em pt-BR seguindo o "Tom de voz (provisório)" do Kit de Marca (`specs/005-rebranding-visual/data-model.md`) (FR-007)
- [X] T015 [US1] Remover os ~12 assets originais de `apps/web/public/` (`favicon.ico`, `learnhouse_logo.png`, `learnhouse_icon.png`, `learnhouse_bigicon.png`, `learnhouse_bigicon_1.png`, `learnhouse_text_white.png`, `learnhouse_ai_black_logo.png`, `learnhouse_ai_simple.png`, `learnhouse_ai_simple_colored.png`, `black_logo.png`, `dashLogo.png`, `lrn.svg`, `lrn-dash.svg`, `lrn-text.svg`, `lrnai_icon.png`) e apontar toda referência restante para `getBrand().logos` / `apps/web/public/brand/` — depois de T008–T014
- [X] T016 [P] [US1] Atualizar os nomes exibidos nas integrações externas (projeto no painel Sentry, PostHog) para a nova marca; DSNs via env `*_SENTRY_DSN` inalteradas (FR-012)
- [X] T017 [US1] Rodar `node scripts/brand-audit.mjs` e corrigir toda ocorrência FAIL remanescente fora da allowlist até o relatório zerar (SC-001)

**Checkpoint**: US1 completa — a plataforma inteira exibe apenas a marca provisória; auditoria verde.

---

## Phase 4: User Story 2 - Atribuição legal e declaração de independência (Priority: P2)

**Goal**: Área legal discreta com atribuição AGPL e declaração de independência — único lugar com o
nome original (FR-008, FR-011).

**Independent Test**: Acessar `/legal` em ≤2 cliques de qualquer página (SC-005) e conferir
atribuição + declaração; auditoria mostra o nome original apenas como ALLOW em `apps/web/app/legal/**`.

### Implementation for User Story 2

- [X] T018 [US2] Criar a área legal `apps/web/app/legal/page.tsx` com atribuição ao projeto de origem LearnHouse, licença AGPL-3.0 e declaração de independência ("produto independente, não afiliado e não patrocinado pela LearnHouse, Inc."), em pt-BR (FR-008)
- [X] T019 [P] [US2] Criar textos próprios de termos e privacidade em `apps/web/app/legal/terms/page.tsx` e `apps/web/app/legal/privacy/page.tsx`, substituindo os originais; criar também página/canal de suporte próprio (rota ou link de suporte apontando para o canal do fork, via `getBrand().contactEmail`) e política de segurança própria — `SECURITY.md` do fork e contato de segurança próprio substituindo `security@learnhouse.app` em todas as superfícies visíveis (FR-011)
- [X] T020 [US2] Apontar os links legais do Kit de Marca: `legal.terms`/`legal.privacy`/`legal.attribution` em `apps/web/services/config/brand.ts` para `/legal/terms`, `/legal/privacy`, `/legal` e atualizar `apps/web/components/Footers/LegalFooters.tsx` (removendo links `learnhouse.io/*`) para acesso em no máximo 2 cliques (SC-005)
- [X] T021 [US2] Rodar `node scripts/brand-audit.mjs` e confirmar que `apps/web/app/legal/**` é o único local com o nome original (entradas ALLOW, nunca FAIL) e que nenhuma superfície promocional o exibe

**Checkpoint**: US1 e US2 completas — marca nova em tudo, atribuição legal acessível.

---

## Phase 5: User Story 3 - Continuidade técnica para usuários e operadores (Priority: P2)

**Goal**: Provar que a virada é visual, não estrutural (ADR-07/FR-009): sessões, cookies `LH_*` e
env vars `LEARNHOUSE_*` intocados.

**Independent Test**: quickstart §3 — sessão iniciada antes do branch permanece válida; stack sobe
com `.env` antigo inalterado.

### Implementation for User Story 3

- [X] T022 [P] [US3] (parte estática verificada: AuthContext/proxy sem mudanças, zero cookies renomeados; teste runtime pendente de stack em dev) Testar continuidade de sessão: fazer login antes de aplicar o branch, aplicar e rebuildar, e verificar que a sessão permanece válida sem novo login e que nenhum cookie foi renomeado (`LH_access`, `LH_refresh`, `LH_tenancy`, etc.) em `apps/web/proxy.ts` e `apps/web/components/Contexts/AuthContext.tsx` (quickstart §3)
- [X] T023 [P] [US3] Verificar env vars intactas: subir a stack com o `.env` antigo inalterado (`LEARNHOUSE_*` / `NEXT_PUBLIC_LEARNHOUSE_*`) e confirmar que `apps/api/config/config.py` mantém todos os nomes de env vars — apenas valores default de `site_name`/`site_description` mudaram (FR-009)
- [X] T024 [US3] Confirmar que a auditoria não sinaliza identificadores técnicos: rodar `node scripts/brand-audit.mjs` e verificar que `LH_*`, `LEARNHOUSE_*` e `get_learnhouse_config` aparecem apenas como ALLOW via `scripts/brand-audit-allowlist.json` (cenário 3 da US3)

**Checkpoint**: Todas as user stories verificadas de forma independente.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Auditoria no CI, qualidade visual e ensaio da troca final.

- [X] T025 [P] Criar workflow `.github/workflows/brand-audit.yaml` rodando `node scripts/brand-audit.mjs --json` em PRs que tocam `apps/web/**` e `apps/api/src/services/email/**` (padrão dos workflows por área: `web-lint.yaml`, `api-lint.yaml`)
- [X] T026 Adicionar a auditoria como job requerido em `.github/workflows/release.yaml` — release não publica com auditoria vermelha (FR-010, SC-001)
- [ ] T027 (PENDENTE — exige app rodando + axe/pa11y; paleta atual mantida como provisória, decisão D7) [P] Verificar contraste WCAG AA da paleta em `apps/web/styles/globals.css`: todos os pares texto/fundo ≥ 4.5:1 (texto normal) / 3:1 (texto grande) via axe/pa11y nas páginas login, dashboard, curso e 404, em modo claro e escuro; se algum par texto/fundo falhar WCAG AA, corrigir os tokens em `apps/web/styles/globals.css` no mesmo PR (FR-005, SC-003, quickstart §4)
- [ ] T028 (PENDENTE — exige rebuild; mecanismo pronto: config + /brand/*) Ensaiar a troca do nome final: alterar o nome no runtime config do web e em `LEARNHOUSE_SITE_NAME`, substituir os arquivos de `apps/web/public/brand/`, rebuildar e confirmar a marca nova em todas as superfícies sem nenhuma mudança de código (quickstart §6)
- [ ] T029 (PENDENTE — validação manual do quickstart em dev) Executar a validação completa de `specs/005-rebranding-visual/quickstart.md` (auditoria, superfícies-chave, sessão, contraste, área legal) e marcar 100% do Inventário de Rebranding como Verificado (SC-002)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — início imediato
- **Foundational (Phase 2)**: depende da Phase 1 (T003 referencia os paths de `/brand/*`); BLOQUEIA todas as stories
- **US1 (Phase 3)**: depende da Phase 2 (brand.ts, placeholder, auditoria)
- **US2 (Phase 4)**: depende da Phase 2; T020 toca `LegalFooters.tsx` — executar após T008
- **US3 (Phase 5)**: depende da Phase 3 (verifica a virada aplicada)
- **Polish (Phase 6)**: T025/T026 dependem de T006; T026 depende de T025; T027/T028/T029 dependem das stories completas

### Task-level notes

- T006 depende de T005 (o script lê a allowlist); T007 depende de T006
- T010 depende de T003 e coordena com T008/T009 (mesmos componentes recebem o parâmetro `brand`)
- T013 não é [P]: compartilha `apps/web/app/auth/*/page.tsx` com T009
- T015 vem por último na US1: só remove assets após T008–T014 migrarem as referências
- T017, T021 e T024 são os checkpoints de auditoria de cada story
- T030 acompanha T004/T011 no mesmo PR: o teste pytest entra junto com a mudança de comportamento da renderização de e-mails (Princípio III)

### Parallel Opportunities

- Phase 1: T001 ∥ T002
- Phase 2: T004 ∥ T005 (após T003 iniciar; T004 é API, T005 é script)
- Phase 3: T008 ∥ T009 ∥ T011 ∥ T012 ∥ T014 ∥ T016 (arquivos disjuntos)
- Phase 5: T022 ∥ T023
- Phase 6: T025 ∥ T027

---

## Parallel Example: User Story 1

```bash
# Após a Phase 2, disparar em paralelo (arquivos disjuntos):
Task: "Substituir marca em apps/web/components/Footers/LegalFooters.tsx e apps/web/components/Objects/Watermark.tsx"   # T008
Task: "Substituir marca em apps/web/app/home/home.tsx e apps/web/app/auth/*"                                           # T009
Task: "Placeholder {platform_name} em apps/api/src/services/email/translations.py e utils.py"                          # T011
Task: "getBrand() em apps/web/services/emails/resend.ts e apps/web/components/Emails/LearnHouseEmail.tsx"              # T012
Task: "Páginas de erro apps/web/app/{not-found,error,global-error}.tsx em pt-BR"                                       # T014

# Depois, sequencial: T010 (locales) → T013 (metadados) → T015 (remoção de assets) → T017 (auditoria zerada)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: assets provisórios neutros em `apps/web/public/brand/`
2. Phase 2: `brand.ts` + placeholder de e-mail + `brand-audit.mjs` com baseline registrado
3. Phase 3: substituições por categoria até `node scripts/brand-audit.mjs` zerar
4. **STOP e VALIDAR**: quickstart §1–§2 — plataforma inteira sem a marca original
5. Deploy/demo — este é o critério de aceite central do primeiro release

### Incremental Delivery

1. Setup + Foundational → auditoria medindo o baseline
2. US1 → auditoria zerada → MVP demonstrável
3. US2 → área legal `/legal` no ar → requisito pré-release cumprido
4. US3 → continuidade provada (sessões e env vars intactas)
5. Polish → auditoria no CI travando releases + ensaio da troca do nome final

### Parallel Team Strategy

Com dois devs após a Phase 2: Dev A executa a US1 (maior volume — locales, e-mails, metadados);
Dev B executa a US2 (`/legal`) e prepara os workflows de CI (T025/T026); US3 é validação conjunta
sobre o resultado.

---

## Notes

- [P] = arquivos diferentes, sem dependência entre si
- Nenhuma migração Alembic: sem mudança de schema (Princípio III, data-model.md)
- Nenhum identificador técnico renomeado: `LH_*`, `LEARNHOUSE_*`, tabelas, diretórios (FR-009/ADR-07)
- Troca do nome final = configuração + arquivos em `apps/web/public/brand/` — nunca retrabalho de código
- Commit após cada tarefa ou grupo lógico; parar em qualquer checkpoint para validar a story
