#!/usr/bin/env bash
# Empacota a fonte correspondente de uma release (feature 006 — AGPL-3.0).
#
# Uso: scripts/package-source.sh <tag>
#
# Gera source-<tag>.tar.gz + SHA256SUMS, valida o conteúdo e roda a varredura
# de segredos (gitleaks) EMBUTIDA — assim a via local de emergência (hotfix
# com CI indisponível) executa exatamente as mesmas verificações por
# construção. Falha (exit != 0) impede qualquer publicação.
#
# Pré-requisitos: git; e o binário `gitleaks` no PATH.

set -euo pipefail

TAG="${1:?uso: package-source.sh <tag>}"
OUT="source-${TAG}.tar.gz"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> Empacotando a fonte da tag ${TAG}"
git archive --format=tar.gz -o "$OUT" "$TAG"

echo "==> Gerando checksums"
sha256sum "$OUT" > SHA256SUMS

echo "==> Extraindo para validação"
tar -xzf "$OUT" -C "$WORKDIR"

fail() { echo "ERRO: $1" >&2; exit 1; }

echo "==> Validando conteúdo obrigatório"
for f in LICENSE Dockerfile apps/api/pyproject.toml apps/web/package.json; do
  [ -f "$WORKDIR/$f" ] || fail "arquivo obrigatório ausente no pacote: $f"
done

echo "==> Conferindo versão do pacote == tag"
PKG_VERSION="$(grep -E '^version *= *"' "$WORKDIR/apps/api/pyproject.toml" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
# A tag pode ter prefixo 'v'; normaliza para comparar.
NORM_TAG="${TAG#v}"
[ "$PKG_VERSION" = "$NORM_TAG" ] || fail "versão do pacote ($PKG_VERSION) != tag ($NORM_TAG)"

echo "==> Auditoria Enterprise: a pasta ee/ NÃO pode existir na fonte (FR-008)"
[ -d "$WORKDIR/ee" ] && fail "diretório ee/ presente no pacote de fonte (código Enterprise não pode ser distribuído)"
[ -d "$WORKDIR/apps/api/ee" ] && fail "diretório apps/api/ee/ presente no pacote de fonte"

echo "==> Varredura de segredos (gitleaks) sobre o conteúdo do pacote"
command -v gitleaks >/dev/null 2>&1 || fail "gitleaks não encontrado no PATH (pré-requisito da via local)"
CONFIG_ARG=()
[ -f "$WORKDIR/.gitleaks.toml" ] && CONFIG_ARG=(--config "$WORKDIR/.gitleaks.toml")
gitleaks detect --source "$WORKDIR" --no-git "${CONFIG_ARG[@]}" --redact \
  || fail "gitleaks encontrou segredos no pacote de fonte — publicação abortada"

echo "==> OK: ${OUT} + SHA256SUMS prontos e validados"
