// Teste do script de versão: `node --test .github/scripts/versao.test.mjs`
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decidir, ultimaTag, aceitarSemV } from './versao.mjs'

const tags = ['v0.1.0', 'v0.2.0', 'v0.10.0', 'core-v9.9.9', 'cli-1.0.0', 'v1.0.0-rc.1']

test('maior: publica e cria tag', () => {
  const r = decidir({ versao: '0.11.0', tags })
  assert.equal(r.publicar, true); assert.equal(r.criar_tag, true); assert.equal(r.ultima, 'v0.10.0')
})
test('comparação é semver, não texto (0.10.0 > 0.2.0)', () => {
  assert.equal(ultimaTag(tags).tag, 'v0.10.0')
  assert.equal(decidir({ versao: '0.9.0', tags }).publicar, false)
})
test('igual: não publica', () => {
  const r = decidir({ versao: '0.10.0', tags })
  assert.equal(r.publicar, false); assert.match(r.motivo, /já publicada; nada a fazer/)
})
test('menor: não publica', () => {
  assert.equal(decidir({ versao: '0.2.5', tags }).publicar, false)
})
test('pré-lançamento: não publica sem forcar', () => {
  const r = decidir({ versao: '0.11.0-rc.1', tags })
  assert.equal(r.publicar, false); assert.match(r.motivo, /pré-lançamento/)
})
test('pré-lançamento é menor que a final', () => {
  assert.equal(decidir({ versao: '0.10.0-rc.1', tags }).publicar, false)
})
test('pré-lançamento com forcar: publica, sem tag', () => {
  const r = decidir({ versao: '0.11.0-rc.1', tags, forcar: true })
  assert.equal(r.publicar, true); assert.equal(r.criar_tag, false)
})
test('sem tag anterior: publica e cria tag', () => {
  const r = decidir({ versao: '0.2.0', tags: ['core-v1.0.0'] })
  assert.equal(r.publicar, true); assert.equal(r.criar_tag, true); assert.equal(r.ultima, '')
})
test('forcar com versão igual publica', () => {
  assert.equal(decidir({ versao: '0.10.0', tags, forcar: true }).publicar, true)
})
test('versão inválida: erro e não publica', () => {
  const r = decidir({ versao: 'abc', tags })
  assert.equal(r.publicar, false); assert.equal(r.erro, true)
})

test('--aceitar-sem-v: tags numéricas 1.3.4 contam; cli-/core- não', () => {
  aceitarSemV(true)
  try {
    const tg = ['1.3.3', '1.3.4', 'v1.3.0', 'cli-1.5.1', 'core-v9.0.0']
    assert.equal(ultimaTag(tg).tag, '1.3.4')
    assert.equal(decidir({ versao: '1.3.4', tags: tg }).publicar, false)
    assert.equal(decidir({ versao: '1.3.5', tags: tg }).publicar, true)
    assert.equal(ultimaTag(['01.3.4', '1.03.4']), null)
  } finally { aceitarSemV(false) }
})

test('tag com zero à esquerda não conta', () => {
  assert.equal(ultimaTag(['v01.0.0', 'v1.00.0', 'v0.9.0']).tag, 'v0.9.0')
  assert.equal(ultimaTag(['v01.0.0']), null)
})

// --- git de verdade: repositórios temporários, rodando o script como o workflow
// (bash --noprofile --norc -eo pipefail) -----------------------------------------------------------------
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'versao.mjs')
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
Object.assign(ENV, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })

function sh(cmd, cwd, env = ENV) {
  return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', cmd], { cwd, env, encoding: 'utf8' })
}

function repo(versao = '1.0.0') {
  const tmp = mkdtempSync(join(tmpdir(), 'versao-'))
  const origin = join(tmp, 'origin.git')
  const w = join(tmp, 'w')
  sh(`git init -q --bare -b main ${origin} && git clone -q ${origin} ${w}`, tmp)
  const g = (cmd) => {
    const r = sh(cmd, w)
    assert.equal(r.status, 0, r.stderr)
    return r.stdout.trim()
  }
  writeFileSync(join(w, 'Cargo.toml'), `[workspace.package]\nversion = "${versao}"\n`)
  g('git add Cargo.toml')
  const commit = (m) => { g(`git commit -q --allow-empty -m ${m} && git push -q origin HEAD:main`); return g('git rev-parse HEAD') }
  const tag = (n, sha = 'HEAD') => g(`git tag ${n} ${sha} && git push -q origin refs/tags/${n}`)
  const decidirGit = (...args) => {
    const r = sh(`node ${SCRIPT} --arquivo Cargo.toml ${args.join(' ')}`, w)
    const out = Object.fromEntries(r.stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]))
    return { rc: r.status, out, err: r.stderr }
  }
  const limpar = () => rmSync(tmp, { recursive: true, force: true })
  return { tmp, w, g, commit, tag, decidirGit, limpar }
}

