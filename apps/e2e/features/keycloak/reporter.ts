/**
 * Relatório da execução: veredito por jornada, veredito agregado e categoria de
 * causa de cada reprovação (FR-005, FR-006, FR-007).
 *
 * O que este arquivo resolve, e que o relatório do Playwright sozinho não
 * resolve: distinguir *defeito de produto* de *problema de preparação* e de
 * *indisponibilidade de serviço*. Sem essa distinção, uma suíte vermelha não diz
 * se o produto está quebrado ou se o ambiente não subiu — e quem lê o resultado
 * toma a decisão errada.
 *
 * Todo texto que sai daqui passa pelo saneamento de segredos (FR-012, D-12).
 */
import { CREDENTIALS } from './config'
import type { PreconditionOutcome } from './preconditions'
import { COVERAGE } from './coverage'

export type Cause = 'defeito_produto' | 'preparacao' | 'indisponibilidade'
export type Verdict = 'aprovado' | 'reprovado' | 'nao_executada'

export interface JourneyOutcome {
  id: string
  titulo: string
  veredito: Verdict
  causa: Cause | null
  /** Obrigatórios quando `veredito === 'reprovado'` (FR-006). */
  etapaQueFalhou?: string
  esperado?: string
  observado?: string
}

// ---------------------------------------------------------------------------
// Saneamento (T019 / FR-012)
// ---------------------------------------------------------------------------

/**
 * Padrões de segredo que nunca podem chegar ao relatório.
 *
 * Inclui os segredos conhecidos por configuração (senhas das credenciais de
 * teste, segredo do client) e as formas genéricas — `code=`, `access_token`,
 * `id_token`, `refresh_token`, `Bearer …`. A lista é conservadora de propósito:
 * mascarar demais custa legibilidade, mascarar de menos vaza credencial em
 * artefato de CI.
 */
