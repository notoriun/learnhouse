/**
 * Leitura de estado pela API REST da plataforma.
 *
 * Toda conferência de resultado passa por aqui — a validação nunca consulta
 * PostgreSQL nem Redis direto (Princípio I: apps consomem interfaces
 * publicadas). Constrói sobre o cliente genérico em `core/`.
 *
 * Contratos consumidos: specs/008-testes-keycloak-local/contracts/interfaces-consumidas.md
 */
import { req } from '../../core/client'
import { API_URL } from '../../core/instance'
import { ORG_SLUG } from './config'

// Superfície única de import para as jornadas.
export { login, getOrg, createStudent } from '../../core/client'
export type { Org } from '../../core/client'

export interface KeycloakStatus {
  /** Provedor efetivo configurado E método SSO permitido na organização. */
  enabled: boolean
  /** `enabled` E o provedor efetivo é o da plataforma — libera o registro. */
  platform: boolean
}

/**
 * Disponibilidade do login corporativo para a organização.
 *
 * Público e deliberadamente anti-enumeração: organização desconhecida responde
 * igual a organização sem SSO. A validação preserva esse comportamento em vez
 * de contorná-lo.
 */
export function getKeycloakStatus(org = ORG_SLUG): Promise<KeycloakStatus> {
  return req<KeycloakStatus>('GET', `/auth/keycloak/status?org=${encodeURIComponent(org)}`, null)
}

export interface AuthorizeResponse {
  authorization_url: string
  state: string
}

/** Cria o fluxo OIDC e devolve a URL de autorização do provedor. */
export function authorize(
  opts: { org?: string; action?: 'login' | 'register'; redirectTo?: string } = {},
): Promise<AuthorizeResponse> {
  return req<AuthorizeResponse>('POST', '/auth/keycloak/authorize', null, {
    org_slug: opts.org ?? ORG_SLUG,
    action: opts.action ?? 'login',
    ...(opts.redirectTo ? { redirect_to: opts.redirectTo } : {}),
  })
}

export interface ApiError {
  status: number
  code?: string
  body: string
}

/**
 * Variante de `authorize` que devolve o erro em vez de lançar.
 *
 * As jornadas de recusa precisam inspecionar código e status — `req` lança em
 * resposta não-ok, o que perderia o código de erro que a jornada comprova.
 */
export async function authorizeExpectingError(
  opts: { org?: string; action?: 'login' | 'register' } = {},
): Promise<ApiError> {
  const res = await fetch(`${API_URL}/auth/keycloak/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      org_slug: opts.org ?? ORG_SLUG,
      action: opts.action ?? 'login',
    }),
  })
  const body = await res.text()
  let code: string | undefined
  try {
    const parsed = JSON.parse(body)
    code = parsed?.detail?.code ?? parsed?.code
  } catch {
    /* corpo não-JSON: mantém apenas o texto */
  }
  return { status: res.status, code, body }
}

export interface InstanceInfo {
  /** Central de conta do provedor — comparada com o realm em US4. */
  account_console_url?: string
  [key: string]: unknown
}

export function getInstanceInfo(): Promise<InstanceInfo> {
  return req<InstanceInfo>('GET', '/instance/info', null)
}

/** Rota de saúde. Nunca lança — usada em pré-condição. */
export async function isPlatformHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`)
    return res.ok
  } catch {
    return false
  }
}

/** Parâmetros de query da URL de autorização, para as jornadas de US1. */
export function authorizationParams(authorizationUrl: string): URLSearchParams {
  return new URL(authorizationUrl).searchParams
}
