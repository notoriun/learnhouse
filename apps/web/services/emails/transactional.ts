import 'server-only'
import { send } from './resend'
import { getBrand } from '@services/config/brand'
import { getPlatformUrl } from '@services/config/config'

// Non-billing transactional emails (welcome, contact). Same never-throw contract
// as the billing mails: fire-and-forget, no-op without RESEND_API_KEY.

export async function sendWelcomeAccountMail(args: { email: string; username?: string }): Promise<void> {
  const { email, username } = args
  const brand = getBrand()
  // E-mails precisam de URL absoluta — sem platform URL configurada, sem CTA.
  const homeUrl = getPlatformUrl('/home')
  await send(email, `Boas-vindas ao ${brand.name} 👋`, {
    accentColor: '#171717',
    heading: `Boas-vindas ao ${brand.name}!`,
    subtitle: username
      ? `Olá ${username}, que bom ter você por aqui.`
      : 'Que bom ter você por aqui.',
    body: 'Você já pode criar e compartilhar cursos. Para aproveitar ao máximo:',
    bulletPoints: [
      'Crie seu primeiro curso e adicione conteúdo em minutos.',
      'Convide alunos e acompanhe o progresso deles.',
      'Personalize sua escola e compartilhe com o mundo.',
    ],
    ...(homeUrl ? { cta: { label: 'Começar agora', href: homeUrl } } : {}),
  })
}

export async function sendContactMail(args: {
  fromEmail: string
  name?: string
  message: string
  to?: string
}): Promise<void> {
  const { fromEmail, name, message, to } = args
  await send(to || getBrand().contactEmail, `Nova mensagem de contato de ${name || fromEmail}`, {
    accentColor: '#171717',
    heading: 'Nova mensagem de contato',
    subtitle: `De ${name ? `${name} · ` : ''}${fromEmail}`,
    body: message,
  })
}

// NOTE: org-created / org-deleted / account-deleted confirmation emails are
// deliberately NOT sent from here. Unlike Stripe/billing mails (which the web
// webhook owns), user/org lifecycle is owned by apps/api, which has its own
// email service — those confirmations belong there to avoid duplicate sends.
