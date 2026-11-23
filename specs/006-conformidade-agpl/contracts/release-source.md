# Contratos: Processo de Release e Link/Endpoint de Fonte

**Feature**: `006-conformidade-agpl` | **Date**: 2026-08-03

## Contrato 1 — Processo de release com pacote de fonte

Extensão do workflow existente `.github/workflows/release.yaml`.

### Gatilhos

- Push de tag `[0-9]*` (mecanismo atual — cobre releases normais **e hotfixes**: qualquer
  implantação passa por tag; nenhuma via alternativa de publicação é permitida).
- O script `scripts/package-source.sh` é executável localmente contra uma tag para o caso de
  emergência com CI indisponível. A varredura de segredos (gitleaks, config versionada
  `.gitleaks.toml`) está **embutida no próprio script** — não é um passo separado do CI e não
  pode ser pulada: empacotar já varre, e qualquer finding não suprimido encerra o script com
  código ≠ 0, sem gerar artefatos publicáveis. **Pré-requisito da via local**: binário
  `gitleaks` instalado na máquina. A release só é criada se todas as validações passarem.

### Passos (job `source-package`, pré-requisito dos jobs de imagem/manifesto)

1. `actions/checkout` da tag (`fetch-depth: 0` — histórico preservado).
2. **Auditoria Enterprise**: falha se existir diretório `ee/` no working tree da tag.
3. **Empacotamento**: `git archive --format=tar.gz -o source-<tag>.tar.gz <tag>`.
4. **Validação de conteúdo**: falha se o tarball não contiver `LICENSE` (AGPL-3.0) na raiz,
   `Dockerfile`, `apps/api/pyproject.toml`, `apps/web/package.json`; falha se a versão em
   `apps/api/pyproject.toml` ≠ tag.
5. **Varredura de segredos**: embutida em `scripts/package-source.sh` — gitleaks (config
   versionada `.gitleaks.toml`) sobre o conteúdo extraído do tarball; **qualquer finding não
   suprimido = falha com código ≠ 0** (a publicação para antes da exposição). Por rodar dentro
   do script, a via local de emergência executa a mesma varredura por construção.
6. **Checksums**: gerar `SHA256SUMS` cobrindo o tarball.
7. **Publicação**: anexar `source-<tag>.tar.gz` + `SHA256SUMS` à GitHub Release da tag
   (criando-a se não existir).
8. Jobs de imagem (existentes) rodam **somente após** o sucesso deste job, com
   `LEARNHOUSE_PUBLIC=true` (remove `/app/api/ee` — `Dockerfile:99`) e labels OCI:
   `org.opencontainers.image.source`, `.version=<tag>`, `.revision=<sha>`,
   `.licenses=AGPL-3.0-or-later`.
9. **Auditoria da imagem**: passo pós-build falha se `/app/api/ee` existir na imagem.

### Condições de falha (todas bloqueiam a release inteira)

| Condição | Efeito |
|----------|--------|
| `ee/` presente na tag, no tarball ou na imagem | Release abortada (FR-008) |
| gitleaks encontra segredo | Release abortada antes de qualquer publicação (SC-003) |
| Tarball não gerado / conteúdo obrigatório ausente | Release abortada (FR-004) |
| Versão do código ≠ tag | Release abortada (FR-005) |
| Falha ao anexar tarball/checksums à Release | Jobs de imagem não executam — nenhuma implantação sem fonte publicada |

## Contrato 2 — Link e endpoint de fonte

### Endpoint (API — fonte da verdade da versão)

`GET /api/v1/instance/info` (`apps/api/src/routers/instance.py`; registro em
`apps/api/src/router.py:359`). Público, sem autenticação, cacheado (comportamento atual
preservado).

**Mudança**: acrescentar o campo `version` à resposta existente:

```json
{
  "mode": "oss",
  "tenancy": "single",
  "multi_org_enabled": false,
  "default_org_slug": "default",
  "frontend_domain": "...",
  "top_domain": "...",
  "version": "1.3.4"
}
```

- `version` é lida dos metadados do pacote da API (`apps/api/pyproject.toml`, a mesma string
  já passada a `FastAPI(version=...)` em `apps/api/app.py:74`).
- Contrato: `version` é exatamente a tag git da release implantada (correlação FR-005).
- Campos existentes não mudam (compatibilidade com consumidores atuais Web/CLI).

### Link na aplicação (Web)

- **Onde aparece**: `CopyrightFooter` e área legal
  (`apps/web/components/Footers/LegalFooters.tsx` + página legal da feature 005) — presentes
  nas superfícies principais; qualquer página alcança o link em ≤ 2 cliques (SC-002).
- **Texto**: "Código-fonte (AGPL-3.0)" (traduzível via `apps/web/locales/*.json`).
- **Destino**: `https://github.com/<org-fork>/<repo>/releases/tag/<version>` com `<version>`
  vinda de `GET /api/v1/instance/info`. A página da release contém o tarball de fonte, os
  checksums e a tag navegável — código completo da versão em execução, sem custo.
- **Fallback**: se `version` indisponível no momento da renderização, o link aponta para
  `https://github.com/<org-fork>/<repo>/releases` (nunca desaparece; FR-001 exige link
  permanente).
- **Rollback**: a instância revertida reporta a versão antiga em `/instance/info`; a fonte
  daquela release permanece publicada — o link volta a apontar para ela automaticamente.

## Contrato 3 — Checklist de auditoria de conformidade pré-release

Executada antes de cada release maior (SC-005); itens automatizados rodam em toda release.

| # | Verificação | Como | Automatizada? |
|---|-------------|------|---------------|
| 1 | `LICENSE` AGPL-3.0 íntegra na raiz | passo 4 do job + diff contra texto oficial | Sim |
| 2 | Avisos de copyright do upstream preservados | inspeção de cabeçalhos/arquivos de aviso alterados no diff da release | Manual (release maior) |
| 3 | Histórico de modificações identificável | tags e commits do fork íntegros (`fetch-depth: 0`) | Sim |
| 4 | Declaração de independência presente no `README.md` e na área legal | grep no README + verificação visual da área legal | Parcial |
| 5 | Ausência de código Enterprise (`ee/`) no repo, tarball e imagem | passos 2 e 9 do job | Sim |
| 6 | Nenhum segredo no pacote | gitleaks (passo 5) | Sim |
| 7 | Link "Código-fonte" visível e apontando para a versão correta | teste de UI / verificação em homologação (quickstart) | Parcial |
| 8 | Labels OCI presentes na imagem publicada | `docker inspect` no pipeline | Sim |
| 9 | Pacote reconstruível seguindo apenas as instruções incluídas | exercício periódico do quickstart (SC-004) | Manual |
| 10 | Sem uso promocional de nome/logo LearnHouse | auditoria de rebranding (feature 005) | Parcial |

Falha em item automatizado bloqueia a release. Falha em item manual bloqueia release maior
até resolução registrada.
