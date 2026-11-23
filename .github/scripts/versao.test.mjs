// Teste do script de versão: `node --test .github/scripts/versao.test.mjs`
import { test } from 'node:test'
import assert from 'node:assert/strict'
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
  } finally { aceitarSemV(false) }
})
