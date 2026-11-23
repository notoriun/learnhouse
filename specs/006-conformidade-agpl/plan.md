# Implementation Plan: Conformidade AGPL e Oferta de Código-Fonte

**Branch**: `006-conformidade-agpl` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

**Input**: Especificação da feature em `/specs/006-conformidade-agpl/spec.md`

**Nota**: Este plano orienta o trabalho técnico e **não substitui parecer jurídico**. A operação
comercial validará o modelo final com profissional especializado em software livre e marcas
(seção 11 do documento-base).

## Summary

Cumprir as obrigações da AGPL-3.0 no fork: (1) link visível e permanente "Código-fonte" /
"Licença" em até 2 cliques de qualquer página, apontando para a fonte da exata versão em
execução; (2) cada release (incluindo hotfix) gera e publica automaticamente o pacote de fonte
correspondente — `git archive` da tag, com scripts de build/install/run já presentes no repo,
checksums e varredura de segredos que falha a publicação; (3) correlação inequívoca versão em
execução ↔ pacote, expondo a versão no endpoint público `GET /api/v1/instance/info`;
(4) LICENSE, avisos e histórico preservados, declaração de independência no README e na área
legal; (5) imagens Docker com labels OCI apontando para a fonte; (6) auditoria automatizada de
ausência de código Enterprise no pacote e na imagem.

Abordagem: estender o workflow de release existente (`.github/workflows/release.yaml`, gatilho
por tag `[0-9]*`) com um job de empacotamento/validação de fonte; adicionar campo `version` ao
endpoint de instância já existente; adicionar o link no rodapé legal existente
(`apps/web/components/Footers/LegalFooters.tsx`). Sem banco, sem migração.

## Technical Context

**Language/Version**: Python 3.14 (FastAPI, `apps/api`), TypeScript/Next.js (`apps/web`), YAML (GitHub Actions), shell

**Primary Dependencies**: GitHub Actions (CI/CD existente), `git archive` (empacotamento), gitleaks (varredura de segredos — novo, roda só no CI), Docker/buildx (imagens já construídas por `release.yaml` e `build-community.yaml`)

**Storage**: N/A — nenhuma entidade de banco; artefatos vivem em tags git, GitHub Releases e labels OCI

**Testing**: pytest (`apps/api/src/tests/routers/test_instance_router.py` já existe — estender para o campo `version`); validação do pipeline por release em ambiente de teste (quickstart.md); checklist de auditoria pré-release (contracts/)

**Target Platform**: GitHub (repositório público do fork + Releases), ghcr.io (imagens), instâncias Docker self-hosted

**Project Type**: Monorepo web (apps/web + apps/api) + automação CI/CD

**Performance Goals**: N/A — job de release adiciona minutos ao pipeline, sem impacto em runtime; endpoint `/instance/info` já é cacheado

**Constraints**: zero segredos operacionais no pacote publicado (verificação automatizada bloqueante); nenhuma via de release pode contornar a geração da fonte; fork sem módulo Enterprise; mudanças mínimas em arquivos centrais para não criar conflitos com upstream (documento-base 12.1)

**Scale/Scope**: 1 workflow estendido, 1 campo em endpoint existente, 1 link em componente de rodapé existente, textos de atribuição em README/área legal, 1 checklist de auditoria

## Constitution Check

*GATE: aprovado antes da Fase 0; reavaliado após a Fase 1.*

| Princípio | Avaliação | Situação |
|-----------|-----------|----------|
| **I. Fronteiras entre Apps São Contratos** | O único contrato entre apps é o campo `version` adicionado à resposta de `GET /api/v1/instance/info` (endpoint público já consumido pelo Web). Definido em `contracts/release-source.md` antes da implementação. Nenhum acesso direto a banco/Redis fora da API. | PASS |
| **II. Backend API-First** | A versão em execução é informada pela API (`apps/api/src/routers/instance.py`), fonte única da verdade — o rodapé do Web apenas renderiza o link montado a partir dela. Nenhuma regra duplicada no cliente. | PASS |
| **III. Mudanças de Schema Exigem Migrações e Testes** | **Sem mudança de schema** — nenhuma migração Alembic. A mudança de comportamento da API (campo `version` em `/instance/info`) atualiza o teste existente `apps/api/src/tests/routers/test_instance_router.py`. | PASS |
| **IV. Segurança Multi-Tenant É Inegociável** | Endpoint `/instance/info` já é público por design e não expõe dados de organização além do que já expõe. A varredura de segredos no pipeline *reduz* superfície de vazamento. Nenhuma verificação de autorização é relaxada. | PASS |
| **V. Simplicidade e Reúso Primeiro** | Reúso máximo: workflow de release existente (novo job, não novo pipeline), tag git como identidade da release (já é o gatilho), rodapé legal existente, endpoint existente. Única dependência nova: gitleaks, restrita ao CI. **Separação OSS/Enterprise**: o repo público **não contém** o módulo Enterprise — apenas pontos de extensão sob AGPL (`apps/api/src/core/ee_hooks.py`, `apps/api/src/core/deployment_mode.py`, gates de UI como `apps/web/components/Dashboard/Shared/FeatureGate/FeatureGate.tsx`). O fork **mantém esses hooks intactos** (são AGPL, publicados pelo próprio upstream, e removê-los criaria conflitos permanentes de merge) e **nunca fornece a pasta `ee/`**: a auditoria de release falha se `ee/` existir no pacote ou na imagem, e os builds usam `LEARNHOUSE_PUBLIC=true` (que remove `/app/api/ee` — `Dockerfile:99`), como o CI já faz hoje. O núcleo OSS permanece plenamente funcional (`get_deployment_mode()` → `'oss'` quando `ee/` ausente). | PASS |

