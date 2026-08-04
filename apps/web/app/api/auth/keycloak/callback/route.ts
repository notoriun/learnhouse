import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@services/config/config'
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE,
  REFRESH_TOKEN_MAX_AGE,
  getCookieOptions,
} from '@services/auth/cookies'

const BACKEND_URL = (
  getConfig('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL') || 'http://localhost:1338'
).replace(/\/+$/, '')

// Mapeamento status/código da API → código genérico na query da tela de login
// (contracts/api-oidc.md §1). O detalhe fica nos logs de auditoria do backend;
// error_description do provedor NUNCA é repassado (US2).
function mapApiError(status: number, code: string | undefined): string {
  if (status === 410) return 'sessao_expirada'
  if (status === 503) return 'sso_indisponivel'
  if (status === 403 && code === 'CONTA_NAO_ENCONTRADA') return 'conta_nao_encontrada'
  if (status === 403 && code === 'METODO_NAO_PERMITIDO') return 'sso_nao_disponivel'
  return 'login_invalido'
}

function loginRedirect(request: NextRequest, error: string) {
  const url = new URL('/auth/login', request.nextUrl.origin)
  url.searchParams.set('error', error)
  return NextResponse.redirect(url)
}

// Defesa em profundidade sobre o redirect_to já sanitizado pela API: somente
// caminho relativo interno.
function safeInternalPath(path: unknown): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    return '/'
  }
  return path
}

/**
 * Redirect URI exata cadastrada no client Keycloak. Processamento 100%
 * server-side (ADR-03): o `code` chega por query a esta rota e morre aqui;
 * tokens internos saem somente como cookies httpOnly; todas as respostas são
 * 302 sem corpo (Invariantes US2 — contracts/api-oidc.md §1).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const code = params.get('code')
  const state = params.get('state')
  const providerError = params.get('error')

  // Cancelamento/erro do provedor: redirect de erro sem chamar a API.
  if (providerError) {
    return loginRedirect(request, 'acesso_nao_concluido')
  }
  if (!code || !state) {
    return loginRedirect(request, 'sessao_expirada')
  }

  let backendResponse: Response
  try {
    backendResponse = await fetch(`${BACKEND_URL}/api/v1/auth/keycloak/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    return loginRedirect(request, 'sso_indisponivel')
  }

  let body: any = null
  try {
    body = await backendResponse.json()
  } catch {
    body = null
  }

  if (!backendResponse.ok) {
    return loginRedirect(request, mapApiError(backendResponse.status, body?.detail?.code))
  }

  const tokens = body?.tokens
  if (!tokens?.access_token || !tokens?.refresh_token) {
    return loginRedirect(request, 'login_invalido')
  }

  const destination = new URL(safeInternalPath(body?.redirect_to), request.nextUrl.origin)
  const response = NextResponse.redirect(destination)
  const cookieOptions = getCookieOptions(request)

  response.cookies.set(ACCESS_TOKEN_COOKIE, tokens.access_token, {
    ...cookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE,
  })
  response.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refresh_token, {
    ...cookieOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  })
  // Marcador não-httpOnly: o cliente sabe que existe sessão sem rede — o
  // token em si permanece httpOnly (mesmo padrão do proxy de auth).
  response.cookies.set('LH_session', '1', {
    ...cookieOptions,
    httpOnly: false,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  })

  return response
}
