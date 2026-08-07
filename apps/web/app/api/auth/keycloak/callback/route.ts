import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@services/config/config'
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE,
  REFRESH_TOKEN_MAX_AGE,
  getCookieOptions,
} from '@services/auth/cookies'
import { publicOrigin } from '@services/auth/public-origin'

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
  // `/login` — NÃO `/auth/login`. O segmento `/auth` é destino interno da
  // reescrita feita em proxy.ts (`authPaths` → `/auth${pathname}`), que também
  // anexa os cabeçalhos de tenant. Pedir `/auth/login` de fora não casa com
  // essa lista, cai no catch-all tenant-scoped e vira `/orgs/{slug}/auth/login`
  // — rota inexistente. O resultado era um 404 que engolia toda mensagem de
  // recusa, apesar de a tela de entrada já mapear todos estes códigos de erro.
  const url = new URL('/login', publicOrigin(request))
  url.searchParams.set('error', error)
  return NextResponse.redirect(url)
}

// Slug de organização aceito num hostname. A API é a fonte do valor, mas ele
// entra num nome de host — validar aqui é defesa em profundidade.
const ORG_SLUG_RE = /^[a-z0-9][a-z0-9-_]{0,62}$/i

/**
 * Modo de hospedagem, pela fonte autoritativa: `instance/info` do backend.
 *
 * NÃO usa `getTenancy()` de @services/config: aquele getter lê o cookie
 * `LH_tenancy`, que só existe no navegador — num route handler ele sempre
 * devolveria `single`, e em multi-org o destino cairia no ápice (o seletor de
 * organizações), justamente o defeito que esta rota corrige. Também não usa
 * `NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG`: env stale de deploy antigo já produziu
 * hosts inválidos no passado (ver comentário em services/config/config.ts).
 *
 * Falha na consulta → `single`, que mantém o destino no host atual. É o
 * comportamento seguro: nunca atravessa para um host que talvez não resolva.
 */
async function getTenancyMode(): Promise<'multi' | 'single'> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/instance/info`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return 'single'
    const info = await res.json()
    return info?.tenancy === 'multi' || info?.multi_org_enabled ? 'multi' : 'single'
  } catch {
    return 'single'
  }
}

/**
 * Destino pós-acesso: a raiz do host da organização — que é a área com menu.
 *
 * O caminho é sempre `/`: o catch-all do proxy reescreve `/` para
 * `/orgs/{slug}/`, o grupo de rotas `(withmenu)`. Só o host varia:
 *
 * - `single`: o host que atendeu o callback já é o da organização.
 * - `multi`: a redirect_uri cadastrada aterra no ápice, então é preciso
 *   atravessar para `{slug}.{ápice}` — preservando protocolo e porta. Cookies
 *   de sessão em multi usam domínio `.{topDomain}`, então a sessão gravada aqui
 *   é legível lá (ver getCookieOptions).
 *
 * Nenhum valor vindo do usuário participa deste cálculo (feature 009): não há
 * open redirect a sanitizar porque não há entrada a sanitizar.
 */
async function orgDestination(request: NextRequest, orgSlug: unknown): Promise<URL> {
  const origin = new URL(publicOrigin(request))
  if (typeof orgSlug !== 'string' || !ORG_SLUG_RE.test(orgSlug)) {
    return new URL('/', origin)
  }
  if ((await getTenancyMode()) !== 'multi') {
    return new URL('/', origin)
  }
  // Já estamos no host da organização? Prefixar de novo daria `slug.slug.dom`.
  const slugPrefix = `${orgSlug.toLowerCase()}.`
  if (!origin.hostname.toLowerCase().startsWith(slugPrefix)) {
    origin.hostname = `${orgSlug}.${origin.hostname}`
  }
  return new URL('/', origin)
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

  const destination = await orgDestination(request, body?.org_slug)
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
  // Marcador de sessão federada: permite ao cliente rotear o logout ao fluxo
  // RP-Initiated (feature 003). Não-httpOnly, sem token.
  response.cookies.set('LH_sso', '1', {
    ...cookieOptions,
    httpOnly: false,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  })

  return response
}
