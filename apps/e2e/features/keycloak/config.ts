/**
 * Origem única de configuração do módulo de Keycloak.
 *
 * Nenhum identificador de credencial, endereço de provedor ou nome de client
 * aparece literal nos testes — tudo passa por aqui. A razão não é elegância: o
 * realm `dev` é provisionado por um arquivo que pode mudar, e um identificador
 * espalhado por 20 arquivos vira 20 pontos de quebra silenciosa.
 *
 * Todos os padrões correspondem ao ambiente do docker-compose.local.yml.
 */
import { BASE_URL, ORG_SLUG } from '../../core/instance'

/** Endereço do provedor de identidade, como o navegador e a API o veem. */
export const PROVIDER_URL = process.env.KC_PROVIDER_URL || 'http://localhost:8080'

/** Realm provisionado por docker/keycloak/realm-dev.json. */
export const REALM = process.env.KC_REALM || 'dev'

/** Issuer esperado — é o que `LEARNHOUSE_KEYCLOAK_ISSUER` deve conter. */
export const ISSUER = `${PROVIDER_URL}/realms/${REALM}`

/** Documento de descoberta do realm. */
export const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`

/** Central de conta do provedor — comparada com `account_console_url` da API. */
export const ACCOUNT_CONSOLE_URL = `${ISSUER}/account`

/** Client confidencial que a plataforma usa como relying party. */
export const CLIENT_ID = process.env.KC_CLIENT_ID || 'learnhouse'

/**
 * Redirect URI registrada no client. A divergência entre esta e a que a
 * plataforma emite é a causa-raiz do defeito D-13 — por isso ela é um valor
 * explícito aqui, e não algo derivado de `BASE_URL`: derivá-la faria a jornada
 * de comparação concordar consigo mesma e nunca detectar a divergência.
 */
export const REGISTERED_REDIRECT_URI = `${BASE_URL}/api/auth/keycloak/callback`

/** Credenciais administrativas do provedor no ambiente local descartável. */
export const PROVIDER_ADMIN = {
  username: process.env.KC_ADMIN_USER || 'admin',
  password: process.env.KC_ADMIN_PASSWORD || 'admin',
}

/** Coletor SMTP descartável (serviço `mailpit` do compose local). */
export const MAILBOX_URL = process.env.KC_MAILBOX_URL || 'http://localhost:8025'

/** Situação que uma credencial de teste representa. */
export type CredentialLabel = 'verificado' | 'nao_verificado'

export interface TestCredential {
  label: CredentialLabel
  /** Identificador de entrada. O realm usa e-mail como nome de usuário. */
  identifier: string
  secret: string
  emailVerified: boolean
}

/**
 * Credenciais previstas pelo realm provisionado.
 *
 * O realm define `registrationEmailAsUsername`, então o Keycloak normaliza o
 * nome de usuário para o e-mail no import — os identificadores de entrada são
 * os e-mails, não os `username` que aparecem no arquivo do realm. Verificado na
 * instância de pé (D-07).
 */
export const CREDENTIALS: Record<CredentialLabel, TestCredential> = {
  verificado: {
    label: 'verificado',
    identifier: process.env.KC_USER_VERIFIED || 'teste@example.com',
    secret: process.env.KC_USER_VERIFIED_PASSWORD || 'teste123',
    emailVerified: true,
  },
  nao_verificado: {
    label: 'nao_verificado',
    identifier: process.env.KC_USER_UNVERIFIED || 'nao-verificado@example.com',
    secret: process.env.KC_USER_UNVERIFIED_PASSWORD || 'teste123',
    emailVerified: false,
  },
}

/**
 * Domínio de e-mail para as identidades que a validação cria.
 *
 * NÃO use `.test`, `.example` nem `.localhost`: o validador de e-mail da
 * aplicação recusa TLD reservado, e a conta simplesmente não é criada.
 */
export const EPHEMERAL_EMAIL_DOMAIN = process.env.KC_EPHEMERAL_DOMAIN || 'e2e-tests.com'

/** Organização exercitada — a que o ambiente local provisiona. */
export { ORG_SLUG, BASE_URL }
