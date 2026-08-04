# Research: Identidade Visual do Fork (Rebranding)

**Feature**: `005-rebranding-visual` | **Date**: 2026-08-03

## D1 — Estratégia de centralização da marca

**Decisão**: Centralizar a marca em pontos únicos por app, importados pelas superfícies:
- Web: novo módulo `apps/web/services/config/brand.ts` exportando nome, tagline, e-mail de contato,
  links legais e paths dos logos — lendo do runtime config existente (`getConfig` em
  `apps/web/services/config/config.ts`) com defaults da marca provisória.
- API (e-mails): a config existente `LEARNHOUSE_SITE_NAME`/`SITE_DESCRIPTION`/`CONTACT_EMAIL`
  (`apps/api/config/config.py`) vira a fonte do nome; `translations.py` usa placeholder
  `{platform_name}` em vez do literal.
- i18n: strings dos `apps/web/locales/*.json` trocam "LearnHouse" literal por interpolação
  (`{{brand}}`), alimentada pelo módulo de marca.

**Justificativa**: Hoje as strings estão espalhadas: ~650 literais nos 30+ arquivos de locale
(ex.: `"copyright": "© {{year}} LearnHouse, Inc."` em `apps/web/locales/en.json:218`), fallbacks de
metadata em 30+ páginas (`'Login — LearnHouse'` em `apps/web/app/auth/login/page.tsx`), sender de
e-mail hardcoded (`sender = f"LearnHouse <…>"` em `apps/api/src/services/email/utils.py:274`;
`'LearnHouse <hello@emails.learnhouse.app>'` em `apps/web/services/emails/resend.ts:31`). Um
busca-e-substituição espalhado repetiria o problema na troca do nome final; com centralização, a
troca final é mudança de configuração (edge case explícito da spec).

**Alternativas rejeitadas**: (a) busca-e-substituição direto — barato agora, caro na troca do nome
definitivo e propenso a regressão em merges do upstream; (b) sistema de theming multi-marca
genérico — YAGNI, só existe uma marca por implantação.

## D2 — Parametrização de nome e logo para troca final barata

**Decisão**: Assets da nova marca entram em `apps/web/public/brand/` com nomes neutros
(`logo-horizontal.svg`, `logo-symbol.svg`, `logo-mono.svg`, `logo-small.svg`, variantes dark) e são
referenciados apenas via `brand.ts`. O nome exibido vem de config (runtime config no web;
`LEARNHOUSE_SITE_NAME` na API — nome da env var preservado por FR-009, apenas o valor muda). A marca
provisória é o default embutido; a troca final = trocar valores de config + substituir os arquivos
em `public/brand/`, sem tocar em componentes.

**Justificativa**: O nome definitivo é decisão pendente da Fase 0 (documento-base, seção 19); a spec
exige que o trabalho estrutural avance com marca provisória e que a troca final não seja retrabalho.

**Alternativas rejeitadas**: nomes de arquivo com o nome provisório (ex.: `acme_logo.png`) — obriga
renomear assets e referências na troca final.

## D3 — Auditoria automatizada de marca residual

**Decisão**: Script `scripts/brand-audit.mjs` (Node puro, sem dependência nova) que varre termos
proibidos (case-insensitive: `learnhouse`, domínios `learnhouse.io|app`, logos) e assets proibidos
(lista dos arquivos originais de `apps/web/public/`) nas superfícies visíveis, com allowlist
explícita para identificadores técnicos e área legal. Exit code ≠ 0 quando encontra ocorrência não
permitida. No CI: novo workflow `.github/workflows/brand-audit.yaml` rodando em PRs (paths de
`apps/web` e `apps/api/src/services/email`) e como job requerido em `.github/workflows/release.yaml`
antes de publicar a release — o CI existente já segue esse padrão de workflows por área
(`web-lint.yaml`, `api-lint.yaml`, `e2e.yaml`).

**Justificativa**: Documento-base 12.1 pede "automatizar busca por nome, domínio e assets da marca
original no pipeline"; FR-010/SC-001 exigem falha de release com marca visível. Grep estruturado com
allowlist é o mínimo que atende — detalhes no contrato (`contracts/branding.md`).

**Alternativas rejeitadas**: (a) teste E2E visual com screenshots — caro, frágil e não cobre
e-mails/metadados; (b) revisão manual por checklist — não falha a release automaticamente.