function comRepo(versao, fn) {
  const r = repo(versao)
  try { r.commit('um'); return fn(r) } finally { r.limpar() }
}

test('git: sem tag publica', () => comRepo('1.0.0', (r) => {
  for (const modo of ['', '--remoto origin']) {
    const { rc, out } = r.decidirGit(modo)
    assert.equal(rc, 0); assert.equal(out.publicar, 'true'); assert.equal(out.ultima, '')
  }
}))

test('git: só tags de outro prefixo (core-v, dev-v) não contam', () => comRepo('1.0.0', (r) => {
  r.tag('core-v9.0.0'); r.tag('dev-v9.0.0')
  for (const modo of ['', '--remoto origin']) {
    const { out } = r.decidirGit(modo)
    assert.equal(out.publicar, 'true'); assert.equal(out.ultima, '')
  }
}))

test('git: igual, maior e menor', () => {
  for (const [versao, esperado] of [['1.2.0', 'false'], ['1.3.0', 'true'], ['1.1.0', 'false']]) {
    comRepo(versao, (r) => {
      r.tag('v1.2.0')
      for (const modo of ['', '--remoto origin']) assert.equal(r.decidirGit(modo).out.publicar, esperado, `${versao} ${modo}`)
    })
  }
})

test('git: pré-lançamento só com forcar, e sem tag', () => comRepo('1.3.0-rc.1', (r) => {
  r.tag('v1.2.0')
  assert.equal(r.decidirGit('--remoto origin').out.publicar, 'false')
  const f = r.decidirGit('--remoto origin --forcar').out
  assert.equal(f.publicar, 'true'); assert.equal(f.criar_tag, 'false')
}))

test('git: zero à esquerda na tag é ignorado', () => comRepo('1.0.0', (r) => {
  r.tag('v01.0.0'); r.tag('v0.9.0')
  assert.equal(r.decidirGit('--remoto origin').out.ultima, 'v0.9.0')
}))

