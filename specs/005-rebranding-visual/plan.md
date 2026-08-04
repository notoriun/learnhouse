# Plano de Implementação: Identidade Visual do Fork (Rebranding)

**Branch**: `005-rebranding-visual` | **Date**: 2026-08-03 | **Spec**: `specs/005-rebranding-visual/spec.md`

**Input**: Especificação da feature em `specs/005-rebranding-visual/spec.md`

## Summary

Substituir toda a marca LearnHouse visível ao usuário (telas, e-mails, páginas de erro,
favicon/manifest/OG, metadados, integrações externas) por uma marca própria — provisória até a
decisão do nome final —, mantendo intocados os identificadores técnicos (`LH_*`, `LEARNHOUSE_*`,
tabelas, diretórios) conforme ADR-07 do documento-base (seção 10). Abordagem técnica: centralizar
nome, logos e links legais em um módulo de marca único consumido por web, e-mails e metadados;
trocar assets por arquivos com nomes neutros; parametrizar strings de i18n com variável de marca;
adicionar área legal com atribuição AGPL e declaração de independência; e criar uma auditoria
automatizada no CI que falha a release ao encontrar marca original em superfície visível
(documento-base 12.1: "Automatizar busca por nome, domínio e assets da marca original no pipeline").

## Technical Context

**Language/Version**: TypeScript (Next.js App Router, React 18) no web; Python 3.12 (FastAPI) na API

**Primary Dependencies**: Next.js, TailwindCSS (tokens via CSS vars em `apps/web/styles/globals.css`),
Radix UI, `next/font` (Wix Madefor Text, licença OFL); FastAPI + templates/traduções de e-mail em
`apps/api/src/services/email/`; Resend/SMTP para envio

**Storage**: N/A — nenhuma mudança de schema; a marca é configuração e assets estáticos

**Testing**: script de auditoria de marca (Node, rodável local e no CI); testes existentes da API
(pytest) e do web (bun test) permanecem verdes; verificação de contraste WCAG AA por ferramenta

**Target Platform**: web (browser) + e-mails transacionais; deploy Docker existente inalterado

**Project Type**: monorepo web application (apps/web + apps/api; Collab e CLI não têm superfície de marca visível ao usuário final)

**Performance Goals**: nenhum novo; a troca de marca não pode adicionar requests ou peso perceptível (assets otimizados como os atuais)

**Constraints**: sessões ativas sobrevivem à virada (cookies `LH_*` intocados); implantações com env
vars `LEARNHOUSE_*` sobem sem alteração; troca do nome final = mudança de configuração, não retrabalho;
único lugar com o nome original é a área legal (FR-008)

**Scale/Scope**: ~733 ocorrências case-insensitive de "learnhouse" em `apps/web` (das quais ~650 em
`apps/web/locales/*.json`, 30+ idiomas), ~200 em `apps/api/src/services/email/`, ~12 assets em
`apps/web/public/`, 30+ páginas com `generateMetadata`. Sem NEEDS CLARIFICATION restante.

## Constitution Check

*GATE: aprovado antes da Fase 0; reavaliado após o design da Fase 1.*

| Princípio | Avaliação | Status |
|---|---|---|
| I. Fronteiras entre Apps São Contratos | Nenhum canal novo entre apps. O nome da plataforma já trafega pelo contrato existente (`LEARNHOUSE_SITE_NAME` → endpoint de instance info → web). E-mails são renderizados só na API. | PASS |
| II. Backend API-First | Os textos e a marca dos e-mails permanecem autoritativos na API (`apps/api/src/services/email/translations.py` + config `site_name` em `apps/api/config/config.py`). O web centraliza a marca visual em um módulo de configuração próprio (`apps/web/services/config/brand.ts`) — apresentação, não regra de negócio; nada é duplicado com autoridade no cliente. | PASS |
| III. Mudanças de Schema Exigem Migrações e Testes | Sem mudança de schema → sem migração Alembic. Nenhum comportamento de endpoint muda (apenas strings/assets); a suíte existente permanece cobrindo. A auditoria de marca entra como verificação nova no CI. | PASS |
| IV. Segurança Multi-Tenant É Inegociável | Sem novo endpoint, sem mudança de RBAC, sem toque em cookies/sessão (FR-009 exige exatamente não tocar). O branding por organização já existente (`OrgEditBranding`) não é alterado. | PASS |
| V. Simplicidade e Reúso Primeiro | Reúso: env vars `LEARNHOUSE_SITE_NAME`/`SITE_DESCRIPTION`/`CONTACT_EMAIL` já existem; tokens de cor já são CSS vars; i18n já suporta interpolação. Decisão central: **um** módulo de marca em vez de strings espalhadas — menos código no total e troca final barata. Nenhuma dependência nova. Auditoria = um script Node + um job de CI. | PASS |

