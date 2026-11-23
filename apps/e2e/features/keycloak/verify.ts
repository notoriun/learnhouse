/**
 * Asserções de estado, compartilhadas pelas jornadas.
 *
 * Tudo aqui lê pela interface publicada — cookie do navegador, API REST da
 * plataforma, interface administrativa do provedor. Nenhuma consulta a
 * PostgreSQL ou Redis (Princípio I).
 */
import type { BrowserContext, Page } from '@playwright/test'
import { userSessions } from './provider'

/**
 * Nome do cookie de sessão da plataforma.
 *
 * Verificado no ambiente de pé: o callback bem-sucedido emite `LH_session`. As
 * variantes existem porque o encerramento precisa comprovar que **todas** as
 * formas de cookie de sessão saíram (FR-002 de 003-logout-revogacao).
 */
export const SESSION_COOKIE_PREFIXES = ['LH_session', 'access_token_cookie', 'next-auth.session']

/** Cookies de sessão da plataforma presentes no contexto. */
export async function platformSessionCookies(context: BrowserContext): Promise<string[]> {
  const cookies = await context.cookies()
  return cookies
    .filter((c) => SESSION_COOKIE_PREFIXES.some((p) => c.name.startsWith(p)))
    .map((c) => c.name)
}

/** True quando existe alguma sessão da plataforma no navegador. */
export async function hasPlatformSession(context: BrowserContext): Promise<boolean> {
  return (await platformSessionCookies(context)).length > 0
}

/**
 * Confirma que a sessão é utilizável de fato, não apenas que o cookie existe.
 *
 * Distinção que importa: um cookie presente mas recusado pelo servidor é
 * exatamente o estado que a jornada de revogação precisa detectar.
 *
 * IMPLEMENTAÇÃO ANTERIOR ESTAVA ERRADA e vale registrar por quê. Ela navegava
 * para `/dash` e concluía "está dentro" quando a URL não era a de entrada. Só
 * que `/dash` responde **HTTP 200 com a página de "não existe"** — um soft-404.
 * A URL nunca virava `/login`, então a função devolvia `true` sempre, e a
 * asserção "a sessão é utilizável" passava sem verificar nada. Falso verde.
 *
 * A verificação agora pergunta ao servidor quem ele acha que somos, usando os
 * cookies do navegador: `GET /api/v1/users/profile` devolve
 * `user_uuid: "user_anonymous"` sem sessão válida, e o usuário real com sessão.
 * É a fonte da verdade da API, não um palpite sobre roteamento de páginas.
 */
export async function canReachAuthenticatedArea(page: Page, baseUrl: string): Promise<boolean> {
  // A consulta roda na origem da página, para os cookies acompanharem. Depois de
  // um logout coordenado o navegador pode estar na origem do provedor, e ali os
  // cookies da plataforma não existem — o que daria falso negativo.
  if (!page.url().startsWith(baseUrl)) {
    await page.goto(`${baseUrl}/login`)
  }

  const perfil = await page.evaluate(async (url) => {
    try {
      const res = await fetch(`${url}/api/v1/users/profile`, { credentials: 'include' })
      if (!res.ok) return null
      return (await res.json()) as { user_uuid?: string; id?: number }
    } catch {
      return null
    }
  }, baseUrl)

  if (!perfil) return false
  return perfil.user_uuid !== 'user_anonymous' && (perfil.id ?? 0) !== 0
}

/** Sessões do usuário no provedor. Vazio = o provedor não tem sessão ativa. */
export async function providerSessionCount(providerId: string): Promise<number> {
  const sessions = await userSessions(providerId)
  return sessions.length
}

/** Vínculo de identidade externa da conta, pela API da plataforma. */
export async function hasExternalIdentity(
  token: string,
  apiUrl: string,
): Promise<boolean> {
  // A conta federada é reconhecível pela recusa de troca local de credencial:
  // é a superfície publicada que expõe o vínculo sem endpoint dedicado.
  const res = await fetch(`${apiUrl}/users/user_id/password`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_password: 'x', new_password: 'y' }),
  })
  const body = await res.text()
  return res.status === 403 && /CONTA_FEDERADA/i.test(body)
}

/**
 * Extrai o código de erro que a interface expõe na URL após uma recusa.
 *
 * O BFF traduz o erro da API para um parâmetro `error` no destino — é o que a
 * pessoa vê, e portanto o que a jornada de recusa deve comprovar.
 */
export function errorFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get('error')
  } catch {
    return null
  }
}
