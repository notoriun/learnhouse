/**
 * US3 — sessão derrubada no provedor deixa de valer na plataforma.
 *
 * É o caminho inverso de `us3-logout`: aqui quem encerra é o provedor, e a
 * plataforma precisa acompanhar. É o cenário real de desligamento de pessoa —
 * a administração revoga no provedor de identidade e espera que o acesso caia
 * em todo lugar.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { CREDENTIALS, BASE_URL } from '../config'
import { canReachAuthenticatedArea } from '../verify'
import { findUserByEmail, logoutUserAtProvider, userSessions } from '../provider'
import { title } from '../coverage'

test(title('us3-provider-revocation'), async ({ page }) => {
  const login = new LoginPage(page)
  const provider = new ProviderPage(page)
  const cred = CREDENTIALS.verificado

  const noProvedor = await findUserByEmail(cred.identifier)
  expect(noProvedor).not.toBeNull()

  await test.step('entra por identidade corporativa', async () => {
    await login.goto()
    await login.expectSsoOptionVisible()
    await login.clickSsoLogin()
    await page.waitForURL(/\/realms\//, { timeout: 30_000 })
    await provider.authenticate(cred.identifier, cred.secret)
    await page.waitForURL((url) => !url.pathname.includes('/realms/'), { timeout: 30_000 })
    expect(await canReachAuthenticatedArea(page, BASE_URL)).toBe(true)
  })

  await test.step('a sessão é encerrada pelo provedor, não pela plataforma', async () => {
    await logoutUserAtProvider(noProvedor!.id)
    const sessoes = await userSessions(noProvedor!.id)
    expect(sessoes.length, 'o provedor não encerrou a própria sessão').toBe(0)
  })

  await test.step('a plataforma deixa de aceitar a sessão', async () => {
    // A revogação pode ser sentida imediatamente (notificação back-channel) ou
    // na renovação seguinte. Tentar por uma janela evita transformar diferença
    // de mecanismo em intermitência — o que FR-009 proíbe.
    const prazo = Date.now() + 45_000
    let aindaDentro = true
    while (Date.now() < prazo) {
      aindaDentro = await canReachAuthenticatedArea(page, BASE_URL)
      if (!aindaDentro) break
      await new Promise((r) => setTimeout(r, 3000))
    }
    expect(
      aindaDentro,
      'a sessão da plataforma continuou valendo depois de o provedor revogá-la — ' +
        'uma pessoa desligada no provedor de identidade manteria acesso',
    ).toBe(false)
  })
})
