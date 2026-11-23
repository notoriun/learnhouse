/**
 * US1 (feature 009) — o destino pós-acesso é a área da organização com menu.
 *
 * O defeito que isto fixa: a tela de entrada mandava `redirect=/home`, e `/home`
 * é o **seletor de organizações** — o proxy o desvia do roteamento por tenant em
 * qualquer modo de hospedagem. Quem entrava por identidade corporativa nunca
 * chegava ao menu da organização; parava numa página de escolher organização.
 *
 * A jornada afirma três coisas separadas, porque falham por motivos diferentes:
 * a URL final, a presença do menu, e a ausência do seletor de organizações.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { CREDENTIALS, BASE_URL } from '../config'
import { canReachAuthenticatedArea } from '../verify'
import { title } from '../coverage'

test(title('us1-destino-menu'), async ({ page }) => {
  const login = new LoginPage(page)
  const provider = new ProviderPage(page)
  const cred = CREDENTIALS.verificado

  await test.step('percorre o acesso corporativo até o retorno', async () => {
    await login.goto()
    await login.expectSsoOptionVisible()
    await login.clickSsoLogin()
    await page.waitForURL(/\/realms\//, { timeout: 30_000 })
    await provider.authenticate(cred.identifier, cred.secret)
    await page.waitForURL((url) => !url.pathname.includes('/realms/'), { timeout: 30_000 })
    expect(login.currentError(), 'o acesso foi recusado').toBeNull()
  })

  await test.step('a URL final é a raiz do host da organização', async () => {
    // O caminho público da área com menu é `/`: o proxy reescreve `/` para
    // `/orgs/{slug}/`, que é o grupo de rotas `(withmenu)`.
    const url = new URL(page.url())
    expect(
      url.pathname,
      `o destino final foi "${url.pathname}" em vez da raiz da organização`,
    ).toBe('/')
  })

  await test.step('o destino NÃO é o seletor de organizações nem a entrada', async () => {
    const url = new URL(page.url())
    expect(url.pathname, 'caiu no seletor de organizações (/home)').not.toBe('/home')
    expect(url.pathname.startsWith('/home')).toBe(false)
    expect(url.pathname).not.toBe('/login')
    expect(url.search, 'a URL final carrega um erro').not.toContain('error=')
  })

  await test.step('o menu de navegação da organização está presente', async () => {
    // Marcador do layout `(withmenu)`: o <nav aria-label="Top navigation"> do
    // OrgMenu. Verificar a URL sozinha não bastaria — uma raiz que renderizasse
    // outra coisa passaria na asserção anterior.
    const menu = page.getByRole('navigation', { name: /Top navigation/i })
    await expect(
      menu,
      'a página final não tem o menu da organização',
    ).toBeVisible({ timeout: 15_000 })
  })

  await test.step('a sessão continua utilizável no destino', async () => {
    expect(await canReachAuthenticatedArea(page, BASE_URL)).toBe(true)
  })
})
