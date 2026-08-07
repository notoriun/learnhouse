/**
 * US4 — a recusa aponta a central de conta do provedor.
 *
 * Sem esse endereço, a recusa é um beco sem saída: a pessoa descobre que não
 * pode trocar a senha aqui e não descobre onde pode. A plataforma expõe o
 * endereço em `GET /api/v1/instance/info`, e a recusa de conta federada o
 * carrega — as duas fontes têm de concordar com o realm de verdade.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { CREDENTIALS, BASE_URL, ACCOUNT_CONSOLE_URL } from '../config'
import { getInstanceInfo } from '../api'
import { canReachAuthenticatedArea } from '../verify'
import { comSessao, perfilAtual } from '../session-request'
import { title } from '../coverage'

test(title('us4-account-console'), async ({ page }) => {
  const login = new LoginPage(page)
  const provider = new ProviderPage(page)
  const cred = CREDENTIALS.verificado

  await test.step('a plataforma expõe o endereço da central de conta do provedor', async () => {
    const info = await getInstanceInfo()
    expect(
      info.account_console_url,
      'sem account_console_url a interface não tem para onde apontar',
    ).toBeTruthy()
    expect(
      info.account_console_url,
      `a plataforma anuncia "${info.account_console_url}", mas o realm em uso é ${ACCOUNT_CONSOLE_URL}`,
    ).toBe(ACCOUNT_CONSOLE_URL)
  })

  await test.step('a central de conta do provedor realmente existe', async () => {
    // Comparar duas strings não prova que o endereço serve para algo. Uma
    // central de conta desligada no realm daria um endereço válido e inútil.
    const res = await page.goto(ACCOUNT_CONSOLE_URL)
    expect(
      res?.status(),
      `a central de conta do provedor não respondeu em ${ACCOUNT_CONSOLE_URL}`,
    ).toBeLessThan(400)
  })

  await test.step('a recusa de conta federada carrega o endereço', async () => {
    await login.goto()
    await login.expectSsoOptionVisible()
    await login.clickSsoLogin()
    await page.waitForURL(/\/realms\//, { timeout: 30_000 })
    await provider.authenticate(cred.identifier, cred.secret)
    await page.waitForURL((url) => !url.pathname.includes('/realms/'), { timeout: 30_000 })
    expect(await canReachAuthenticatedArea(page, BASE_URL)).toBe(true)

    const perfil = await perfilAtual(page)
    const r = await comSessao(page, 'PUT', `/users/change_password/${perfil!.id}`, {
      old_password: cred.secret,
      new_password: 'NovaSenhaLocal!234',
    })
    expect(r.status).toBe(403)
    expect(
      r.body,
      `a recusa deveria trazer a central de conta do provedor; veio: ${r.body}`,
    ).toContain(ACCOUNT_CONSOLE_URL)
  })
})
