/**
 * US4 — o resto do perfil segue editável em conta federada.
 *
 * Jornada de contraste indispensável: sem ela, as duas anteriores passariam
 * mesmo se a plataforma tivesse travado o perfil **inteiro** para contas
 * federadas. A regra é cirúrgica — senha e e-mail são do provedor; nome,
 * biografia e avatar continuam da plataforma.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { CREDENTIALS, BASE_URL } from '../config'
import { canReachAuthenticatedArea } from '../verify'
import { comSessao, perfilAtual } from '../session-request'
import { RUN_SUFFIX } from '../fixtures'
import { title } from '../coverage'

test(title('us4-profile-editable'), async ({ page }) => {
  const login = new LoginPage(page)
  const provider = new ProviderPage(page)
  const cred = CREDENTIALS.verificado

  await test.step('entra por identidade corporativa', async () => {
    await login.goto()
    await login.expectSsoOptionVisible()
    await login.clickSsoLogin()
    await page.waitForURL(/\/realms\//, { timeout: 30_000 })
    await provider.authenticate(cred.identifier, cred.secret)
    await page.waitForURL((url) => !url.pathname.includes('/realms/'), { timeout: 30_000 })
    expect(await canReachAuthenticatedArea(page, BASE_URL)).toBe(true)
  })

  const perfil = await perfilAtual(page)
  expect(perfil?.id).toBeTruthy()

  await test.step('biografia e nome são aceitos em conta federada', async () => {
    const bio = `bio-${RUN_SUFFIX}`
    // `username` e `email` são obrigatórios no modelo. O e-mail vai INALTERADO
    // de propósito: a guarda de conta federada só dispara quando ele muda, e é
    // exatamente isso que esta jornada precisa confirmar — a regra é cirúrgica,
    // não um travamento geral do perfil.
    const r = await comSessao(page, 'PUT', `/users/${perfil!.id}`, {
      username: perfil!.username,
      email: perfil!.email,
      bio,
      first_name: 'Teste',
      last_name: `Federada-${RUN_SUFFIX}`,
    })
    expect(
      r.status,
      `a edição de perfil comum deveria ser aceita, veio ${r.status}: ${r.body}`,
    ).toBe(200)

    // Confirma que persistiu, e não apenas que a chamada devolveu 200.
    const depois = await perfilAtual(page)
    const lido = await comSessao(page, 'GET', '/users/profile')
    expect(depois).not.toBeNull()
    expect(lido.body, 'a biografia não persistiu').toContain(bio)
  })
})