function secretPatterns(): RegExp[] {
  const literais = [
    ...Object.values(CREDENTIALS).map((c) => c.secret),
    process.env.LEARNHOUSE_KEYCLOAK_CLIENT_SECRET,
    process.env.KC_ADMIN_PASSWORD,
    process.env.E2E_ADMIN_PASSWORD,
  ].filter((v): v is string => Boolean(v && v.length >= 4))

  const escapados = literais.map(
    (v) => new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
  )

  return [
    ...escapados,
    /\bcode=[^\s&"']+/gi,
    /\b(access_token|id_token|refresh_token|code_verifier|client_secret)=[^\s&"']+/gi,
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
    /\beyJ[A-Za-z0-9._-]{10,}/g, // qualquer JWT em texto corrido
  ]
}

/** Substitui todo segredo por um marcador. Idempotente. */
export function sanitize(text: string): string {
  if (!text) return text
  let out = text
  for (const p of secretPatterns()) {
    out = out.replace(p, (match) => {
      // Preserva o nome do parâmetro para o relatório continuar legível.
      const eq = match.indexOf('=')
      return eq > 0 ? `${match.slice(0, eq)}=<REDIGIDO>` : '<REDIGIDO>'
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Agregação
// ---------------------------------------------------------------------------

export interface Execution {
  inicioEm: string
  ambienteAlvo: string
  sufixoDaExecucao: string
  precondicoes: PreconditionOutcome[]
  jornadas: JourneyOutcome[]
  vereditoAgregado: Verdict
}

/**
 * Valida a integridade do desfecho de uma jornada antes de relatá-la.
 *
 * Reprovação sem etapa, esperado ou observado viola FR-006 — e é erro de quem
 * escreveu a jornada, não resultado de execução. Falhar aqui é preferível a
 * emitir um relatório que não permite investigar.
 */
export function assertReportable(j: JourneyOutcome): void {
  if (j.veredito !== 'reprovado') return
  const faltando = (['etapaQueFalhou', 'esperado', 'observado'] as const).filter(
    (k) => !j[k]?.trim(),
  )
  if (faltando.length) {
    throw new Error(
      `jornada ${j.id} reprovada sem ${faltando.join(', ')} — viola FR-006 ` +
        '(evidência insuficiente para investigar sem reexecutar)',
    )
  }
  if (!j.causa) {
    throw new Error(`jornada ${j.id} reprovada sem categoria de causa — viola FR-007`)
  }
}

export function buildExecution(input: {
  ambienteAlvo: string
  sufixoDaExecucao: string
  inicioEm: string
  precondicoes: PreconditionOutcome[]
  jornadas: JourneyOutcome[]
}): Execution {
  input.jornadas.forEach(assertReportable)
  const precondicoesOk = input.precondicoes.every((p) => p.resultado === 'ok')
  const jornadasOk = input.jornadas.every((j) => j.veredito === 'aprovado')
  return {
    ...input,
    vereditoAgregado: precondicoesOk && jornadasOk ? 'aprovado' : 'reprovado',
  }
}

const CAUSE_LABEL: Record<Cause, string> = {
  defeito_produto: 'DEFEITO DE PRODUTO',
  preparacao: 'PREPARAÇÃO DE AMBIENTE',
  indisponibilidade: 'INDISPONIBILIDADE DE SERVIÇO',
}

/** Relatório em texto, já sanitizado. É o que vai para a saída da execução. */
export function render(exec: Execution): string {
  const l: string[] = []
  l.push('')
  l.push('='.repeat(78))
  l.push('VALIDAÇÃO DO LOGIN CORPORATIVO (KEYCLOAK)')
  l.push('='.repeat(78))
  l.push(`Ambiente: ${exec.ambienteAlvo}`)
  l.push(`Início:   ${exec.inicioEm}`)
  l.push(`Execução: ${exec.sufixoDaExecucao}`)
  l.push('')

  l.push('-- Pré-condições ' + '-'.repeat(60))
  for (const p of exec.precondicoes) {
    const marca = p.resultado === 'ok' ? 'OK  ' : p.resultado === 'falhou' ? 'FALHA' : '--  '
    l.push(`  [${marca}] ${p.id}: ${p.descricao}`)
    if (p.resultado === 'falhou') {
      l.push(`          causa:     ${CAUSE_LABEL[p.categoriaDeFalha]}`)
      l.push(`          observado: ${sanitize(p.observado)}`)
      l.push(`          correção:  ${p.instrucaoDeCorrecao}`)
    }
  }
  l.push('')

  l.push('-- Jornadas ' + '-'.repeat(65))
  if (exec.jornadas.length === 0) {
    l.push('  (nenhuma executada — a fase de pré-condições barrou a execução)')
  }
  for (const j of exec.jornadas) {
    const marca =
      j.veredito === 'aprovado' ? 'OK  ' : j.veredito === 'reprovado' ? 'FALHA' : '--  '
    l.push(`  [${marca}] ${j.titulo}`)
    if (j.veredito === 'reprovado') {
      l.push(`          causa:     ${CAUSE_LABEL[j.causa!]}`)
      l.push(`          etapa:     ${sanitize(j.etapaQueFalhou!)}`)
      l.push(`          esperado:  ${sanitize(j.esperado!)}`)
      l.push(`          observado: ${sanitize(j.observado!)}`)
    }
  }
  l.push('')

  const reprovadas = exec.jornadas.filter((j) => j.veredito === 'reprovado')
  const defeitos = reprovadas.filter((j) => j.causa === 'defeito_produto')
  l.push('-- Resumo ' + '-'.repeat(67))
  l.push(`  jornadas na matriz de cobertura: ${COVERAGE.length}`)
  l.push(`  executadas: ${exec.jornadas.length} | aprovadas: ${exec.jornadas.length - reprovadas.length} | reprovadas: ${reprovadas.length}`)
  if (defeitos.length) {
    l.push('')
    l.push(`  ${defeitos.length} reprovação(ões) classificada(s) como DEFEITO DE PRODUTO.`)
    l.push('  Cada uma exige registro rastreável; a validação NÃO deve ser ajustada')
    l.push('  para aceitar o comportamento defeituoso (FR-015).')
  }
  l.push('')
  l.push(`VEREDITO AGREGADO: ${exec.vereditoAgregado.toUpperCase()}`)
  l.push('='.repeat(78))
  l.push('')
  return l.join('\n')
}
