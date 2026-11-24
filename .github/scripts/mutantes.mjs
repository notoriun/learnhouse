#!/usr/bin/env node
// Prova por mutação de versao.mjs: cada mutante tem de ser morto pelos testes.
// Uso: node .github/scripts/mutantes.mjs   (sai com 1 se algum mutante sobreviver)
// Cada mutante é uma cópia de versao.mjs com uma regressão de segurança injetada; versao.test.mjs roda contra a cópia.
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))

const MUTANTES = [
  ['filtro sem tag casando vira erro (equivale a tirar o `|| true`)',
    '  return melhor\n}', "  if (!melhor) throw new Error('sem tag')\n  return melhor\n}"],
  ['falha do git aceita como vazio',
    "    throw new ErroGit(`git ${args.join(' ')} falhou: ${String(e.stderr || e.message).trim()}`)", "    return ''"],
  ['tag existente em outro SHA aceita',
    'if (existente !== null && !forcar) {', 'if (false) {'],
  ['clone raso aceito',
    "if (raso === 'true') throw", "if (false) throw"],
  ['zero à esquerda aceito na tag',
    "const NUM = '(?:0|[1-9]\\\\d*)'", "const NUM = '\\\\d+'"],
  ['--aceitar-sem-v ignora as tags numéricas na listagem',
    "(ACEITA_SEM_V ? ['v*', '[0-9]*'] : ['v*'])", "['v*']"],
  ['--aceitar-sem-v ignora a tag numérica na conferência do remoto',
    'const nomes = ACEITA_SEM_V ? [`v${out.versao}`, out.versao] : [`v${out.versao}`]', 'const nomes = [`v${out.versao}`]'],
  ['run velha (SHA fora da ponta) aceita',
    'if (ponta !== sha) throw', 'if (false) throw'],
  ['tag anotada comparada pelo objeto da tag, não pelo commit',
    'return m.get(`${ref}^{}`) || m.get(ref) || null', 'return m.get(ref) || null'],
  ['forcar ignorado na comparação de versão',
    'if (forcar) {\n    // Tag só', 'if (false) {\n    // Tag só'],
]

const fonte = readFileSync(join(AQUI, 'versao.mjs'), 'utf8')
let mortos = 0
for (const [nome, antes, depois] of MUTANTES) {
  if (fonte.split(antes).length !== 2) { console.log(`ERRO  ${nome}: trecho do mutante não encontrado exatamente uma vez`); process.exit(2) }
  const d = mkdtempSync(join(tmpdir(), 'mutante-'))
  try {
    copyFileSync(join(AQUI, 'versao.test.mjs'), join(d, 'versao.test.mjs'))
    writeFileSync(join(d, 'versao.mjs'), fonte.replace(antes, () => depois))
    const r = spawnSync('node', ['--test', 'versao.test.mjs'], { cwd: d, encoding: 'utf8' })
    const morto = r.status !== 0
    if (morto) mortos++
    console.log(`${morto ? 'MORTO ' : 'VIVO  '} ${nome}`)
  } finally { rmSync(d, { recursive: true, force: true }) }
}
console.log(`${mortos}/${MUTANTES.length} mutantes mortos`)
process.exit(mortos === MUTANTES.length ? 0 : 1)
