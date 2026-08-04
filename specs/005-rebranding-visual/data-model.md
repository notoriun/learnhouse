# Data Model: Identidade Visual do Fork (Rebranding)

**Feature**: `005-rebranding-visual` | **Date**: 2026-08-03

**Sem entidades de banco.** Esta feature não cria tabelas, não altera colunas e não gera migração
Alembic (Princípio III satisfeito por vacuidade). As duas "entidades" da spec são configuração e
artefato de processo.

## Kit de Marca (configuração)

Fonte única consumida pelas superfícies (ver `contracts/branding.md`). Vive em código/config, não no
banco:

| Campo | Tipo | Onde vive | Notas |
|---|---|---|---|
| `name` | string | `brand.ts` (web) / `site_name` na config da API | Nome curto exibido ("Acme"). Provisório até decisão final; troca = config. |
| `legalName` | string | `brand.ts` | Razão social para copyright ("© {ano} Acme Ltda."). |
| `tagline` | string | `brand.ts` / `site_description` | Usada em metadados e OG description. |
| `contactEmail` | string | `brand.ts` / `contact_email` | Links de suporte em e-mails e rodapés. |
| `logos` | mapa variante → path | `brand.ts` → `apps/web/public/brand/` | Variantes obrigatórias (FR-004): `horizontal`, `symbol`, `mono`, `small` — cada uma com versão para fundo claro e escuro; legíveis em 16 px. |
| `colors` | tokens CSS | `apps/web/styles/globals.css` (`--primary`, `--background`, …) | Paleta nova entra nos tokens HSL existentes; todos os pares texto/fundo com contraste WCAG AA (FR-005). |
| `fonts` | famílias | `apps/web/app/layout.tsx` via `next/font` | Atual: Wix Madefor Text (licença OFL, adequada — FR-006). Trocar apenas se o kit aprovado exigir. |
| `legalLinks` | mapa | `brand.ts` | `terms`, `privacy`, `legal` (área de atribuição). Substituem os links `learnhouse.io/*` de `LegalFooters.tsx`. |
| `attribution` | bloco de texto | rota `apps/web/app/legal/` | Atribuição ao LearnHouse, licença AGPL-3.0 e declaração de independência — único lugar com o nome original (FR-008). |

### Tom de voz (provisório)

Regras verificáveis para todo texto de interface, e-mail e página de erro (FR-007; consumido por
T014 e demais tasks de texto):

- Português claro e direto.
- Tratamento por "você".
- Sem jargão técnico desnecessário.
- Mensagens de erro sempre com ação sugerida ("Tente novamente", "Contate o suporte").
- Sem humor em mensagens de erro.
- Terminologia consistente com o glossário da plataforma.

Regras:
- Toda superfície consome o Kit por import/config — nenhum literal de marca fora dele.
- Defaults embutidos = marca provisória; valores de implantação via runtime config
  (`runtime-config.json` no web) e env vars existentes na API (nomes `LEARNHOUSE_*` preservados).

## Inventário de Rebranding (artefato verificável)

Lista de superfícies com situação de substituição — insumo humano do acompanhamento e espelho do que
a auditoria automatizada (`scripts/brand-audit.mjs`) verifica mecanicamente. Mantido em
`tasks.md`/checklist da feature, não em banco.

| Categoria | Superfícies (amostra real) | Volume aprox. | Situação inicial |
|---|---|---|---|
| Telas web | `LegalFooters.tsx`, `Watermark.tsx`, `home/home.tsx`, auth (login/signup/reset/verify), dash layouts, embed `PoweredByBadge`, onboarding | ~80 arquivos com literal visível | Pendente |
| Strings i18n | `apps/web/locales/*.json` (30+ idiomas, ~20 ocorrências cada) | ~650 ocorrências | Pendente |
| E-mails | `apps/api/src/services/email/translations.py` (~184), `utils.py` (sender), `components/Emails/LearnHouseEmail.tsx`, `services/emails/resend.ts` | ~200 ocorrências | Pendente |
| Assets | `favicon.ico`, `learnhouse_*.png` (7), `black_logo.png`, `dashLogo.png`, `lrn*.svg` (3), `lrnai_icon.png` em `apps/web/public/` | ~12 arquivos | Pendente |
| Metadados/OG | `generateMetadata` em 30+ páginas, `admin/layout.tsx` (template de título), fallbacks "— LearnHouse" | ~30 páginas | Pendente |
| Páginas de erro | `app/not-found.tsx`, `error.tsx`, `global-error.tsx` (usam `black_logo.png`, texto em inglês) | 3 arquivos | Pendente |
| Integrações externas | Sentry (nome do projeto no painel; DSN via env `*_SENTRY_DSN` inalterada), PostHog | Config externa | Pendente |
| Área legal | `apps/web/app/legal/` (nova) | 1 rota | Pendente |

Estados possíveis por item: `Pendente` → `Substituído` → `Verificado` (auditoria + inspeção visual).
SC-002 exige 100% em `Verificado` antes do release.

## Fora do modelo (explicitamente não muda)

- Cookies `LH_access`, `LH_refresh`, `LH_tenancy`, `LH_mode`, `LH_default_org`, etc.
- Env vars `LEARNHOUSE_*` / `NEXT_PUBLIC_LEARNHOUSE_*` (nomes; valores como `SITE_NAME` mudam).
- Tabelas, colunas, diretórios `apps/web`/`apps/api`, nomes de pacote.
- **Nenhuma migração de banco é criada nesta feature.**