Sem violações; Complexity Tracking vazio.

## Project Structure

### Documentation (this feature)

```text
specs/005-rebranding-visual/
├── plan.md              # Este arquivo
├── research.md          # Fase 0
├── data-model.md        # Fase 1
├── quickstart.md        # Fase 1
├── contracts/
│   └── branding.md      # Contrato do módulo de marca + contrato da auditoria
└── tasks.md             # Fase 2 (/speckit-tasks — não criado por este comando)
```

### Source Code (repository root)

```text
apps/web/
├── services/config/
│   ├── config.ts                    # Runtime config existente (getConfig) — reusado
│   └── brand.ts                     # NOVO: módulo de marca (nome, tagline, links legais, paths de logo)
├── styles/globals.css               # Tokens de cor existentes (--primary, --background…) — paleta nova entra aqui
├── tailwind.config.js               # Já referencia os tokens via hsl(var(--…)) — sem mudança estrutural
├── app/
│   ├── layout.tsx                   # Fonte (next/font) e lang; metadados raiz
│   ├── not-found.tsx / error.tsx / global-error.tsx   # Páginas de erro → nova marca + tom de voz pt
│   ├── auth/{login,signup,reset,verify-email}/        # Títulos "— LearnHouse" → brand.ts
│   ├── admin/layout.tsx             # Template "%s | LearnHouse Admin" → brand.ts
│   ├── orgs/[orgslug]/…             # generateMetadata em 30+ páginas → fallbacks via brand.ts
│   └── legal/                       # NOVO: área legal (atribuição AGPL, declaração de independência)
├── components/
│   ├── Footers/LegalFooters.tsx     # Copyright/termos → brand.ts + link para /legal
│   ├── Objects/Watermark.tsx        # "Made with LearnHouse" → marca nova
│   └── Emails/LearnHouseEmail.tsx   # Template React de e-mail (web) → parametrizado
├── locales/*.json                   # 30+ idiomas: "LearnHouse" literal → interpolação {{brand}}
└── public/
    ├── brand/                       # NOVO: logos da nova marca (horizontal, símbolo, mono, reduzida; claro/escuro)
    ├── favicon.ico                  # Substituído
    └── learnhouse_*.png, lrn*.svg, black_logo.png, dashLogo.png   # Substituídos/removidos das superfícies

apps/api/
├── config/config.py                 # LEARNHOUSE_SITE_NAME etc. já existentes — viram a fonte do nome nos e-mails
└── src/services/email/
    ├── utils.py                     # Sender "LearnHouse <…>" → site_name da config
    └── translations.py              # ~184 ocorrências → placeholder {platform_name}

scripts/
└── brand-audit.mjs                  # NOVO: auditoria de marca residual (termos + assets proibidos)

.github/workflows/
├── brand-audit.yaml                 # NOVO: roda a auditoria em PRs e antes de release
└── release.yaml                     # Passa a depender da auditoria verde
```

**Structure Decision**: monorepo existente mantido (constituição, seção Stack). A feature não cria
apps nem pacotes: adiciona um módulo de marca em `apps/web/services/config/brand.ts` (ao lado do
runtime config que já é o padrão do projeto), um diretório de assets `apps/web/public/brand/`, uma
rota `apps/web/app/legal/`, um script `scripts/brand-audit.mjs` e um workflow de CI. Na API, reusa a
configuração existente (`LEARNHOUSE_SITE_NAME` — o nome da env var não muda, por FR-009; só o valor).

## Complexity Tracking

Sem violações da constituição — tabela não aplicável.
