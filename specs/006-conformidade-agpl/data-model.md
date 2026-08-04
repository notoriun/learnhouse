# Data Model: Conformidade AGPL e Oferta de Código-Fonte

**Feature**: `006-conformidade-agpl` | **Date**: 2026-08-03

**Sem entidades de banco de dados. Sem migração Alembic.** Os "dados" desta feature são
artefatos de release e textos legais, versionados em git e publicados via GitHub Releases e
registry de imagens. (Princípio III: nada a migrar; nenhum modelo SQLModel é alterado.)

## Artefato 1 — Release

Uma versão publicada do produto. Identidade canônica: a tag git numérica.

| Atributo | Origem | Exemplo / Regra |
|----------|--------|-----------------|
| Versão | Tag git (`[0-9]*`, gatilho de `.github/workflows/release.yaml`) | `1.3.4` — igual em `apps/api/pyproject.toml`, `apps/api/app.py` e `apps/web/package.json` |
| Data | Timestamp da GitHub Release | automático |
| Artefatos de implantação | Imagem `ghcr.io/<org-fork>/app:<versão>` (multi-arch) | labels OCI `source`, `version`, `revision`, `licenses` obrigatórios |
| Pacote de fonte | Anexo da GitHub Release | `source-<versão>.tar.gz` + `SHA256SUMS` — obrigatório; release sem ele é inválida |
| Versão exposta | Campo `version` de `GET /api/v1/instance/info` | DEVE ser idêntico à tag da release implantada |

**Invariante (FR-004, FR-005)**: não existe release publicada sem pacote de fonte anexado e
validado; a string de versão correlaciona 1:1 tag ↔ imagem ↔ instância ↔ pacote.

## Artefato 2 — Pacote de Fonte Correspondente

Gerado por `git archive <tag>` no job de release (`scripts/package-source.sh`).

**Conteúdo obrigatório** (FR-003, FR-006):
- Código completo da tag: `apps/web`, `apps/api`, `apps/collab`, `apps/cli` e raiz.
- Scripts de geração/instalação/execução já versionados: `Dockerfile`, arquivos de compose /
  CLI `learnhouse`, `apps/api/pyproject.toml` + `uv.lock`, `apps/web/package.json` +
  `bun.lock` (dependências fixadas — a fonte correspondente é reproduzível).
- `LICENSE` (AGPL-3.0 íntegra) e avisos de licença de terceiros presentes no repo.
- `README.md` com a declaração de independência e instruções de build.

**Exclusões obrigatórias**:
- Qualquer segredo operacional (chaves, tokens, senhas, config de produção) — garantido por
  `git archive` (só conteúdo versionado) + varredura gitleaks bloqueante (SC-003).
- Diretório `ee/` (módulo Enterprise) — auditoria bloqueante; hoje o repo público não o
  contém e o pacote prova isso a cada release (FR-008).
- Artefatos de build, caches e diretórios não versionados (excluídos por definição do
  `git archive`).

**Validações que bloqueiam a publicação**: tarball gerado; `LICENSE` presente na raiz do
tarball; `ee/` ausente; gitleaks sem findings; `SHA256SUMS` gerado e anexado.

## Artefato 3 — Declaração de Atribuição

Conjunto de textos legais (FR-006, FR-007). Conteúdo definido por esta feature; superfície
visual da área legal entregue pela feature `005-rebranding-visual`.

| Texto | Localização | Regra |
|-------|-------------|-------|
| Licença AGPL-3.0 | `LICENSE` (raiz) | preservada íntegra, sem alterações |
| Avisos de copyright do projeto original | Cabeçalhos/arquivos existentes + histórico git | preservados; histórico de modificações identificável via commits/tags do fork |
| Atribuição ao projeto de origem | `README.md` do fork | "baseado no LearnHouse (AGPL-3.0)", com link ao upstream, **sem** uso promocional de nome/logo |
| Declaração de independência | `README.md` + área legal da aplicação | "produto independente, não afiliado e não patrocinado pela LearnHouse, Inc." |
| Link "Código-fonte" | `apps/web/components/Footers/LegalFooters.tsx` + área legal | aponta para a release/tag da versão em execução (via campo `version` da API) |
| Referência de fonte nas imagens | Labels OCI nos workflows de build | `org.opencontainers.image.source` + `version` + `licenses` |

**Sem migração**: nenhum destes artefatos toca PostgreSQL, Redis ou modelos SQLModel. A única
mudança de código na API é um campo somente-leitura em endpoint público existente, coberto por
teste (`apps/api/src/tests/routers/test_instance_router.py`).