test('git: erro do git (fora de repositório) falha, não vira "sem tag"', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'versao-fora-'))
  try {
    writeFileSync(join(tmp, 'Cargo.toml'), '[package]\nversion = "1.0.0"\n')
    const env = { ...ENV, GIT_CEILING_DIRECTORIES: dirname(tmp) }
    const r = sh(`node ${SCRIPT} --arquivo Cargo.toml`, tmp, env)
    assert.equal(r.status, 3, r.stderr); assert.doesNotMatch(r.stdout, /publicar=true/)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('git: `git tag` falhando (git falso) falha', () => comRepo('1.0.0', (r) => {
  const bin = join(r.tmp, 'bin'); mkdirSync(bin)
  const real = sh('command -v git', r.tmp).stdout.trim()
  writeFileSync(join(bin, 'git'), `#!/bin/sh\n[ "$1" = tag ] && { echo "fatal: objeto ilegivel" >&2; exit 128; }\nexec ${real} "$@"\n`)
  chmodSync(join(bin, 'git'), 0o755)
  const x = sh(`node ${SCRIPT} --arquivo Cargo.toml`, r.w, { ...ENV, PATH: `${bin}:${ENV.PATH}` })
  assert.equal(x.status, 3, x.stderr); assert.doesNotMatch(x.stdout, /publicar=true/)
}))

test('git: remoto inacessível falha, não vira "sem tag"', () => comRepo('1.0.0', (r) => {
  const { rc, out } = r.decidirGit('--remoto nao-existe')
  assert.equal(rc, 3); assert.equal(out.publicar, undefined)
}))

test('git: clone raso falha no modo local', () => comRepo('1.0.0', (r) => {
  r.commit('dois')
  const raso = join(r.tmp, 'raso')
  sh(`git clone -q --depth 1 file://${join(r.tmp, 'origin.git')} ${raso}`, r.tmp)
  const x = sh(`node ${SCRIPT} --arquivo Cargo.toml`, raso)
  assert.equal(x.status, 3, x.stderr); assert.doesNotMatch(x.stdout, /publicar=true/)
}))

test('git: ponta atual publica e devolve o sha', () => comRepo('1.0.0', (r) => {
  const sha = r.g('git rev-parse HEAD')
  const { rc, out } = r.decidirGit(`--remoto origin --sha ${sha} --branch main`)
  assert.equal(rc, 0); assert.equal(out.publicar, 'true'); assert.equal(out.sha, sha)
}))

test('git: run velha (SHA não é a ponta) falha', () => comRepo('1.0.0', (r) => {
  const velho = r.g('git rev-parse HEAD')
  r.commit('dois')
  const { rc, out, err } = r.decidirGit(`--remoto origin --sha ${velho} --branch main`)
  assert.equal(rc, 4, err); assert.equal(out.publicar, undefined)
  // dispatch com ref explícita: sem --branch, não confere a ponta
  assert.equal(r.decidirGit(`--remoto origin --sha ${velho}`).rc, 0)
}))

test('git: tag existente em outro SHA falha (sem forcar) e segue com forcar', () => comRepo('1.0.0', (r) => {
  const velho = r.g('git rev-parse HEAD')
  r.tag('v1.0.0', velho)
  const novo = r.commit('dois')
  // corrida: a tag chegou ao remoto depois de a lista de tags ser lida (aqui, lista fixa sem ela)
  const { rc, err } = r.decidirGit(`--remoto origin --tags 'v0.0.1' --sha ${novo} --branch main`)
  assert.equal(rc, 4, err)
  const f = r.decidirGit(`--remoto origin --sha ${novo} --branch main --forcar`)
  assert.equal(f.rc, 0); assert.equal(f.out.publicar, 'true')
}))

test('git: tag existente no mesmo SHA não publica', () => comRepo('1.0.0', (r) => {
  const sha = r.g('git rev-parse HEAD')
  r.tag('v1.0.0', sha)
  // tags remotas já trazem v1.0.0: igual -> não publica; e a corrida (tag só no remoto) idem
  const { rc, out } = r.decidirGit(`--remoto origin --sha ${sha} --branch main --forcar`)
  assert.equal(rc, 0); assert.equal(out.publicar, 'false'); assert.equal(out.criar_tag, 'false')
}))

test('git: tag anotada em outro SHA é comparada pelo commit', () => comRepo('1.0.0', (r) => {
  const sha = r.g('git rev-parse HEAD')
  r.g('git tag -a v1.0.0 -m x && git push -q origin refs/tags/v1.0.0')
  const novo = r.commit('dois')
  assert.equal(r.decidirGit(`--remoto origin --sha ${novo} --branch main --forcar`).rc, 0)
  assert.equal(r.decidirGit(`--remoto origin --sha ${sha} --forcar`).out.publicar, 'false')
}))

test('git: --aceitar-sem-v lê tags numéricas (local e remoto) e as ignora sem a flag', () => comRepo('1.3.4', (r) => {
  r.tag('1.3.4')
  for (const modo of ['', '--remoto origin']) {
    assert.equal(r.decidirGit(`--aceitar-sem-v ${modo}`).out.publicar, 'false', `com flag ${modo}`)
    assert.equal(r.decidirGit(modo).out.publicar, 'true', `sem flag ${modo}`)
  }
}))

test('git: --aceitar-sem-v: tag numérica em outro SHA falha; no mesmo SHA não publica', () => comRepo('1.3.4', (r) => {
  const velho = r.g('git rev-parse HEAD')
  r.tag('1.3.4', velho)
  const novo = r.commit('dois')
  const fixa = "--tags 'v0.0.1'"
  assert.equal(r.decidirGit(`--aceitar-sem-v ${fixa} --remoto origin --sha ${novo} --branch main`).rc, 4)
  const mesmo = r.decidirGit(`--aceitar-sem-v ${fixa} --remoto origin --sha ${velho}`)
  assert.equal(mesmo.rc, 0); assert.equal(mesmo.out.publicar, 'false')
  // sem a flag a tag numérica não é do canal: não bloqueia
  assert.equal(r.decidirGit(`${fixa} --remoto origin --sha ${novo} --branch main`).out.publicar, 'true')
}))
