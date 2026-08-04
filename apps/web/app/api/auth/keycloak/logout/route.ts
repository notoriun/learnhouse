import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getConfig } from '@services/config/config'
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '@services/auth/cookies'
import { appendClearAuthCookies } from '../../[...path]/route'

const BACKEND_URL = (
  getConfig('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL') || 'http://localhost:1338'
).replace(/\/+$/, '')

function safeInternalPath(path: string | null): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return '/'
  return path
}

/**
 * Logout coordenado da sessão federada (RP-Initiated). Navegação top-level.
 * SEMPRE limpa os cookies nas duas variantes (host-only e domain-scoped),
 * mesmo se a API falhar; redireciona ao end_session do provedor quando
 * disponível, senão a um destino interno seguro (contracts/logout.md §1.2).
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value
  const fallback = safeInternalPath(request.nextUrl.searchParams.get('redirect'))

  let endSessionUrl: string | null = null
  try {
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    const cookieParts: string[] = []
    if (accessToken) cookieParts.push(`${ACCESS_TOKEN_COOKIE}=${accessToken}`)
    if (refreshToken) cookieParts.push(`${REFRESH_TOKEN_COOKIE}=${refreshToken}`)
    if (cookieParts.length) headers['Cookie'] = cookieParts.join('; ')
    for (const h of ['x-forwarded-for', 'x-real-ip', 'user-agent']) {
      const v = request.headers.get(h)
      if (v) (headers as Record<string, string>)[h] = v
    }

    const res = await fetch(`${BACKEND_URL}/api/v1/auth/keycloak/logout`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const body = await res.json().catch(() => null)
      endSessionUrl = body?.end_session_url || null
    }
  } catch {
    // Falha da API não impede o logout local — cookies são limpos abaixo.
  }

  const destination =
    endSessionUrl && /^https?:\/\//.test(endSessionUrl)
      ? endSessionUrl
      : new URL(fallback, request.nextUrl.origin).toString()

  const response = NextResponse.redirect(destination)
  response.headers.set('Cache-Control', 'no-store')
  appendClearAuthCookies(response, request)
  // Limpa também os marcadores federados não-httpOnly.
  for (const marker of ['LH_sso']) {
    response.headers.append(
      'Set-Cookie',
      `${marker}=; Path=/; Max-Age=0; SameSite=Lax`,
    )
  }
  return response
}
