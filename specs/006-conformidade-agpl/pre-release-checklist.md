# Checklist de Conformidade AGPL Pré-Release (feature 006)

Operacionaliza o Contrato 3 de `contracts/release-source.md`. **Não substitui
parecer jurídico** (nota do plan.md).

## Automatizado (roda no pipeline `release.yaml` a cada tag `[0-9]*`)

| # | Item | Onde |
|---|------|------|
| 1 | Pacote de fonte gerado e anexado à Release antes de qualquer imagem | job `source-package` |
| 3 | Versão do pacote idêntica à tag | `scripts/package-source.sh` (guard de versão) |
| 5 | Varredura de segredos (gitleaks) sobre o conteúdo do pacote | embutida em `package-source.sh` |
| 6 | Ausência de `ee/` na fonte | `package-source.sh` (auditoria Enterprise) |
| 8 | Ausência de `/app/api/ee` na imagem publicada | step "Auditoria Enterprise da imagem" |
| — | Labels OCI (source/version/revision/licenses) na imagem | `build` job |
| — | Link "Código-fonte (AGPL-3.0)" na versão em execução | rodapé + `GET /instance/info` |
| — | Zero marca residual (feature 005) | job `brand-audit` (gate) |

## Manual (registrar responsável + momento antes de cada release maior)

| # | Item | Responsável |
|---|------|-------------|
| 2 | Avisos de copyright do upstream preservados nos arquivos alterados | Eng./Jurídico |
| 4 | Instruções de build/install/run acompanham o pacote (README, Dockerfile) | Eng. |
| 7 | Declaração de independência presente no README e na área legal `/legal` | Eng./Jurídico |
| 9 | Reconstrução da versão a partir SÓ das instruções incluídas (SC-004) | Eng. (revisor externo à implementação, quando possível) |
| 10 | Parecer jurídico sobre marca/licença antes do go-live | Jurídico |

## LICENSE

- `LICENSE` na raiz é a AGPL-3.0 oficial (verificado: cabeçalho "GNU AFFERO
  GENERAL PUBLIC LICENSE", 662 linhas). Não editar.
