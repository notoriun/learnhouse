# Research: Conformidade AGPL e Oferta de Código-Fonte

**Feature**: `006-conformidade-agpl` | **Date**: 2026-08-03

Fatos levantados no repositório real; cada tópico traz Decisão / Justificativa / Alternativas.

## 1. Correlação versão em execução ↔ pacote de fonte (FR-005)

**Decisão**: a tag git numérica é a identidade canônica da release, e a instância expõe essa
mesma versão em `GET /api/v1/instance/info` (novo campo `version`).

**Fatos encontrados**:
- A versão já existe em três lugares sincronizados: `apps/api/pyproject.toml`
  (`version = "1.3.4"`), `apps/api/app.py:74` (`FastAPI(... version="1.3.4")` — hoje visível
  apenas no OpenAPI) e `apps/web/package.json` (`"version": "1.3.4"`). Não há `package.json`
  na raiz.
- O release já é disparado por push de tag `[0-9]*` (`.github/workflows/release.yaml`), e a
  imagem Docker é tageada `ghcr.io/learnhouse/app:<tag>`. A tag JÁ é o identificador da
  release de ponta a ponta — só falta a instância declará-la.
- `GET /api/v1/instance/info` (`apps/api/src/routers/instance.py`, registrado em
  `apps/api/src/router.py:359`) é público e cacheado, mas hoje não retorna versão.

**Justificativa**: reusa o mecanismo existente (tag = versão = tag da imagem); um campo lido de
`pyproject.toml`/metadata do pacote fecha o ciclo: rodapé consulta a API, monta o link para a
tag exata, e a comparação "versão implantada vs. fonte" vira igualdade de strings.

**Alternativas rejeitadas**: expor o SHA do commit (redundante — a tag é imutável e legível);
endpoint novo `/version` (o `/instance/info` público e cacheado já existe — Princípio V);
injetar versão só por env var no build (divergiria do que o código declara).

## 2. Formato do pacote de fonte (FR-002, FR-003)

**Decisão**: repositório público do fork com a tag da release como oferta primária, **mais** um
tarball imutável (`git archive` da tag) anexado à GitHub Release com `SHA256SUMS`.

**Justificativa**: o repositório público com tags cumpre a AGPL §13/§6 (acesso gratuito à
fonte correspondente por servidor de rede) e é o padrão assumido na spec para a decisão
pendente de implantação. O tarball anexado dá o artefato verificável que FR-004 exige
("falha quando a fonte não puder ser gerada, publicada ou validada"): é sobre ele que rodam a
varredura de segredos, a auditoria de EE e os checksums. `git archive` respeita
`.gitattributes`, nunca inclui `.env` locais e custa um passo de workflow. Os scripts de
geração/instalação/execução exigidos já estão no repo (`Dockerfile`, `docker-compose`/CLI
`npx learnhouse`) e entram no tarball naturalmente.

**Alternativas rejeitadas**: somente a tag no repo (sem artefato imutável, nada para o
pipeline validar/anexar — e um force-push acidental quebraria a correspondência histórica);
espelho em portal autenticado (só se a decisão pendente Jurídico/DevOps mudar o destino — o
mecanismo continua o mesmo, muda o alvo da publicação); tarball com dependências vendorizadas
(a AGPL exige a fonte correspondente do trabalho, não dos componentes de sistema; lockfiles
`bun.lock`/`uv.lock` já fixam as dependências).

## 3. Verificação de segredos no pipeline (FR-003, SC-003)

**Decisão**: adotar **gitleaks** como passo bloqueante do job de empacotamento, varrendo o
conteúdo do tarball gerado (e, em job semanal opcional, o histórico completo).

**Fatos encontrados**: não existe hoje nenhuma varredura de segredos no CI — busca por
`gitleaks|trufflehog|secret.scan|detect-secrets` em `.github/` retorna vazio. Os workflows
existentes são: `api-lint.yaml`, `api-tests.yaml`, `build-community.yaml`, `cli-publish.yaml`,
`cli-tests.yaml`, `e2e.yaml`, `notify-infra.yaml`, `release.yaml`, `web-lint.yaml`.

**Justificativa**: nada a reusar, então escolhe-se a ferramenta mais simples de operar em
GitHub Actions: gitleaks é binário único, com action oficial, config TOML versionável para
falsos positivos e saída clara. Falha do scan = release não publicada (edge case da spec:
"em ocorrência, a publicação falha antes da exposição").

**Alternativas rejeitadas**: trufflehog (mais pesado, foco em verificação ativa de credenciais
contra provedores — desnecessário para o gate de publicação); detect-secrets (exige baseline
auditado manualmente, mais atrito para o ganho).

## 4. Código Enterprise no repo público (FR-008)

**Decisão**: o fork **mantém os pontos de extensão EE sob AGPL como estão** e garante, por
verificação automatizada de release, que a pasta `ee/` nunca exista no repo, no pacote de
fonte nem na imagem publicada.

**Fatos encontrados** (o que o repo público realmente contém):
- **Não existe diretório `ee/`** no repositório público. O módulo Enterprise em si não está
  aqui.
