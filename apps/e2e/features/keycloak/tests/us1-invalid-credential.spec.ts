/**
 * US1 — credencial inválida nega acesso sem criar sessão.
 *
 * A asserção que importa é a segunda: *nenhuma sessão foi criada*. "Não entrou"
 * e "não tem sessão" não são a mesma coisa — um fluxo que emitisse sessão e
 * apenas não redirecionasse seria uma falha de segurança que a primeira
 * asserção sozinha não pegaria (FR-008).
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { CREDENTIALS } from '../config'
import { platformSessionCookies } from '../verify'
import { title } from '../coverage'

test(title('us1-invalid-credential'), async ({ page, context }) => {
  const login = new LoginPage(page)
  const provider = new ProviderPage(page)

  await login.goto()
  await login.expectSsoOptionVisible()
  await login.clickSsoLogin()
  await page.waitForURL(/\/realms\//, { timeout: 30_000 })

  await provider.authenticate(CREDENTIALS.verificado.identifier, 'senha-deliberadamente-errada')

  await test.step('o provedor recusa e mantém a pessoa na própria tela', async () => {
    // O provedor não emite código nenhum: a recusa acontece antes de a
    // plataforma ser envolvida.
    expect(await provider.stayedOnLoginForm(), 'o provedor deveria ter recusado').toBe(true)
    const msg = await provider.errorMessage()
    expect(msg, 'o provedor deveria exibir mensagem de recusa').toBeTruthy()
  })

  await test.step('nenhuma sessão da plataforma foi criada', async () => {
    const cookies = await platformSessionCookies(context)
    expect(
      cookies,
      `credencial inválida não pode gerar sessão, mas emitiu: ${cookies.join(', ')}`,
    ).toHaveLength(0)
  })
})
