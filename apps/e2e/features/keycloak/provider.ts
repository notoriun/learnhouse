/**
 * Leitura e preparo do provedor de identidade real (Keycloak).
 *
 * Fronteira importante: a interface administrativa do realm é usada para
 * **preparar** e **conferir** estado — criar a identidade efêmera de primeiro
 * acesso, listar sessões, disparar o e-mail de verificação. Ela nunca executa a
 * etapa que a jornada precisa comprovar. Autenticar, registrar-se e sair
 * acontecem sempre pelas telas do provedor, dirigidas pelo navegador.
 *
 * Sem essa fronteira, a validação passaria a testar a si mesma (FR-001).
 */
import {
  DISCOVERY_URL,
  PROVIDER_ADMIN,
  PROVIDER_URL,
  REALM,
  CLIENT_ID,
  EPHEMERAL_EMAIL_DOMAIN,
} from './config'

export interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  end_session_endpoint?: string
  jwks_uri: string
}

export interface ProviderUser {
  id: string
  username: string
  email?: string
  emailVerified?: boolean
  enabled?: boolean
}

export interface ProviderSession {
  id: string
  userId: string
  clientId?: string
}

async function json<T>(res: Response, what: string): Promise<T> {
  const text = await res.text()
  if (!res.ok) throw new Error(`${what} -> ${res.status}: ${text.slice(0, 300)}`)
  return (text ? JSON.parse(text) : undefined) as T
}

/** Documento de descoberta do realm. Lança quando o provedor não responde. */
export async function getDiscovery(): Promise<Discovery> {
  const res = await fetch(DISCOVERY_URL)
  return json<Discovery>(res, `GET ${DISCOVERY_URL}`)
}

/** True quando o provedor está atendendo. Nunca lança — é usado em pré-condição. */
export async function isProviderReachable(): Promise<boolean> {
  try {
    const res = await fetch(DISCOVERY_URL)
    return res.ok
  } catch {
    return false
  }
}

// O token administrativo vale poucos minutos e a suíte é serial; um cache
// simples evita uma autenticação por chamada sem introduzir staleness relevante.
let _adminToken: { value: string; expiresAt: number } | null = null

/** Token administrativo do realm `master`. */
export async function adminToken(): Promise<string> {
  if (_adminToken && Date.now() < _adminToken.expiresAt) return _adminToken.value
  const res = await fetch(`${PROVIDER_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'admin-cli',
      username: PROVIDER_ADMIN.username,
      password: PROVIDER_ADMIN.password,
      grant_type: 'password',
    }),
  })
  const data = await json<{ access_token: string; expires_in: number }>(
    res,
    'autenticação administrativa no provedor',
  )
  _adminToken = {
    value: data.access_token,
    // Margem de 30 s para não usar um token que expira no meio da chamada.
    expiresAt: Date.now() + Math.max(0, data.expires_in - 30) * 1000,
  }
  return _adminToken.value
}

async function adminReq<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await adminToken()
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${PROVIDER_URL}/admin/realms/${REALM}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return json<T>(res, `${method} /admin/realms/${REALM}${path}`)
}

/** Configuração do realm — usada para conferir pré-condições de provisionamento. */
export function getRealm(): Promise<Record<string, any>> {
  return adminReq('GET', '')
}

/** Usuário do realm por e-mail, ou null quando não existe. */
export async function findUserByEmail(email: string): Promise<ProviderUser | null> {
  const users = await adminReq<ProviderUser[]>(
    'GET',
    `/users?email=${encodeURIComponent(email)}&exact=true`,
  )
  return users[0] ?? null
}

/** Clients do realm — usado para ler as redirect URIs registradas (D-13). */
export async function findClient(clientId = CLIENT_ID): Promise<Record<string, any> | null> {
  const clients = await adminReq<Record<string, any>[]>(
    'GET',
    `/clients?clientId=${encodeURIComponent(clientId)}`,
  )
  return clients[0] ?? null
}

/** Redirect URIs registradas no client da plataforma. */
export async function registeredRedirectUris(clientId = CLIENT_ID): Promise<string[]> {
  const client = await findClient(clientId)
  return (client?.redirectUris as string[]) ?? []
}

export interface EphemeralIdentity {
  providerId: string
  email: string
  password: string
}

/**
 * Cria no provedor uma identidade que nunca entrou na plataforma.
 *
 * Existe porque as jornadas de primeiro acesso não podem reutilizar a
 * credencial fixa: depois da primeira execução ela já não estaria no primeiro
 * acesso, e o veredito mudaria entre execuções — exatamente a
 * não-repetibilidade que FR-009 proíbe.
 */
export async function createEphemeralIdentity(
  suffix: string,
  opts: { emailVerified?: boolean } = {},
): Promise<EphemeralIdentity> {
  const email = `kc-${suffix}@${EPHEMERAL_EMAIL_DOMAIN}`
  // Componentes fixos garantem maiúscula, minúscula, dígito e símbolo — o
  // sufixo base36 pode sair só com letras.
  const password = `Efemera1!${suffix}9`
  const token = await adminToken()
  const res = await fetch(`${PROVIDER_URL}/admin/realms/${REALM}/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: email,
      email,
      emailVerified: opts.emailVerified ?? false,
      enabled: true,
      firstName: 'Efemera',
      lastName: suffix,
      credentials: [{ type: 'password', value: password, temporary: false }],
    }),
  })
  if (!res.ok && res.status !== 409) {
    throw new Error(`criação de identidade efêmera -> ${res.status}: ${await res.text()}`)
  }
  const user = await findUserByEmail(email)
  if (!user) throw new Error(`identidade efêmera ${email} não encontrada após criação`)
  return { providerId: user.id, email, password }
}

/** Remove a identidade efêmera. Silencioso quando já não existe. */
export async function deleteIdentity(providerId: string): Promise<void> {
  const token = await adminToken()
  await fetch(`${PROVIDER_URL}/admin/realms/${REALM}/users/${providerId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined)
}

/**
 * Pede ao provedor que envie o e-mail de verificação.
 *
 * O envio e a verificação continuam sendo do Keycloak — a validação apenas
 * aciona a ação, porque `verifyEmail` do realm precisa permanecer desligado
 * para não quebrar a jornada do usuário não verificado (D-06.1).
 */
export async function sendVerifyEmail(providerId: string): Promise<void> {
  const token = await adminToken()
  const res = await fetch(
    `${PROVIDER_URL}/admin/realms/${REALM}/users/${providerId}/send-verify-email`,
    { method: 'PUT', headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    throw new Error(`send-verify-email -> ${res.status}: ${await res.text()}`)
  }
}

/** Sessões ativas do usuário no provedor. Vazio = provedor não tem sessão. */
export function userSessions(providerId: string): Promise<ProviderSession[]> {
  return adminReq<ProviderSession[]>('GET', `/users/${providerId}/sessions`)
}

/** Encerra todas as sessões do usuário **pelo provedor** (jornada US3). */
export async function logoutUserAtProvider(providerId: string): Promise<void> {
  const token = await adminToken()
  const res = await fetch(`${PROVIDER_URL}/admin/realms/${REALM}/users/${providerId}/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`logout no provedor -> ${res.status}: ${await res.text()}`)
}
