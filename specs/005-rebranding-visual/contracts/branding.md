# Contrato: Módulo de Marca e Auditoria de Marca

**Feature**: `005-rebranding-visual` | **Date**: 2026-08-03

## 1. Módulo de Marca

### 1.1 Web — `apps/web/services/config/brand.ts`

Interface consumida por componentes, metadados e páginas de erro. Lê o runtime config existente
(`getConfig`) com defaults da marca provisória:

```ts
export interface Brand {
  name: string          // "Acme" — nome curto exibido
  legalName: string     // "Acme Ltda." — copyright
  tagline: string       // descrição para metadados/OG
  contactEmail: string  // suporte
  logos: {
    horizontal: string  // /brand/logo-horizontal.svg (+ variante dark)
    symbol: string      // /brand/logo-symbol.svg
    mono: string        // /brand/logo-mono.svg
    small: string       // /brand/logo-small.svg — legível em 16px
  }
  legal: {
    terms: string       // rota/URL de termos próprios
    privacy: string     // rota/URL de privacidade própria
    attribution: string // rota da área legal ("/legal")
  }
}
export const getBrand: () => Brand
```

Regras de consumo:
- **Telas**: nenhum componente referencia literal de marca nem asset `learnhouse_*`/`lrn*`; sempre
  `getBrand()`. Strings i18n usam interpolação (`t('common.copyright', { brand: getBrand().legalName, year })`).
- **Metadados**: fallbacks de `generateMetadata` e templates de título usam `getBrand().name`;
  OG images vêm de `public/brand/`.
- **Páginas de erro** (`not-found.tsx`, `error.tsx`, `global-error.tsx`): logo via `getBrand().logos`,
  texto em pt-BR no novo tom de voz.

### 1.2 API/E-mails — config existente

- `site_name`, `site_description`, `contact_email` (`apps/api/config/config.py`, env vars
  `LEARNHOUSE_SITE_NAME` etc. — nomes preservados) são a fonte do nome nos e-mails.
- `translations.py`: toda string com nome de plataforma usa `{platform_name}`; a renderização injeta
  `site_name`.
- Sender (`utils.py`): `f"{site_name} <{mailing.system_email_address}>"`.
- Web (`services/emails/resend.ts`, `components/Emails/LearnHouseEmail.tsx`): from e template usam
  `getBrand()`.

Compromisso de estabilidade: trocar a marca provisória pelo nome final altera **apenas** valores de
config e arquivos em `public/brand/` — nenhuma assinatura deste contrato muda.

## 2. Auditoria de Marca — `scripts/brand-audit.mjs`

### 2.1 Termos proibidos (case-insensitive)

| Termo | Observação |
|---|---|
| `learnhouse` | Cobre "LearnHouse", "Learnhouse", URLs `learnhouse.io/.app/.com` |
| Assets por nome | Referências a `learnhouse_*.png`, `black_logo.png`, `dashLogo.png`, `lrn.svg`, `lrn-dash.svg`, `lrn-text.svg`, `lrnai_icon.png` |

### 2.2 Assets proibidos (existência do arquivo)

Os arquivos originais listados acima em `apps/web/public/` não podem existir na release (substituídos
por `public/brand/*` ou removidos), incluindo `favicon.ico` original.

### 2.3 Superfícies varridas

- `apps/web/app/**`, `apps/web/components/**`, `apps/web/services/**`, `apps/web/locales/**`, `apps/web/public/**`
- `apps/api/src/services/email/**`
- Docs visíveis ao usuário: `README.md` do fork e docs de implantação voltadas a usuário

### 2.4 Allowlist (não sinalizado)

1. Padrões técnicos: `LH_[A-Za-z_]+`, `LEARNHOUSE_[A-Z_]+`, `NEXT_PUBLIC_LEARNHOUSE_[A-Z_]+`,
   identificadores de código (`get_learnhouse_config`, imports, nomes de arquivo `.ts/.py` não
   exibidos ao usuário), lockfiles, `Dockerfile`, testes.
2. `apps/web/app/legal/**` — área legal autorizada (FR-008).
3. Entradas explícitas de importação de curso "formato LearnHouse" (referência factual), listadas
   arquivo a arquivo em `scripts/brand-audit-allowlist.json`.
4. Conteúdo de usuário (fora do repositório por definição).

A allowlist é declarativa (arquivo JSON versionado); toda entrada exige justificativa em comentário.

### 2.5 Formato do relatório

Saída em texto (e `--json` para CI):

```
BRAND AUDIT — 2026-08-03
FAIL apps/web/locales/en.json:218  termo "LearnHouse"  [string i18n]
FAIL apps/web/public/learnhouse_logo.png  asset proibido presente
ALLOW apps/web/app/legal/page.tsx:12  (allowlist: área legal)
Resumo: 2 falhas, 1 permitido, 0 avisos
```

### 2.6 Critério de falha

- Exit code `1` se houver ≥ 1 ocorrência FAIL; `0` caso contrário. Entradas de allowlist nunca falham.
- CI: workflow `.github/workflows/brand-audit.yaml` roda em PRs que tocam as superfícies varridas e
  como job requerido do `release.yaml`; release não publica com auditoria vermelha (FR-010, SC-001).
- Execução local: `node scripts/brand-audit.mjs` na raiz do repo (sem dependências instaladas).