## D4 — Templates de e-mail

**Decisão**: Parametrizar em vez de duplicar: `apps/api/src/services/email/translations.py` (~184
ocorrências em subject/body/footer, múltiplos idiomas) passa a usar `{platform_name}` resolvido pela
config; o sender em `utils.py` usa `site_name` da config; a marca visual (logo do cabeçalho) usa o
mecanismo existente de logo com fallback — o fallback passa a ser o asset novo. No web,
`apps/web/components/Emails/LearnHouseEmail.tsx` e `apps/web/services/emails/resend.ts` (from
default) seguem o mesmo padrão via `brand.ts`. E-mails já enfileirados com template antigo na virada
são aceitos por curto período (edge case da spec).

**Justificativa**: Princípio II — a API permanece autoritativa sobre os e-mails; um placeholder por
string é o menor diff e sobrevive a merges do upstream melhor que templates reescritos.

**Alternativas rejeitadas**: novo conjunto de templates paralelo — duplicação e drift.

## D5 — Tema da tela de login do Keycloak

**Decisão**: Fora do mínimo desta feature. Registrar como item desejável (tema Keycloak com logo e
paleta da nova marca) a executar junto da feature de autenticação; o critério de aceite aqui é que a
**plataforma** não exiba a marca original. A tela do Keycloak usa o tema padrão do Keycloak (marca
Keycloak, não LearnHouse), portanto não viola FR-001.

**Justificativa**: A spec assume exatamente isso ("personalizá-la é desejável, mas o mínimo exigido
é que a plataforma em si não exiba a marca original"). Evita acoplar esta feature ao provisionamento
do realm (Fases 1–3 do roteiro).

**Alternativas rejeitadas**: incluir o tema Keycloak no escopo — cria dependência de infraestrutura
que ainda não existe no repositório.

## D6 — Escopo do que a auditoria ignora (allowlist)

**Decisão**: A auditoria NÃO sinaliza:
1. Identificadores técnicos: cookies `LH_*` (~104 ocorrências, ex. `apps/web/proxy.ts`,
   `apps/web/components/Contexts/AuthContext.tsx`), env vars `LEARNHOUSE_*` /
   `NEXT_PUBLIC_LEARNHOUSE_*` (~115 na API, ex. `apps/api/config/config.py`), nomes de
   função/variável (`get_learnhouse_config`), tabelas, diretórios `apps/*` — FR-009/ADR-07.
2. Conteúdo criado por usuários (banco, uploads) — a auditoria varre o repositório, não dados.
3. A área legal (`apps/web/app/legal/`) — único lugar autorizado a citar o nome original (FR-008),
   incluindo a funcionalidade de importação de cursos no formato LearnHouse (referência factual ao
   formato de arquivo, tratada caso a caso na allowlist).
4. Código não visível ao usuário: testes, lockfiles, comentários, histórico git, `bun.lock`.

**Justificativa**: User Story 3 / cenário 3 da spec exige que a auditoria não sinalize nomes
técnicos; sem allowlist explícita a auditoria daria falso positivo permanente e seria desligada.

**Alternativas rejeitadas**: auditoria só sobre o build final (bundle) — não cobre e-mails da API
nem docs; fica como evolução possível.

## D7 — Paleta de cores provisória

**Decisão**: A paleta atual (já 100% em tokens CSS em `apps/web/styles/globals.css`) é **mantida**
como paleta provisória desta feature. A paleta definitiva chega com o kit visual aprovado, via troca
de valores dos tokens — mecanismo já ensaiado na T028 (troca de marca sem mudança de código). O único
requisito ativo sobre a paleta nesta feature é o contraste WCAG AA (FR-005, verificado na T027, com
correção dos tokens no mesmo PR se algum par falhar).

**Justificativa**: Nenhuma paleta nova foi definida ainda; trocar cores agora seria retrabalho na
chegada do kit aprovado. Como toda cor já é token CSS, a troca definitiva é edição de valores em um
arquivo — mesmo custo de fazê-la agora, sem o risco de fazê-la duas vezes.

**Alternativas rejeitadas**: criar paleta provisória distinta da atual — trabalho descartável que não
aproxima o resultado final e adiciona uma rodada extra de verificação de contraste.
