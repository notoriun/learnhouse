/**
 * US4 — conta local não federada segue trocando a própria senha.
 *
 * O segundo contraste: as guardas de conta federada não podem ter virado uma
 * proibição geral. Uma regressão que aplicasse `ensure_not_platform_federated`
 * a todo mundo travaria a troca de senha de contas locais, e nenhuma das
 * jornadas anteriores perceberia — todas usam a conta federada.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { BASE_URL, EPHEMERAL_EMAIL_DOMAIN } from '../config'
import { canReachAuthenticatedArea } from '../verify'
import { comSessao, perfilAtual } from '../session-request'
import { ephemeralLabel, senhaValida } from '../fixtures'
import { getOrg, login as apiLogin, createStudent } from '../api'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'
import { title } from '../coverage'

test(title('us4-local-account'), async ({ page }) => {
  const login = new LoginPage(page)
  const sufixo = ephemeralLabel('localpwd')
  const email = `local-${sufixo}@${EPHEMERAL_EMAIL_DOMAIN}`
  const senha = senhaValida('antiga')
  const novaSenha = senhaValida('nova')

  await test.step('cria e entra numa conta puramente local', async () => {
    const adminToken = await apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD)
    const org = await getOrg()
    await createStudent(adminToken, org.id, {
      email,
      username: `local_${sufixo}`.replace(/-/g, '_'),
      password: senha,
      first_name: 'Local',
      last_name: 'Senha',
    })

    await login.goto()
    await login.loginWithPassword(email, senha)
    await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 30_000 })
    expect(await canReachAuthenticatedArea(page, BASE_URL)).toBe(true)
  })

  await test.step('a troca da própria senha é permitida', async () => {
    const perfil = await perfilAtual(page)
    expect(perfil?.id).toBeTruthy()

    const r = await comSessao(page, 'PUT', `/users/change_password/${perfil!.id}`, {
      old_password: senha,
      new_password: novaSenha,
    })
    expect(
      r.status,
      `conta local deveria poder trocar a senha, veio ${r.status}: ${r.body}`,
    ).toBe(200)
    expect(r.body, 'a recusa de conta federada não deveria se aplicar aqui').not.toMatch(
      /CONTA_FEDERADA/i,
    )
  })

  await test.step('a senha nova de fato passa a valer', async () => {
    // Sem esta conferência, um 200 que não persistisse passaria como sucesso.
    const novoToken = await apiLogin(email, novaSenha).catch(() => null)
    expect(novoToken, 'a senha nova não autentica — a troca não teve efeito').toBeTruthy()
  })
})
