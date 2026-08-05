import { NextRequest } from 'next/server'
import { getConfig } from '@services/config/config'

const CONFIGURED_ORIGIN = (
  getConfig('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL') || ''
).replace(/\/+$/, '')
const TOP_DOMAIN = (
  getConfig('NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN') || ''
).toLowerCase()

// Host aceitável = o próprio top domain ou um subdomínio dele (tenancy
// multi-org usa slug.topdomain). Qualquer outro host cai no origin
// configurado — nunca refletimos header arbitrário em redirect (open
// redirect via Host/X-Forwarded-Host).
// ponytail: domínios custom (EE) caem no origin configurado; allow-list
// dinâmica por org se isso virar necessidade.
function isAllowedHost(bareHost: string): boolean {
  if (!TOP_DOMAIN) return false
  return bareHost === TOP_DOMAIN || bareHost.endsWith(`.${TOP_DOMAIN}`)
}

/**
 * Origin público visto pelo navegador. Atrás do nginx embutido,
 * `request.nextUrl.origin` resolve para o bind interno do Next
 * (http://0.0.0.0:8000) e o redirect quebra no navegador
 * (net::ERR_ADDRESS_INVALID) — derive de Host/X-Forwarded-* validados
 * contra o domínio configurado.
 */
export function publicOrigin(request: NextRequest): string {
  const host = (
    request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
  ).toLowerCase()
  const bareHost = host.split(':')[0]
  if (host && isAllowedHost(bareHost)) {
    const forwardedProto = request.headers.get('x-forwarded-proto')
    const proto =
      forwardedProto === 'http' || forwardedProto === 'https'
        ? forwardedProto
        : bareHost === 'localhost' || bareHost.startsWith('127.')
          ? 'http'
          : 'https'
    return `${proto}://${host}`
  }
  if (CONFIGURED_ORIGIN) return CONFIGURED_ORIGIN
  return request.nextUrl.origin
}
