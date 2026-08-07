/**
 * Fase de pré-condições — roda antes de qualquer jornada.
 *
 * O nome do arquivo importa: o Playwright ordena os specs alfabeticamente
 * dentro do diretório e a suíte roda serial (`workers: 1`), então
 * `preconditions.spec.ts` vem antes de `us1-*`, `us2-*` e assim por diante.
 *
 * Por que isto é um spec e não um `globalSetup`: como spec, a reprovação
 * aparece no relatório com a mesma forma das jornadas, com causa e instrução de
 * correção — em `globalSetup` ela sairia como um erro de infraestrutura sem
 * classificação, que é justamente o que FR-007 quer evitar.
 */
import { test, expect } from '../../../core/fixtures'
import { BASE_URL } from '../config'
import { RUN_SUFFIX } from '../fixtures'
import {
  runPreconditions,
  allPassed,
  firstFailure,
  assertWellFormed,
} from '../preconditions'
import { buildExecution, render } from '../reporter'

test.describe('pré-condições de ambiente', () => {
  test('o módulo está bem formado (toda preparação tem instrução de correção)', async () => {
    // Verificação de construção, não de ambiente: uma pré-condição de
    // preparação sem instrução de correção deixaria quem executa sem saída.
    expect(() => assertWellFormed()).not.toThrow()
  })

  test('o ambiente está apto a receber as jornadas', async () => {
    const outcomes = await runPreconditions()

    const exec = buildExecution({
      ambienteAlvo: BASE_URL,
      sufixoDaExecucao: RUN_SUFFIX,
      inicioEm: new Date().toISOString(),
      precondicoes: outcomes,
      jornadas: [],
    })

    // O relatório sai sempre — aprovado ou não. É a evidência de FR-005/FR-006,
    // e sem ele uma reprovação obrigaria a reexecutar para entender a causa.
    console.log(render(exec))

    const falha = firstFailure(outcomes)
    if (falha) {
      const rotulo =
        falha.categoriaDeFalha === 'indisponibilidade'
          ? 'INDISPONIBILIDADE DE SERVIÇO'
          : 'PREPARAÇÃO DE AMBIENTE'
      // Mensagem carrega a classificação para que a falha não seja lida como
      // defeito de produto — é o ponto inteiro de D-08.
      throw new Error(
        [
          '',
          `${rotulo} — as jornadas NÃO foram executadas.`,
          '',
          `  pré-condição: ${falha.id} (${falha.descricao})`,
          `  observado:    ${falha.observado}`,
          `  correção:     ${falha.instrucaoDeCorrecao}`,
          '',
          'Isto não é defeito de produto. Corrija o ambiente e execute de novo.',
          '',
        ].join('\n'),
      )
    }

    expect(allPassed(outcomes)).toBe(true)
  })
})
