# Quickstart: Validação da Conformidade AGPL

**Feature**: `006-conformidade-agpl` | **Date**: 2026-08-03

Roteiro de validação ponta a ponta dos critérios SC-001..SC-005. Pré-requisitos: fork do
repositório com o workflow estendido, Docker, `gh` CLI.

## 1. Simular uma release em ambiente de teste (SC-001)

```bash
# Em um fork/repositório de teste, crie uma tag numérica de ensaio
git tag 0.0.1-test && git push origin 0.0.1-test   # ajuste o padrão do gatilho no teste, se necessário
gh run watch                                        # acompanhar o workflow Release
```

**Esperado**: o job `source-package` roda antes dos jobs de imagem; a GitHub Release da tag
contém `source-0.0.1-test.tar.gz` e `SHA256SUMS`; a imagem só é publicada após o sucesso do
empacotamento.

**Teste negativo (FR-004)**: introduza uma falha (ex.: crie um diretório `ee/` com um arquivo,
ou um arquivo com um padrão de segredo fake tipo `AKIA...`) em uma tag de ensaio e confirme
que **nenhum artefato é publicado** e o erro do log é claro.

## 2. Verificar o pacote gerado, publicado e validado (SC-003, FR-003)

```bash
gh release download 0.0.1-test -p 'source-*' -p 'SHA256SUMS'
sha256sum -c SHA256SUMS                    # checksum confere
tar -tzf source-0.0.1-test.tar.gz | head   # conteúdo completo
tar -tzf source-0.0.1-test.tar.gz | grep -E '^(LICENSE|Dockerfile)$'   # presentes
tar -tzf source-0.0.1-test.tar.gz | grep -E '(^|/)ee/' && echo FALHA || echo "sem ee/ — OK"
mkdir src && tar -xzf source-0.0.1-test.tar.gz -C src
gitleaks dir src/                           # reconfirma a varredura já embutida em scripts/package-source.sh: zero findings
```

## 3. Seguir o link da aplicação até a fonte (SC-002, FR-001, FR-005)

1. Suba a instância de teste com a imagem da release.
2. `curl -s https://<instancia>/api/v1/instance/info | jq .version` → deve ser `0.0.1-test`
   (idêntico à tag).
3. No navegador, a partir de qualquer página (home, curso, login), localize o link
   "Código-fonte" no rodapé/área legal em **no máximo 2 cliques**.
4. O link leva à página da release da tag reportada pela API — mesma versão, tarball
   disponível sem autenticação e sem custo.
5. **Rollback**: aponte a instância para a imagem da release anterior e confirme que
   `version` e o link passam a refletir a versão antiga, cuja fonte permanece publicada.

## 4. Reconstruir a versão só com as instruções incluídas (SC-004, FR-009)

Em uma máquina limpa (apenas Docker instalado), usando **somente** o conteúdo do pacote:

```bash
tar -xzf source-0.0.1-test.tar.gz -C build && cd build
# Siga o README.md incluído no pacote (build via Dockerfile):
docker build --build-arg LEARNHOUSE_PUBLIC=true -t fork-app:local .
# Suba conforme as instruções de execução incluídas (compose/CLI do pacote)
```

**Esperado**: build conclui sem baixar nada além das dependências fixadas pelos lockfiles
(`uv.lock`, `bun.lock`); a aplicação sobe e reporta a mesma versão. Nenhuma consulta a
documentação externa foi necessária.

Verifique também as labels da imagem oficial:

```bash
docker inspect ghcr.io/<org-fork>/app:0.0.1-test \
  --format '{{json .Config.Labels}}' | jq
# org.opencontainers.image.source, .version, .revision, .licenses presentes
```

## 5. Auditoria de atribuição e Enterprise (SC-005, FR-006..FR-008)

```bash
# Licença íntegra
head -2 LICENSE          # "GNU AFFERO GENERAL PUBLIC LICENSE / Version 3, 19 November 2007"
# Declaração de independência
grep -i "não afiliado" README.md
# Sem módulo Enterprise
test -d ee && echo FALHA || echo "sem ee/ — OK"
docker run --rm ghcr.io/<org-fork>/app:0.0.1-test sh -c 'test -d /app/api/ee && echo FALHA || echo OK'
```

Na aplicação: área legal exibe a declaração de independência ("independente, não afiliado e
não patrocinado pela LearnHouse, Inc.") e a atribuição ao projeto de origem, sem logo/nome
LearnHouse em uso promocional.

Percorra a checklist completa em `contracts/release-source.md` (Contrato 3) antes de cada
release maior.

## Critério de saída

Todos os passos 1–5 verdes, incluindo o teste negativo do passo 1. Qualquer falha bloqueia a
promoção da release para produção. Este roteiro valida o processo técnico; a aprovação
jurídica final é etapa separada (ver nota no plan.md).