- O que existe é infraestrutura de *gating* publicada pelo próprio upstream sob AGPL:
  - `apps/api/src/core/ee_hooks.py` — carrega `ee.hooks` via importlib **somente se** a pasta
    `ee/` existir em disco (`is_ee_available()`); respeita `LEARNHOUSE_DISABLE_EE=1`; sem a
    pasta, todos os hooks retornam `None`/fallback livre.
  - `apps/api/src/core/deployment_mode.py` — modos `saas`/`ee`/`oss`;
    `EE_ONLY_FEATURES = {sso, audit_logs, payments, analytics_advanced, scorm}` ficam
    bloqueadas em modo `oss`; `LEARNHOUSE_FORCE_EE=1` só funciona em development_mode.
  - Gating de planos em `apps/api/src/security/features_utils/` (`plans.py`,
    `plan_check.py`, `usage.py`) e referências em `apps/api/src/routers/orgs/org_plan.py`,
    `apps/api/src/routers/analytics.py`, etc.
  - No Web: `apps/web/components/Hooks/useEEStatus.tsx`, `useEnterprisePlan.tsx`,
    `apps/web/components/Dashboard/Shared/FeatureGate/FeatureGate.tsx`,
    `apps/web/components/Admin/EELicenseError.tsx`, serviços de billing/planos e strings em
    `apps/web/locales/*.json` — tudo UI de gate/upsell, sem lógica Enterprise.
- `Dockerfile:99` — `RUN if [ "$LEARNHOUSE_PUBLIC" = "true" ]; then rm -rf /app/api/ee; fi` —
  e ambos os workflows de build (`release.yaml`, `build-community.yaml`) já passam
  `LEARNHOUSE_PUBLIC=true`.

**Justificativa**: como o módulo EE não está no repo, "remover código Enterprise" se reduz a
**nunca introduzi-lo** e provar isso a cada release. Os hooks são código AGPL distribuído pelo
upstream — mantê-los é juridicamente seguro, deixa o modo `oss` plenamente funcional
(fallbacks livres já implementados) e evita conflitos permanentes de merge nas atualizações
upstream (diretriz 12.1/12.2 do documento-base). A auditoria automatizada (`ee/` ausente no
tarball; `test -d /app/api/ee` falha na imagem) transforma FR-008 em verificação mecânica.

**Alternativas rejeitadas**: extirpar os hooks e gates do código (grande diff em arquivos
centrais → conflito garantido a cada merge upstream, sem ganho jurídico — os hooks já são
AGPL); definir `LEARNHOUSE_DISABLE_EE=1` em produção do fork (inócuo sem a pasta `ee/`, mas
pode ser adotado como cinto de segurança operacional de custo zero).

## 5. Onde o link de fonte entra na UI (FR-001)

**Decisão**: adicionar o link "Código-fonte" (rotulado com AGPL-3.0) em
`apps/web/components/Footers/LegalFooters.tsx`, ao lado dos links Terms/Privacy existentes, e
na página da área legal criada pela feature `005-rebranding-visual`.

**Fatos encontrados**: `LegalFooters.tsx` já concentra o rodapé legal reutilizado
(`AuthFooter` sob formulários de auth; `CopyrightFooter` com "© {year} LearnHouse, Inc." +
Terms + Privacy nas superfícies do app). `apps/web/components/Footer/Footer.tsx` é apenas
injetor de `OrgScripts`, não é rodapé visual. Traduções via `react-i18next`
(`apps/web/locales/*.json`).

**Justificativa**: reúso do componente que já aparece nas superfícies principais garante a
regra dos 2 cliques sem componente novo; o href é montado com a versão vinda de
`/api/v1/instance/info` → `https://github.com/<org-fork>/<repo>/releases/tag/<version>`
(fallback para a página de releases se a versão não carregar). A declaração de independência
textual entra na área legal (005) e no README; esta feature define o conteúdo obrigatório.

**Alternativas rejeitadas**: item de menu/página dedicada (mais cliques, mais superfície);
hardcode da versão no build do Web (violaria o Princípio II — a API é a fonte da verdade).

## 6. Imagens Docker (FR-009)

**Decisão**: adicionar labels OCI padrão no build das imagens em `release.yaml` e
`build-community.yaml` (parâmetro `labels:` do `docker/build-push-action` já em uso):
`org.opencontainers.image.source=<URL do repo do fork>`,
`org.opencontainers.image.version=<tag>`, `org.opencontainers.image.revision=<sha>`,
`org.opencontainers.image.licenses=AGPL-3.0-or-later`.

**Justificativa**: `org.opencontainers.image.source` é o mecanismo padrão de referência à
fonte para imagens (o ghcr.io o usa para vincular imagem → repositório); as instruções de
construção já acompanham a fonte (o `Dockerfile` está no tarball e no repo). Custo: linhas de
YAML nos workflows existentes.

**Alternativas rejeitadas**: embutir o tarball de fonte na imagem (infla a imagem; a AGPL
pede oferta da fonte, não cópia embarcada); README no registry apenas (não é padrão legível
por máquina).
