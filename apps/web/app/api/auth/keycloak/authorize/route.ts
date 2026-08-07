import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@services/config/config'
import { publicOrigin } from '@services/auth/public-origin'

const BACKEND_URL = (
  getConfig('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL') || 'http://localhost:1338'
).replace(/\/+$/, '')

// Slug de organização: nunca ecoamos entrada não sanitizada em URLs (US2).
const ORG_SLUG_RE = /^[a-z0-9][a-z0-9-_]{0,62}$/i

function loginRedirect(request: NextRequest, org: string | null, error: string) {
  // `/login`, não `/auth/login`: `/auth/*` é destino interno da reescrita em
  // proxy.ts e responde 404 quando pedido de fora. Ver o comentário equivalente
  // em ../callback/route.ts.
  const url = new URL('/login', publicOrigin(request))
  if (org && ORG_SLUG_RE.test(org)) url.searchParams.set('org', org)
  url.searchParams.set('error', error)
  return NextResponse.redirect(url)
}

/**
 * Inicia o login corporativo: chama o FastAPI server-side e redireciona o
 * navegador ao Keycloak. Nenhum corpo JSON é exposto ao navegador — apenas
 * redirects (contracts/api-oidc.md §1).
 */
export async function GET(request: NextRequest) {
  const org = request.nextUrl.searchParams.get('org')
  // Feature 007: action=register leva à tela de registro do provedor da
  // plataforma; qualquer outro valor é tratado como login (contrato §2).
  const action = request.nextUrl.searchParams.get('action') === 'register' ? 'register' : 'login'
  // Feature 009: um `redirect` na query é deliberadamente IGNORADO. O destino
  // pós-acesso é derivado da organização no callback, então não há destino a
  // transportar — e sem entrada do usuário no cálculo, o vetor de open redirect
  // deixa de existir em vez de depender de sanitização.

  if (!org || !ORG_SLUG_RE.test(org)) {
    return loginRedirect(request, null, 'sso_nao_disponivel')
  }

  let backendResponse: Response
  try {
    backendResponse = await fetch(`${BACKEND_URL}/api/v1/auth/keycloak/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_slug: org, action }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return loginRedirect(request, org, 'sso_indisponivel')
  }

  if (!backendResponse.ok) {
    const error = backendResponse.status === 503 ? 'sso_indisponivel' : 'sso_nao_disponivel'
    return loginRedirect(request, org, error)
  }

  let authorizationUrl: string | undefined
  try {
    const body = await backendResponse.json()
    authorizationUrl = body?.authorization_url
  } catch {
    authorizationUrl = undefined
  }
  if (!authorizationUrl || !/^https?:\/\//.test(authorizationUrl)) {
    return loginRedirect(request, org, 'sso_indisponivel')
  }

  return NextResponse.redirect(authorizationUrl)
}
