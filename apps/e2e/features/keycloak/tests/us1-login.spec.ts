/**
 * US1 — a jornada central: entrar por identidade corporativa e sair com sessão
 * utilizável.
 *
 * É a jornada que mais risco carrega. Se ela estiver quebrada, nenhuma das
 * outras importa — e é exatamente a que hoje só se verifica à mão, sem
 * reprodutibilidade.
 *
 * Toda a autenticação acontece na tela do provedor real, dirigida pelo
 * navegador (FR-001). A conferência final não é "existe cookie", e sim
 * "consegue acessar área autenticada": um cookie presente mas recusado pelo
 * servidor é um estado distinto, e confundir os dois esconderia defeito.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { CREDENTIALS, BASE_URL } from '../config'
import { canReachAuthenticatedArea, platformSessionCookies } from '../verify'
import { title } from '../coverage'

test(title('us1-login'), async ({ page, context }) => {
  const login = new LoginPage(page)
  const provider = new ProviderPage(page)
  const cred = CREDENTIALS.verificado

  await test.step('a tela de entrada oferece a opção corporativa', async () => {
    await login.goto()
    await login.expectSsoOptionVisible()
  })

  await test.step('a opção leva à tela de autenticação do provedor real', async () => {
    await login.clickSsoLogin()
    await page.waitForURL(/\/realms\//, { timeout: 30_000 })
    expect(provider.isOnProvider(), 'o navegador deveria estar no provedor').toBe(true)
    await provider.waitForLoginForm()
  })

  await test.step('a autenticação no provedor devolve a pessoa autenticada', async () => {
    await provider.authenticate(cred.identifier, cred.secret)
    // O retorno passa pelo callback do BFF, que grava os cookies e redireciona.
    await page.waitForURL((url) => !url.pathname.includes('/realms/'), { timeout: 30_000 })

    const erro = login.currentError()
    expect(
      erro,
      `a plataforma recusou a admissão com "${erro}". Se for conta_nao_encontrada, ` +
        'confira a pré-condição de conta local de vínculo (D-14).',
    ).toBeNull()
  })

  await test.step('a sessão emitida é utilizável', async () => {
    const cookies = await platformSessionCookies(context)
    expect(cookies.length, 'nenhum cookie de sessão da plataforma foi emitido').toBeGreaterThan(0)

    const dentro = await canReachAuthenticatedArea(page, BASE_URL)
    expect(dentro, 'a sessão existe mas não dá acesso a área autenticada').toBe(true)
  })
})
