#!/usr/bin/env node
/**
 * Auditoria de marca residual (feature 005 — FR-010/SC-001).
 *
 * Varre as superfícies visíveis ao usuário por termos e assets da marca
 * original. Sai com código 1 quando há ≥1 FAIL — é o gate de release.
 *
 * Uso:  node scripts/brand-audit.mjs [--json]
 *
 * Node puro, sem dependências (Princípio V). A allowlist é declarativa em
 * scripts/brand-audit-allowlist.json — identificadores técnicos (LH_*,
 * LEARNHOUSE_*) são protegidos por FR-009 e nunca contam como FAIL.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const ALLOWLIST = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'brand-audit-allowlist.json'), 'utf-8')
)

// Superfícies varridas (contracts/branding.md §2.3)
const SURFACES = [
  'apps/web/app',
  'apps/web/components',
  'apps/web/services',
  'apps/web/locales',
  'apps/api/src/services/email',
  'README.md',
]

// Termos proibidos (case-insensitive). "learnhouse" cobre domínios e compostos.
const FORBIDDEN = /learnhouse/gi

const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.py', '.md', '.css',
  '.html', '.svg', '.yaml', '.yml', '.txt',
])

const allowPatterns = ALLOWLIST.patterns.map((p) => new RegExp(p.regex, 'g'))

function pathAllowed(rel) {
  const norm = rel.split(sep).join('/')
  return ALLOWLIST.paths.some((p) =>
    (p.prefix && norm.startsWith(p.prefix)) || (p.suffix && norm.endsWith(p.suffix))
  )
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue
      yield* walk(full)
    } else {
      yield full
    }
  }
}

const results = { fails: [], allows: [], assets: [] }

function scanFile(full) {
  const rel = relative(ROOT, full)
  const norm = rel.split(sep).join('/')
  const ext = norm.slice(norm.lastIndexOf('.'))
  if (!TEXT_EXT.has(ext)) return
  const allowedPath = pathAllowed(rel)
  const content = readFileSync(full, 'utf-8')
  if (!/learnhouse/i.test(content)) return

  const lines = content.split('\n')
  lines.forEach((line, i) => {
    if (!/learnhouse/i.test(line)) return
    // Remove os padrões técnicos permitidos ANTES de decidir.
    let stripped = line
    for (const re of allowPatterns) stripped = stripped.replace(re, '')
    const residual = stripped.match(FORBIDDEN)
    const entry = { file: norm, line: i + 1, text: line.trim().slice(0, 160) }
    if (allowedPath) {
      results.allows.push({ ...entry, reason: 'path allowlist' })
    } else if (residual) {
      results.fails.push(entry)
    } else {
      results.allows.push({ ...entry, reason: 'pattern allowlist' })
    }
  })
}

for (const surface of SURFACES) {
  const full = join(ROOT, surface)
  if (!existsSync(full)) continue
  const st = statSync(full)
  if (st.isDirectory()) {
    for (const f of walk(full)) scanFile(f)
  } else {
    scanFile(full)
  }
}

// Assets proibidos em apps/web/public/ (fora de /brand/)
const pubDir = join(ROOT, 'apps/web/public')
if (existsSync(pubDir)) {
  for (const f of walk(pubDir)) {
    const rel = relative(ROOT, f).split(sep).join('/')
    if (rel.startsWith('apps/web/public/brand/')) continue
    const base = rel.slice(rel.lastIndexOf('/') + 1)
    if (ALLOWLIST.forbiddenAssets.includes(base)) {
      results.assets.push({ file: rel })
    }
  }
}

const failCount = results.fails.length + results.assets.length

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      {
        fails: results.fails,
        forbiddenAssets: results.assets,
        allowCount: results.allows.length,
        failCount,
      },
      null,
      2
    )
  )
} else {
  for (const f of results.fails) {
    console.log(`FAIL  ${f.file}:${f.line}  ${f.text}`)
  }
  for (const a of results.assets) {
    console.log(`FAIL  asset proibido: ${a.file}`)
  }
  console.log(
    `\nbrand-audit: ${failCount} FAIL, ${results.allows.length} ALLOW (allowlist)`
  )
}

process.exit(failCount > 0 ? 1 : 0)
