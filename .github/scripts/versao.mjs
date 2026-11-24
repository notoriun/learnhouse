#!/usr/bin/env node
// Decide se a versão do app deve ser publicada (sem dependências).
//
// Uso:
//   node .github/scripts/versao.mjs --arquivo apps/server-rust/Cargo.toml \
//        [--aceitar-sem-v] [--tags "v0.1.0 v0.2.0 core-v1.0.0"] [--forcar] [--github-output]
//        [--remoto origin [--sha SHA [--branch BRANCH]]]
//
// - Versão atual: `version` de [workspace.package]/[package] (Cargo.toml) ou
//   "version" de package.json.
// - Última publicada: MAIOR tag `vX.Y.Z` (semver, não texto). Tags com outros
//   prefixos (core-v*, cli-*) e tags de pré-lançamento são ignoradas.
// - Tags com zero à esquerda (v01.0.0) são ignoradas.
// - Sem --tags, lê as tags do remoto (`git ls-remote`, com --remoto) ou as locais (`git tag -l 'v*'`,
//   que aborta em clone raso).
// - Falha fechada: erro do git (fora de repositório, remoto inacessível) e clone raso NÃO viram "sem tag";
//   só a ausência de tags casando é "sem tag" (ultima vazia). Saída 3.
// - Com --sha (a decisão roda dentro da fila): recusa (saída 4) se --branch não está mais nesse SHA no remoto
//   (run velha) ou se a tag vX.Y.Z já existe no remoto em outro SHA (sem --forcar); no mesmo SHA, não publica.
// - Pré-lançamento (1.2.0-rc.1) nunca publica sem --forcar.
// Saída (stdout `chave=valor`; com --github-output também em $GITHUB_OUTPUT):
//   versao, ultima, publicar (true|false), criar_tag (true|false), motivo
import { readFileSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
const NUM = '(?:0|[1-9]\\d*)'
const tagFinal = (semV) => new RegExp(`^${semV ? 'v?' : 'v'}(${NUM}\\.${NUM}\\.${NUM})$`)
let TAG_FINAL = tagFinal(false)
let ACEITA_SEM_V = false

// Repositórios que já publicam tags numéricas sem `v` (ex. 1.3.4) usam --aceitar-sem-v.
export function aceitarSemV(ligado) {
  ACEITA_SEM_V = ligado
  TAG_FINAL = tagFinal(ligado)
}

// Padrões de tag do canal: vX.Y.Z e, com --aceitar-sem-v, também X.Y.Z.
const padroesTag = () => (ACEITA_SEM_V ? ['v*', '[0-9]*'] : ['v*'])

export class ErroGit extends Error {}
export class Recusa extends Error {}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    throw new ErroGit(`git ${args.join(' ')} falhou: ${String(e.stderr || e.message).trim()}`)
  }
}

// Tags locais; erro do git e clone raso falham (não viram lista vazia).
export function tagsLocais() {
  const raso = git(['rev-parse', '--is-shallow-repository']).trim()
  if (raso !== 'true' && raso !== 'false') throw new ErroGit(`git não informou se o clone é raso: "${raso}"`)
  if (raso === 'true') throw new ErroGit('clone raso: sem as tags completas a última versão publicada não é confiável')
  return git(['tag', '-l', ...padroesTag()]).split('\n').filter(Boolean)
}

// SHA por ref no remoto (tag anotada: o commit apontado, não o objeto da tag).
function refsRemotas(remoto, padroes) {
  const m = new Map()
  for (const linha of git(['ls-remote', remoto, ...padroes]).split('\n').filter(Boolean)) {
    const [sha, nome] = linha.split('\t')
    m.set(nome, sha)
  }
  return m
}

export function tagsRemotas(remoto) {
  return [...refsRemotas(remoto, padroesTag().map((p) => `refs/tags/${p}`)).keys()]
    .filter((n) => !n.endsWith('^{}')).map((n) => n.slice('refs/tags/'.length))
}

export function refRemota(ref, remoto) {
  const m = refsRemotas(remoto, [ref, `${ref}^{}`])
  return m.get(`${ref}^{}`) || m.get(ref) || null
}

// Confere, dentro da fila, que publicar ainda vale: recusa run velha e tag em outro SHA.
export function conferirRemoto(r, { sha, branch, remoto, forcar = false }) {
  const out = { ...r, sha }
  if (!out.publicar) return out
  if (branch) {
    const ponta = refRemota(`refs/heads/${branch}`, remoto)
    if (ponta === null) throw new ErroGit(`a branch ${branch} não existe no remoto ${remoto}`)
    if (ponta !== sha) throw new Recusa(`o commit ${sha} não é a ponta atual de ${branch} (${ponta}); a run da ponta publica`)
  }
  if (out.criar_tag) {
    // vX.Y.Z (criada por este workflow) e, com --aceitar-sem-v, X.Y.Z (criada à mão para o release.yaml)
    const nomes = ACEITA_SEM_V ? [`v${out.versao}`, out.versao] : [`v${out.versao}`]
    for (const tag of nomes) {
      const existente = refRemota(`refs/tags/${tag}`, remoto)
      if (existente === sha) {
        return { ...out, publicar: false, criar_tag: false, motivo: `a tag ${tag} já existe no remoto neste commit; nada a fazer` }
      }
      if (existente !== null && !forcar) {
        throw new Recusa(`a tag ${tag} já existe no remoto em ${existente}, não em ${sha}; a imagem publicada é imutável`)
      }
    }
  }
  return out
}

