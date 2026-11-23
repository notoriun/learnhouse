/**
 * Cliente REST da administração da configuração OIDC por organização
 * (feature 004). Implementação AGPL própria — NÃO reutiliza o fluxo SSO
 * Enterprise de `@services/auth/sso` (endpoints inexistentes na API OSS).
 *
 * Cobre os 4 endpoints de contracts/admin-oidc-api.md:
 *   GET/PUT/DELETE /orgs/{orgId}/oidc-config  e  POST /orgs/{orgId}/oidc-config/test
 */

import { getAPIUrl } from '@services/config/config'
import { getErrorMessage as getDetailMessage } from '@services/utils/ts/errorMessage'

// O segredo NUNCA aparece na leitura — apenas `secret_configured`.
export interface OIDCProviderConfigRead {
  id: number
  org_id: number
  issuer_url: string
  client_id: string
  secret_configured: boolean
  scopes: string
  enabled: boolean
  allowed_email_domains: string[]
  auto_provision_users: boolean
  default_role_id: number | null
  required_acr: string | null
  clock_skew_seconds: number
  created_by_user_id: number
  created_at: string | null
  updated_at: string | null
}

// PUT (upsert parcial). `client_secret` é write-only: omitir mantém o atual;
// string não vazia substitui; string vazia é rejeitada pela API (422).
export interface OIDCProviderConfigWrite {
  issuer_url?: string
  client_id?: string
  client_secret?: string
  scopes?: string
  enabled?: boolean
  allowed_email_domains?: string[]
  auto_provision_users?: boolean
  default_role_id?: number | null
  required_acr?: string | null
  clock_skew_seconds?: number
}

export interface OIDCConnectionTestResult {
  status: 'ok' | 'inacessivel' | 'invalida'
  detail: string
  discovered_endpoints: Record<string, string> | null
}

function authHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

/** Lê a configuração OIDC da org; `null` quando ainda não configurada (404). */
export async function getOIDCConfig(
  orgId: number,
  accessToken: string
): Promise<OIDCProviderConfigRead | null> {
  const response = await fetch(`${getAPIUrl()}orgs/${orgId}/oidc-config`, {
    method: 'GET',
    headers: authHeaders(accessToken),
    credentials: 'include',
  })
  if (response.status === 404) return null
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(getDetailMessage(error?.detail, 'Falha ao carregar a configuração OIDC'))
  }
  return response.json()
}

/** Cria ou atualiza (upsert parcial) a configuração OIDC. */
export async function saveOIDCConfig(
  orgId: number,
  data: OIDCProviderConfigWrite,
  accessToken: string
): Promise<OIDCProviderConfigRead> {
  const response = await fetch(`${getAPIUrl()}orgs/${orgId}/oidc-config`, {
    method: 'PUT',
    headers: authHeaders(accessToken),
    credentials: 'include',
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(getDetailMessage(error?.detail, 'Falha ao salvar a configuração OIDC'))
  }
  return response.json()
}

/** Exclui a configuração (exige confirmação). Contas e vínculos são preservados. */
export async function deleteOIDCConfig(
  orgId: number,
  accessToken: string
): Promise<void> {
  const response = await fetch(
    `${getAPIUrl()}orgs/${orgId}/oidc-config?confirm=true`,
    {
      method: 'DELETE',
      headers: authHeaders(accessToken),
      credentials: 'include',
    }
  )
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(getDetailMessage(error?.detail, 'Falha ao excluir a configuração OIDC'))
  }
}

/**
 * Testa a conexão com o provedor. `issuerUrl` opcional testa um endereço ainda
 * não salvo; omitido, testa o issuer da configuração salva.
 */
export async function testOIDCConnection(
  orgId: number,
  accessToken: string,
  issuerUrl?: string
): Promise<OIDCConnectionTestResult> {
  const response = await fetch(`${getAPIUrl()}orgs/${orgId}/oidc-config/test`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    credentials: 'include',
    body: JSON.stringify(issuerUrl ? { issuer_url: issuerUrl } : {}),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(getDetailMessage(error?.detail, 'Falha ao testar a conexão OIDC'))
  }
  return response.json()
}
