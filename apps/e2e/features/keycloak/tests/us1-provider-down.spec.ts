/**
 * US1 — provedor indisponível não derruba sessão interna já ativa, e uma nova
 * entrada reprova classificando indisponibilidade.
 *
 * Esta é a única jornada do módulo que **altera o estado do ambiente**: ela para
 * o contêiner do provedor. Por isso não é paralelizável, e por isso restaura o
 * provedor num `afterAll` que roda mesmo se a jornada falhar no meio — sem essa
 * restauração, a própria jornada quebraria a repetibilidade que FR-009 exige de
 * todas as outras.
 *
 * Serve também como a prova viva de SC-005: sabotar o provedor deve produzir
 * *indisponibilidade de serviço*, nunca *defeito de produto*.
 */
import { test, expect } from '../../../core/fixtures'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { CREDENTIALS, BASE_URL } from '../config'
import { canReachAuthenticatedArea } from '../verify'
import { isProviderReachable } from '../provider'
import { authorizeExpectingError } from '../api'
import { title } from '../coverage'

const exec = promisify(execFile)

const COMPOSE_FILE = process.env.KC_COMPOSE_FILE || 'docker-compose.local.yml'
const COMPOSE_CWD = process.env.KC_COMPOSE_CWD || '../..'

async function compose(...args: string[]): Promise<void> {
  await exec('docker', ['compose', '-f', COMPOSE_FILE, ...args], { cwd: COMPOSE_CWD })
}

async function waitForProvider(up: boolean, timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await isProviderReachable()) === up) return true
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

// Serial de propósito: o estado do ambiente é compartilhado.
test.describe.configure({ mode: 'serial' })

test.describe('provedor indisponível', () => {
  test.afterAll(async () => {
    // Restauração incondicional (T030). Se isto falhar, todas as execuções
    // seguintes reprovariam na pré-condição de disponibilidade — que é o
    // comportamento correto, mas péssimo diagnóstico se a causa não for dita.
    await compose('start', 'keycloak').catch(() => undefined)
    const voltou = await waitForProvider(true)
    if (!voltou) {
      throw new Error(
        'o provedor NÃO voltou após a jornada. Restaure à mão antes de executar de novo: ' +
          `docker compose -f ${COMPOSE_FILE} start keycloak`,
      )
    }
  })

  test(title('us1-provider-down'), async ({ page, context }) => {
    const login = new LoginPage(page)
    const provider = new ProviderPage(page)
    const cred = CREDENTIALS.verificado

    await test.step('entra normalmente, com o provedor no ar', async () => {
      await login.goto()
      await login.expectSsoOptionVisible()
      await login.clickSsoLogin()
      await page.waitForURL(/\/realms\//, { timeout: 30_000 })
      await provider.authenticate(cred.identifier, cred.secret)
      await page.waitForURL((url) => !url.pathname.includes('/realms/'), { timeout: 30_000 })
      expect(await canReachAuthenticatedArea(page, BASE_URL)).toBe(true)
    })

    await test.step('o provedor sai do ar', async () => {
      await compose('stop', 'keycloak')
      expect(await waitForProvider(false), 'o provedor continuou respondendo').toBe(true)
    })

    await test.step('a sessão interna já ativa segue utilizável', async () => {
      // O ponto de FR-011: a plataforma emite a própria sessão e não depende do
      // provedor para honrá-la. Se isto falhar, uma indisponibilidade do
      // provedor derruba todo mundo que já estava dentro.
      const aindaDentro = await canReachAuthenticatedArea(page, BASE_URL)
      expect(
        aindaDentro,
        'a sessão interna deixou de valer quando o provedor caiu — viola FR-011 (001)',
      ).toBe(true)
    })

    await test.step('nenhuma entrada nova se completa enquanto o provedor está fora', async () => {
      // Nota sobre o que NÃO se pode exigir aqui: a criação do fluxo pode
      // responder 200 mesmo com o provedor parado, porque o documento de
      // descoberta fica em cache na aplicação. Isso é comportamento legítimo —
      // e exigir 503 tornava esta jornada dependente de o cache estar frio, ou
      // seja, do que rodou antes dela. Verificado na instância: com cache
      // quente, a criação do fluxo devolve 200 com o provedor parado.
      //
      // O que é determinístico, e é o que a pessoa de fato vive: a tela de
      // autenticação do provedor não carrega, e nenhuma sessão nova nasce.
      const { authorize } = await import('../api')
      const criacao = await authorize().catch((e) => e as Error)

      if (criacao instanceof Error) {
        // Cache frio: a aplicação reporta indisponibilidade. Também aceitável.
        const erro = await authorizeExpectingError()
        expect(
          erro.status,
          `com cache frio esperava-se 503, veio ${erro.status}: ${erro.body}`,
        ).toBe(503)
        expect(erro.code ?? '').toMatch(/SSO_INDISPONIVEL/i)
        return
      }

      // Cache quente: a URL é montada, mas o provedor não atende.
      const navegacao = await page
        .goto(criacao.authorization_url, { timeout: 20_000 })
        .catch(() => null)
      const alcancouProvedor =
        navegacao !== null && navegacao.ok() && (await provider.stayedOnLoginForm())
      expect(
        alcancouProvedor,
        'a tela de autenticação do provedor carregou apesar de o provedor estar parado',
      ).toBe(false)
    })

    await test.step('o provedor volta e o ambiente fica utilizável de novo', async () => {
      await compose('start', 'keycloak')
      expect(await waitForProvider(true), 'o provedor não voltou').toBe(true)
      // Sem esta conferência, a jornada poderia deixar o ambiente meio-subido e
      // contaminar a execução seguinte.
      await context.clearCookies()
      await login.goto()
      await login.expectSsoOptionVisible()
    })
  })
})
