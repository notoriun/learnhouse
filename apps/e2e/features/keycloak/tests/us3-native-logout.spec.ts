/**
 * US3 — o encerramento nativo continua funcionando, sem depender do provedor.
 *
 * Jornada de contraste, e não redundância: as duas anteriores comprovam que o
 * logout federado coordena os dois sistemas. Esta comprova que a introdução
 * desse mecanismo não passou a exigir o provedor para quem entra por e-mail e
 * senha. Sem ela, uma regressão que roteasse todo logout pelo fluxo federado
 * quebraria contas locais e nenhuma das outras jornadas notaria.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { CREDENTIALS, BASE_URL } from '../config'
import { canReachAuthenticatedArea, platformSessionCookies } from '../verify'
import { newProviderIdentity, cleanupProviderIdentities, ephemeralLabel, senhaValida } from '../fixtures'
import { getOrg, login as apiLogin, createStudent } from '../api'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'
import { EPHEMERAL_EMAIL_DOMAIN } from '../config'
import { title } from '../coverage'

test.afterAll(async () => {
  await cleanupProviderIdentities()
})

test(title('us3-native-logout'), async ({ page, context }) => {
  const login = new LoginPage(page)

  // Conta puramente local: nasce e morre na plataforma, sem vínculo federado.
  const sufixo = ephemeralLabel('nativa')
  const email = `local-${sufixo}@${EPHEMERAL_EMAIL_DOMAIN}`
  const senha = senhaValida('nativa')

  await test.step('cria uma conta local e entra por e-mail e senha', async () => {
    const adminToken = await apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD)
    const org = await getOrg()
    await createStudent(adminToken, org.id, {
      email,
      username: `local_${sufixo}`.replace(/-/g, '_'),
      password: senha,
      first_name: 'Local',
      last_name: 'Nativa',
    })

    await login.goto()
    await login.loginWithPassword(email, senha)
    await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 30_000 })
    expect(await canReachAuthenticatedArea(page, BASE_URL)).toBe(true)
  })

  await test.step('sair encerra a sessão sem envolver o provedor', async () => {
    await page.goto(`${BASE_URL}/api/auth/keycloak/logout?redirect=/login`)
    await page.waitForLoadState('domcontentloaded')

    const restantes = await platformSessionCookies(context)
    expect(
      restantes,
      `a sessão nativa não foi encerrada: ${restantes.join(', ')}`,
    ).toHaveLength(0)
    expect(await canReachAuthenticatedArea(page, BASE_URL)).toBe(false)
  })
})