export function parseSemver(texto) {
  const m = SEMVER.exec(String(texto).trim())
  if (!m) return null
  return {
    major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]),
    pre: m[4] ? m[4].split('.') : [],
  }
}

function cmpIdent(a, b) {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b)
  if (na && nb) return Math.sign(Number(a) - Number(b))
  if (na) return -1
  if (nb) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

// Comparação semver 2.0: pré-lançamento < versão final.
export function comparar(a, b) {
  for (const k of ['major', 'minor', 'patch']) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1
  }
  if (!a.pre.length && !b.pre.length) return 0
  if (!a.pre.length) return 1
  if (!b.pre.length) return -1
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined) return -1
    if (b.pre[i] === undefined) return 1
    const c = cmpIdent(a.pre[i], b.pre[i])
    if (c) return c
  }
  return 0
}

export function ultimaTag(tags) {
  let melhor = null
  for (const t of tags) {
    const m = TAG_FINAL.exec(t.trim())
    if (!m) continue
    const v = parseSemver(m[1])
    if (!melhor || comparar(v, melhor.v) > 0) melhor = { tag: t.trim(), texto: m[1], v }
  }
  return melhor
}

export function lerVersao(caminho) {
  const conteudo = readFileSync(caminho, 'utf8')
  if (caminho.endsWith('.json')) return JSON.parse(conteudo).version
  // Cargo.toml: primeira `version = "..."` dentro de [workspace.package] ou [package].
  let secao = ''
  for (const linha of conteudo.split(/\r?\n/)) {
    const s = /^\s*\[([^\]]+)\]\s*$/.exec(linha)
    if (s) { secao = s[1]; continue }
    if (secao === 'workspace.package' || secao === 'package') {
      const v = /^\s*version\s*=\s*"([^"]+)"/.exec(linha)
      if (v) return v[1]
    }
  }
  return undefined
}

export function decidir({ versao, tags, forcar = false }) {
  const atual = parseSemver(versao ?? '')
  if (!atual) {
    return { versao, ultima: '', publicar: false, criar_tag: false, erro: true,
      motivo: `versão inválida ou ausente: "${versao ?? ''}"` }
  }
  const ultima = ultimaTag(tags)
  const base = { versao, ultima: ultima ? ultima.tag : '' }
  const preLanc = atual.pre.length > 0
  if (forcar) {
    // Tag só para versão final e inexistente (a verificação de existência é do workflow).
    return { ...base, publicar: true, criar_tag: !preLanc,
      motivo: 'publicação forçada (forcar=true): comparação de versão ignorada' }
  }
  if (preLanc) {
    return { ...base, publicar: false, criar_tag: false,
      motivo: `versão ${versao} é pré-lançamento; não publica sem forcar` }
  }
  if (!ultima) {
    return { ...base, publicar: true, criar_tag: true,
      motivo: `nenhuma tag vX.Y.Z anterior; publica a versão ${versao}` }
  }
  if (comparar(atual, ultima.v) > 0) {
    return { ...base, publicar: true, criar_tag: true,
      motivo: `versão ${versao} maior que a última publicada (${ultima.tag})` }
  }
  return { ...base, publicar: false, criar_tag: false,
    motivo: `versão ${versao} já publicada; nada a fazer (última: ${ultima.tag})` }
}

function principal(argv) {
  const opt = { forcar: false, githubOutput: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--arquivo') opt.arquivo = argv[++i]
    else if (argv[i] === '--tags') opt.tags = argv[++i]
    else if (argv[i] === '--remoto') opt.remoto = argv[++i]
    else if (argv[i] === '--sha') opt.sha = argv[++i]
    else if (argv[i] === '--branch') opt.branch = argv[++i]
    else if (argv[i] === '--aceitar-sem-v') aceitarSemV(true)
    else if (argv[i] === '--forcar') opt.forcar = true
    else if (argv[i] === '--github-output') opt.githubOutput = true
  }
  if (!opt.arquivo) { console.error('uso: versao.mjs --arquivo <Cargo.toml|package.json> [--tags "..."] [--aceitar-sem-v] [--forcar] [--github-output] [--remoto origin [--sha SHA [--branch BRANCH]]]'); return 2 }
  if (opt.sha && !opt.remoto) { console.error('--sha exige --remoto'); return 2 }
  let r
  try {
    const tags = opt.tags !== undefined
      ? opt.tags.split(/\s+/).filter(Boolean)
      : opt.remoto ? tagsRemotas(opt.remoto) : tagsLocais()
    r = decidir({ versao: lerVersao(opt.arquivo), tags, forcar: opt.forcar })
    if (opt.sha && !r.erro) r = conferirRemoto(r, { sha: opt.sha, branch: opt.branch, remoto: opt.remoto, forcar: opt.forcar })
  } catch (e) {
    if (e instanceof ErroGit) { console.error(`::error::${e.message}`); return 3 }
    if (e instanceof Recusa) { console.error(`::error::${e.message}`); return 4 }
    throw e
  }
  const linhas = Object.entries(r).filter(([k]) => k !== 'erro').map(([k, v]) => `${k}=${v}`)
  console.log(linhas.join('\n'))
  if (opt.githubOutput && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, linhas.join('\n') + '\n')
  return r.erro ? 1 : 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(principal(process.argv.slice(2)))
}
