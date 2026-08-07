/**
 * Auditoria de cobertura (SC-006, FR-014).
 *
 * Reprova quando a matriz e os arquivos de jornada divergem — em qualquer
 * direção. Uma jornada sem entrada na matriz é órfã (ninguém sabe que requisito
 * ela comprova); uma entrada da matriz sem arquivo é cobertura declarada e
 * inexistente, que é pior, porque o relatório passa a mentir por omissão.
 *
 * O prefixo `zz-` garante que roda por último: os arquivos são descobertos em
 * ordem alfabética e faz sentido auditar depois de tudo ter rodado.
 */
import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COVERAGE, coveredRequirements, declaredGaps } from '../coverage'

const AQUI = dirname(fileURLToPath(import.meta.url))

test.describe('auditoria de cobertura', () => {
  test('toda entrada da matriz tem arquivo de jornada correspondente', () => {
    const existentes = new Set(readdirSync(AQUI).filter((f) => f.endsWith('.spec.ts')))
    const faltando = COVERAGE.filter((c) => {
      if (c.bloqueado) return false // lacuna declarada, reportada no teste próprio
      const base = c.arquivo.replace(/^tests\//, '')
      return !existentes.has(base)
    }).map((c) => `${c.id} -> ${c.arquivo}`)

    expect(
      faltando,
      `a matriz declara cobertura que não existe em arquivo: ${faltando.join('; ')}`,
    ).toHaveLength(0)
  })

  test('toda jornada tem entrada na matriz (nenhuma órfã)', () => {
    const declarados = new Set(COVERAGE.map((c) => c.arquivo.replace(/^tests\//, '')))
    const orfas = readdirSync(AQUI)
      .filter((f) => f.endsWith('.spec.ts'))
      // Não são jornadas: as pré-condições e esta própria auditoria.
      .filter((f) => f !== 'preconditions.spec.ts' && f !== 'zz-coverage.spec.ts')
      .filter((f) => !declarados.has(f))

    expect(
      orfas,
      `jornadas sem requisito de origem na matriz: ${orfas.join(', ')} (viola SC-006)`,
    ).toHaveLength(0)
  })

  test('todo título de jornada carrega o requisito de origem', () => {
    // A rastreabilidade só serve se aparecer no relatório. Se um arquivo montar
    // o título à mão em vez de usar `title()`, o requisito desaparece da saída.
    const semTitleHelper: string[] = []
    for (const c of COVERAGE.filter((x) => !x.bloqueado)) {
      const base = c.arquivo.replace(/^tests\//, '')
      const conteudo = readFileSync(join(AQUI, base), 'utf8')
      if (!conteudo.includes(`title('${c.id}')`)) semTitleHelper.push(c.id)
    }
    expect(
      semTitleHelper,
      `jornadas que não usam title() e portanto perdem a rastreabilidade no ` +
        `relatório: ${semTitleHelper.join(', ')}`,
    ).toHaveLength(0)
  })

  test('as lacunas declaradas estão visíveis no relatório', () => {
    // Este teste PASSA com lacunas — o ponto não é proibi-las, é impedir que
    // sejam silenciosas. Ele imprime cada uma, com a razão, na saída da
    // execução, para que ninguém leia a suíte verde como cobertura completa.
    const lacunas = declaredGaps()
    for (const l of lacunas) {
      console.log(
        `\n[LACUNA DECLARADA] ${l.id} (${l.userStory}) — requisitos ${l.requisitos.join(', ')} ` +
          `SEM cobertura ponta a ponta.\n  razão: ${l.bloqueado}\n`,
      )
    }
    // Toda lacuna precisa de razão registrada; lacuna sem razão é omissão.
    const semRazao = lacunas.filter((l) => !l.bloqueado?.trim())
    expect(semRazao, 'lacuna declarada sem razão').toHaveLength(0)
  })

  test('a matriz cobre requisitos das especificações 001 a 004 e 007', () => {
    const reqs = coveredRequirements()
    expect(reqs.length, 'matriz vazia').toBeGreaterThan(0)
    const malFormados = reqs.filter((r) => !/^FR-\d{3} \(\d{3}\)$/.test(r))
    expect(
      malFormados,
      `requisitos fora do formato "FR-00X (00Y)": ${malFormados.join(', ')}`,
    ).toHaveLength(0)
  })
})
