/**
 * Isolamento de dados entre execuções.
 *
 * O problema que isto resolve: jornadas de "primeiro acesso" deixam de ser
 * primeiro acesso na segunda execução. Se elas reutilizassem a credencial fixa,
 * o veredito mudaria entre execuções sobre o mesmo ambiente — exatamente a
 * não-repetibilidade que FR-009 proíbe. A alternativa seria recriar o ambiente
 * a cada rodada (`down -v`), que custa minutos e comprometeria SC-001.
 *
 * A saída é um sufixo único por execução prefixando tudo que a validação cria.
 */
import { EPHEMERAL_EMAIL_DOMAIN } from './config'
import { createEphemeralIdentity, deleteIdentity } from './provider'
import type { EphemeralIdentity } from './provider'

/**
 * Sufixo único da execução, estável durante toda ela.
 *
 * Calculado uma vez no carregamento do módulo: a suíte roda serial
 * (`workers: 1`), então um único valor por processo é o que se quer — jornadas
 * diferentes da mesma execução compartilham o sufixo e ainda assim não colidem,
 * porque cada uma pede sua própria identidade com rótulo distinto.
 */
export const RUN_SUFFIX = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296)
  .toString(36)
  .padStart(2, '0')}`

/** E-mail efêmero para um rótulo de jornada. TLD comum, nunca reservado. */
export function ephemeralEmail(label: string): string {
  return `kc-${label}-${RUN_SUFFIX}@${EPHEMERAL_EMAIL_DOMAIN}`
}

/**
 * Senha que atende a política da plataforma.
 *
 * O sufixo da execução é base36 e pode sair **só com letras** — quando saiu, as
 * jornadas falharam com `WEAK_PASSWORD` ("must contain at least one number").
 * Falha intermitente e enganosa: parecia defeito de validação, era senha gerada
 * fora da política. Os componentes fixos garantem maiúscula, minúscula, dígito e
 * símbolo em toda execução.
 */
export function senhaValida(rotulo: string): string {
  return `Aa1!${rotulo}${RUN_SUFFIX}9`
}

/** Identificador único para um rótulo, sem o domínio. */
export function ephemeralLabel(label: string): string {
  return `${label}-${RUN_SUFFIX}`
}

// Registro do que foi criado, para a limpeza no fim da execução. Sem isto o
// realm acumula uma identidade por execução, indefinidamente.
const _criadas: string[] = []

/**
 * Cria no provedor uma identidade que nunca entrou na plataforma.
 *
 * `emailVerified: false` é o padrão de propósito: a jornada de registro precisa
 * que a verificação aconteça de verdade, pelo provedor.
 */
export async function newProviderIdentity(
  label: string,
  opts: { emailVerified?: boolean } = {},
): Promise<EphemeralIdentity> {
  const identity = await createEphemeralIdentity(ephemeralLabel(label), opts)
  _criadas.push(identity.providerId)
  return identity
}

/** Remove as identidades criadas nesta execução. Idempotente e silenciosa. */
export async function cleanupProviderIdentities(): Promise<void> {
  const ids = _criadas.splice(0, _criadas.length)
  await Promise.all(ids.map((id) => deleteIdentity(id)))
}

/** Identidades criadas e ainda não limpas — usado em asserção de limpeza. */
export function pendingIdentities(): readonly string[] {
  return _criadas
}
