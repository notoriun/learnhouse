#!/usr/bin/env bash
# Testes do deploy.sh e da ligação dele no docker-publish.yml. Rodam localmente (o CI não roda suítes):
#   bash .github/scripts/deploy.test.sh
# A ponta do branch é do versao.mjs (versao.test.mjs).
set -uo pipefail

AQUI=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$AQUI/deploy.sh"
WORKFLOW="$AQUI/../workflows/build-community.yaml"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ok=0
falhas=0
passou() { ok=$((ok + 1)); }
falhou() { falhas=$((falhas + 1)); echo "FALHOU: $1"; }

# Roda o deploy.sh com o ambiente dado, como o workflow roda (env limpo, bash -eo pipefail); guarda saída e código.
rodar() { # rodar <subcomando> [VAR=valor...]
  local sub=$1; shift
  : > "$TMP/summary"; : > "$TMP/output"
  (cd "${CWD:-$TMP}" && env -i PATH="$TMP/bin:$PATH" HOME="$TMP" GITHUB_STEP_SUMMARY="$TMP/summary" \
    GITHUB_OUTPUT="$TMP/output" CURL_LOG="${CURL_LOG:-}" CURL_FALHA="${CURL_FALHA:-}" ESPERA_SEGUNDOS=0 "$@" bash --noprofile --norc -eo pipefail "$SCRIPT" "$sub") > "$TMP/saida" 2>&1
  RC=$?
}
espera_ok() { rodar "${@:2}"; [ "$RC" -eq 0 ] && passou || { falhou "$1 (rc=$RC)"; sed 's/^/    /' "$TMP/saida"; }; }
espera_falha() { rodar "${@:2}"; [ "$RC" -ne 0 ] && passou || falhou "$1 (deveria falhar)"; }
contem() { grep -q -- "$2" "$1" && passou || falhou "$3 (faltou '$2' em $1)"; }
nao_contem() { grep -q -- "$2" "$1" && falhou "$3 (achou '$2' em $1)" || passou; }

# --- validar: ambiente e ref (push chega com AMBIENTE=producao e REF=main) -----------------------------------------
espera_ok "producao com main" validar AMBIENTE=producao REF=main
contem "$TMP/output" "branch=main" "producao devolve main"
espera_ok "desenvolvimento com dev" validar AMBIENTE=desenvolvimento REF=dev
contem "$TMP/output" "branch=dev" "desenvolvimento devolve dev"
espera_falha "desenvolvimento com main (publicaria a tag móvel main da produção)" validar AMBIENTE=desenvolvimento REF=main
espera_falha "producao com dev" validar AMBIENTE=producao REF=dev
espera_falha "producao com ref livre" validar AMBIENTE=producao REF=feature/x
espera_falha "desenvolvimento com ref livre" validar AMBIENTE=desenvolvimento REF=feature/x
espera_falha "producao com SHA" validar AMBIENTE=producao REF=0123456789abcdef0123456789abcdef01234567
espera_falha "producao com tag" validar AMBIENTE=producao REF=1.3.4
espera_falha "producao com refs/heads/main" validar AMBIENTE=producao REF=refs/heads/main
espera_falha "producao com ref vazia" validar AMBIENTE=producao REF=
espera_falha "ref com injeção de comando" validar AMBIENTE=producao 'REF=x$(id)'
espera_falha "ambiente inválido" validar AMBIENTE=staging REF=main
espera_falha "ambiente vazio" validar AMBIENTE= REF=main

# --- ligação no workflow --------------------------------------------------------------------------------------------
contem "$WORKFLOW" 'run: bash .github/scripts/deploy.sh validar' "workflow: valida ambiente e ref"
contem "$WORKFLOW" 'REF: ${{ inputs.ref || github.ref_name }}' "workflow: a ref validada é a do dispatch"
contem "$WORKFLOW" 'AMBIENTE: ${{ inputs.ambiente || '"'producao'"' }}' "workflow: push é producao"
contem "$WORKFLOW" '--sha "$SHA" --branch "$BRANCH"' "workflow: a ponta é conferida também no dispatch"
contem "$WORKFLOW" 'BRANCH: ${{ steps.canal.outputs.branch }}' "workflow: o branch vem da validação"
contem "$WORKFLOW" 'branch: ${{ steps.canal.outputs.branch }}' "workflow: a tag móvel da imagem vem do ambiente, não da ref"
nao_contem "$WORKFLOW" 'steps.sha.outputs.branch\|REF_ESCOLHIDA' "workflow: a tag da imagem não vem da ref"
nao_contem "$WORKFLOW" 'EVENTO\|--branch "$REF_NAME"' "workflow: ponta não é mais só no push"
contem "$WORKFLOW" "criar_tag == 'true' && (inputs.ambiente || 'producao') == 'producao'" "workflow: tag vX.Y.Z só em producao"
nome() { grep -n "name: $1" "$WORKFLOW" | head -1 | cut -d: -f1; }
[ "$(nome 'Validar ambiente')" -lt "$(nome 'Comparar versão')" ] && passou || falhou "workflow: validação antes da decisão de versão"

# Repositório público: nenhum run: pode ter ${{ }} (outputs, matrix e inputs entram por env:, nunca no script).
# Vale para todos os workflows (CI e publicação), não só o de deploy.
interpolados=$(python3 -I - "$AQUI"/../workflows/*.y*ml <<'F'
import os, re, sys
for arq in sys.argv[1:]:
    nome = os.path.basename(arq)
    linhas = open(arq, encoding="utf-8").read().split("\n")
    i = 0
    while i < len(linhas):
        m = re.match(r"^(\s*)(?:- )?run:\s*(.*)$", linhas[i])
        if not m:
            i += 1
            continue
        indent, resto = len(m.group(1)), m.group(2)
        if resto[:1] in ("|", ">"):
            j = i + 1
            while j < len(linhas) and (not linhas[j].strip() or len(linhas[j]) - len(linhas[j].lstrip()) > indent):
                if "${{" in linhas[j]:
                    print(f"{nome}:{j + 1}: {linhas[j].strip()}")
                j += 1
            i = j
        else:
            if "${{" in resto:
                print(f"{nome}:{i + 1}: {resto}")
            i += 1
F
)
[ -z "$interpolados" ] && passou || falhou "workflow: \${{ }} dentro de run: ($interpolados)"

echo "$ok ok, $falhas falhas"
[ "$falhas" -eq 0 ]