**Idioma Oficial**: todos os artefatos desta feature em pt-BR. PASS.

Reavaliação pós-Fase 1: nenhum desvio introduzido pelo design. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/006-conformidade-agpl/
├── plan.md              # Este arquivo
├── research.md          # Fase 0 — decisões e alternativas
├── data-model.md        # Fase 1 — artefatos (sem entidades de banco)
├── quickstart.md        # Fase 1 — validação ponta a ponta
├── contracts/
│   └── release-source.md  # Contratos do processo de release e do link/endpoint
└── tasks.md             # Fase 2 (/speckit-tasks — não criado pelo plan)
```

### Source Code (repository root)

```text
.github/workflows/
├── release.yaml                  # EXISTENTE — gatilho: push de tag [0-9]*; ganha o job
│                                 #   "source-package": auditoria EE → git archive →
│                                 #   gitleaks → checksums → anexar à GitHub Release;
│                                 #   jobs de imagem passam a depender dele e recebem
│                                 #   labels OCI (source/version/licenses)
├── build-community.yaml          # EXISTENTE — builds por branch; recebe labels OCI
└── (api-tests.yaml, api-lint.yaml, web-lint.yaml, e2e.yaml, cli-*.yaml, notify-infra.yaml)

scripts/
└── package-source.sh             # NOVO — git archive da tag + SHA256SUMS + validações
                                  #   (LICENSE presente, ee/ ausente); chamado pelo workflow
                                  #   e executável localmente para hotfix de emergência

apps/api/
├── app.py                        # EXISTENTE — FastAPI(version="1.3.4") (linha 74)
├── pyproject.toml                # EXISTENTE — version = "1.3.4" (fonte da versão)
└── src/
    ├── routers/instance.py       # ESTENDIDO — campo "version" na resposta de GET /info
    └── tests/routers/test_instance_router.py  # ESTENDIDO — cobre o campo version

apps/web/
├── package.json                  # EXISTENTE — "version": "1.3.4" (mantida em sincronia)
├── components/Footers/LegalFooters.tsx  # ESTENDIDO — link "Código-fonte" (AGPL-3.0)
│                                 #   ao lado de Terms/Privacy no CopyrightFooter e na
│                                 #   área legal (conteúdo definido aqui; superfície
│                                 #   visual junto com a feature 005-rebranding-visual)
└── locales/*.json                # ESTENDIDO — chave de tradução do link

README.md                         # ESTENDIDO — seção de licença com declaração de
                                  #   independência (não afiliado à LearnHouse, Inc.)
LICENSE                           # PRESERVADO — AGPL-3.0 intacta
Dockerfile                        # EXISTENTE — remove ee/ quando LEARNHOUSE_PUBLIC=true
```

**Structure Decision**: monorepo existente; nenhum diretório novo além de `scripts/`. O grosso
da feature vive no CI (`.github/workflows/release.yaml` + `scripts/package-source.sh`); as
mudanças de produto são um campo em endpoint existente e um link em componente existente —
deliberadamente mínimas para não gerar conflitos com o upstream (política 12.2 do
documento-base: cada atualização upstream republica a fonte junto ao deploy pelo mesmo
pipeline, sem passos novos).

## Complexity Tracking

Nenhuma violação da constituição — tabela não aplicável. A única dependência nova (gitleaks)
roda exclusivamente no CI, justificada por SC-003 (zero segredos, verificação automatizada
bloqueante) e pela ausência de qualquer varredura de segredos no CI atual.
