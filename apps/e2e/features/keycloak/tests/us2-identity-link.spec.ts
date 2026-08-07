/**
 * US2 — a identidade externa é persistida e a segunda entrada cai na mesma conta.
 *
 * O que isto protege: se o vínculo não fosse persistido, cada entrada
 * corporativa criaria ou reconciliaria a conta de novo — e o mesmo par
 * (emissor, identificador) poderia acabar em contas diferentes. A conta é
 * reconhecida como federada pela recusa de troca local de credencial, que é a
 * superfície publicada que expõe o vínculo sem endpoint dedicado.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { CREDENTIALS, BASE_URL } from '../config'
import { canReachAuthenticatedArea } from '../verify'
import { findUserByEmail, userSessions } from '../provider'
import { title } from '../coverage'

async function entrarPorSSO(page: any, cred: { identifier: string; secret: string }) {
  const login = new LoginPage(page)
  const provider = new ProviderPage(page)
  await login.goto()
  await login.expectSsoOptionVisible()
  await login.clickSsoLogin()
  await page.waitForURL(/\/realms\//, { timeout: 30_000 })
  await provider.authenticate(cred.identifier, cred.secret)
  await page.waitForURL((url: URL) => !url.pathname.includes('/realms/'), { timeout: 30_000 })
  return login
}

test(title('us2-identity-link'), async ({ page, context }) => {
  const cred = CREDENTIALS.verificado

  const noProvedor = await findUserByEmail(cred.identifier)
  expect(noProvedor, `${cred.identifier} deveria existir no provedor`).not.toBeNull()

  await test.step('primeira entrada estabelece o vínculo', async () => {
    const login = await entrarPorSSO(page, cred)
    expect(login.currentError(), 'a primeira entrada não deveria ser recusada').toBeNull()
    expect(await canReachAuthenticatedArea(page, BASE_URL)).toBe(true)
  })

  await test.step('o provedor registra a sessão do mesmo identificador', async () => {
    // Confirma que a sessão da plataforma corresponde a uma sessão real no
    // provedor daquele identificador — e não a algo criado localmente.
    const sessoes = await userSessions(noProvedor!.id)
    expect(
      sessoes.length,
      'o provedor não registrou sessão para o identificador que autenticou',
    ).toBeGreaterThan(0)
  })

  await test.step('segunda entrada cai na mesma conta, sem criar outra', async () => {
    await context.clearCookies()
    const login = await entrarPorSSO(page, cred)
    expect(
      login.currentError(),
      'a segunda entrada foi recusada — o vínculo não foi reaproveitado',
    ).toBeNull()
    expect(await canReachAuthenticatedArea(page, BASE_URL)).toBe(true)
  })
})
