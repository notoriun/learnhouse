/**
 * Leitura do coletor SMTP descartável do compose local (serviço `mailpit`).
 *
 * Existe porque o realm não tem provedor de e-mail real: sem coletor, o
 * Keycloak não consegue enviar o e-mail de verificação, e o caminho feliz do
 * registro federado — registrar, verificar o e-mail, ser admitido — não é
 * exercitável (D-06).
 *
 * Depende de duas capacidades, não de um produto: aceitar SMTP do Keycloak e
 * permitir leitura programática das mensagens. Trocar o coletor é trocar este
 * arquivo.
 */
import { MAILBOX_URL } from './config'

interface MailpitSummary {
  ID: string
  Subject: string
  To: Array<{ Address: string }>
}

/** True quando o coletor está atendendo. Nunca lança — usado em pré-condição. */
export async function isMailboxReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${MAILBOX_URL}/api/v1/messages`)
    return res.ok
  } catch {
    return false
  }
}

/** Descarta todas as mensagens — isola uma execução da anterior (FR-009). */
export async function clearMailbox(): Promise<void> {
  const res = await fetch(`${MAILBOX_URL}/api/v1/messages`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`limpeza do coletor -> ${res.status}`)
}

async function listMessages(): Promise<MailpitSummary[]> {
  const res = await fetch(`${MAILBOX_URL}/api/v1/messages?limit=200`)
  if (!res.ok) throw new Error(`listagem do coletor -> ${res.status}`)
  const data = (await res.json()) as { messages?: MailpitSummary[] }
  return data.messages ?? []
}

async function messageBody(id: string): Promise<string> {
  const res = await fetch(`${MAILBOX_URL}/api/v1/message/${id}`)
  if (!res.ok) throw new Error(`leitura de mensagem -> ${res.status}`)
  const data = (await res.json()) as { HTML?: string; Text?: string }
  return `${data.HTML ?? ''}\n${data.Text ?? ''}`
}

/**
 * Aguarda a mensagem mais recente endereçada a `email` e devolve o corpo.
 *
 * O envio do Keycloak é assíncrono em relação à ação que o dispara, então
 * esperar é obrigatório; um `timeoutMs` esgotado é falha de ambiente, não de
 * produto, e quem chama deve classificá-la assim.
 */
export async function waitForMessage(
  email: string,
  opts: { timeoutMs?: number; subjectContains?: string } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const deadline = Date.now() + timeoutMs
  let seen = 0
  while (Date.now() < deadline) {
    const messages = await listMessages()
    seen = messages.length
    const match = messages.find(
      (m) =>
        m.To?.some((t) => t.Address?.toLowerCase() === email.toLowerCase()) &&
        (!opts.subjectContains ||
          m.Subject?.toLowerCase().includes(opts.subjectContains.toLowerCase())),
    )
    if (match) return messageBody(match.ID)
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(
    `nenhuma mensagem para ${email} em ${timeoutMs}ms (${seen} mensagens no coletor). ` +
      'Confira o serviço mailpit e o smtpServer do realm.',
  )
}

/**
 * Extrai o link de ação do corpo do e-mail de verificação do Keycloak.
 *
 * O link aponta para `/realms/<realm>/login-actions/action-token`, e é ele que
 * conclui a verificação — no provedor, não na plataforma.
 */
export function extractActionLink(body: string): string {
  // O corpo em HTML escapa &amp;, o que quebra os parâmetros da URL se usado cru.
  const normalized = body.replace(/&amp;/g, '&')
  const match = normalized.match(/https?:\/\/[^\s"'<>]*login-actions\/[^\s"'<>]+/)
  if (!match) {
    throw new Error('nenhum link de ação encontrado no e-mail de verificação')
  }
  return match[0]
}

/** Atalho: aguarda o e-mail de verificação e devolve o link de conclusão. */
export async function waitForVerificationLink(
  email: string,
  timeoutMs?: number,
): Promise<string> {
  const body = await waitForMessage(email, { timeoutMs, subjectContains: 'verify' })
  return extractActionLink(body)
}
