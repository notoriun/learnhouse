/**
 * US4 — conta federada recusa troca local de senha e de e-mail.
 *
 * Define a fronteira de propriedade da credencial: dono da senha é o provedor.
 * Se a plataforma aceitasse a troca local, a senha divergiria da do provedor — a
 * pessoa teria duas credenciais para a mesma conta, uma delas sem efeito no
 * login corporativo, e nenhuma indicação de qual é qual.
 *
 * Os dois pontos guardados estão em `apps/api/src/services/users/users.py`, via
 * `ensure_not_platform_federated`: a troca de senha
 * (`PUT /users/change_password/{id}`) e a troca de e-mail (`PUT /users/{id}`,
 * apenas quando o endereço muda de fato).
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { CREDENTIALS, BASE_URL } from '../config'
import { canReachAuthenticatedArea } from '../verify'
import { comSessao, perfilAtual } from '../session-request'
import { title } from '../coverage'

test(title('us4-federated-guards'), async ({ page }) => {
  const login = new LoginPage(page)
  const provider = new ProviderPage(page)
  const cred = CREDENTIALS.verificado

  await test.step('entra por identidade corporativa (a conta fica federada)', async () => {
    await login.goto()
    await login.expectSsoOptionVisible()
    await login.clickSsoLogin()
    await page.waitForURL(/\/realms\//, { timeout: 30_000 })
    await provider.authenticate(cred.identifier, cred.secret)
    await page.waitForURL((url) => !url.pathname.includes('/realms/'), { timeout: 30_000 })
    expect(await canReachAuthenticatedArea(page, BASE_URL)).toBe(true)
  })

  const perfil = await perfilAtual(page)
  expect(perfil?.id, 'sem id do usuário não há como exercitar as guardas').toBeTruthy()

  await test.step('a troca local de senha é recusada como conta federada', async () => {
    const r = await comSessao(page, 'PUT', `/users/change_password/${perfil!.id}`, {
      old_password: cred.secret,
      new_password: 'NovaSenhaLocal!234',
    })
    expect(
      r.status,
      `esperada recusa da troca de senha em conta federada, veio ${r.status}: ${r.body}`,
    ).toBe(403)
    expect(r.body, 'a recusa deveria identificar a conta como federada').toMatch(/CONTA_FEDERADA/i)
  })

  await test.step('a troca local de e-mail é recusada como conta federada', async () => {
    // `PUT /users/{id}` recebe o modelo completo: `username` e `email` são
    // obrigatórios. Enviar só o campo alterado devolve 422 de validação, que
    // esconderia a guarda em vez de exercitá-la.
    const r = await comSessao(page, 'PUT', `/users/${perfil!.id}`, {
      username: perfil!.username,
      email: `outro-${perfil!.id}@e2e-tests.com`,
    })
    expect(
      r.status,
      `esperada recusa da troca de e-mail em conta federada, veio ${r.status}: ${r.body}`,
    ).toBe(403)
    expect(r.body).toMatch(/CONTA_FEDERADA/i)
  })
})
