#!/usr/bin/env bash
# Regras de canal do build-community.yaml, em script para poder ser testado (deploy.test.sh):
#   validar  ambiente e ref (push ou dispatch), antes de qualquer decisão ou build
# A decisão de versão e a ponta do branch ficam no versao.mjs (--branch). Aqui: producao só publica a ponta da main
# e desenvolvimento só a ponta da dev; ref livre falha. O nome da tag móvel da imagem (branch=) vem do ambiente
# validado, nunca da ref de quem disparou. Tudo entra por variáveis de ambiente. Falha = saída diferente de zero.
set -euo pipefail

erro() { echo "::error::$*" >&2; exit 1; }
saida() { if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$*" >> "$GITHUB_OUTPUT"; fi; }

cmd_validar() {
  local branch
  case "${AMBIENTE:-}" in
    producao) branch=main ;;
    desenvolvimento) branch=dev ;;
    *) erro "Ambiente inválido: '${AMBIENTE:-}' (use producao ou desenvolvimento)." ;;
  esac
  if [ "${REF:-}" != "$branch" ]; then
    erro "O ambiente $AMBIENTE só publica a ponta de $branch; ref '${REF:-}' não é aceita."
  fi
  saida "branch=$branch"
  saida "ambiente=$AMBIENTE"
}

case "${1:-}" in
  validar) cmd_validar ;;
  *) echo "uso: deploy.sh validar" >&2; exit 2 ;;
esac
