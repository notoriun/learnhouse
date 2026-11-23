/**
 * US2 — e-mail não verificado é recusado na admissão, sem conta criada.
 *
 * A distinção fina que esta jornada guarda: o **provedor** aceita a credencial e
 * emite o código de autorização; é a **plataforma** que recusa na admissão. Se o
 * realm ligasse `verifyEmail`, o Keycloak barraria antes e esta recusa — que é a
 * que a especificação pede em US2 cenário 2 — nunca seria exercitada (D-06.1).
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { CREDENTIALS } from '../config'
import { platformSessionCookies } from '../verify'
import { getOrg, login as apiLogin } from '../api'
import { req } from '../../../core/client'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'
import { title } from '../coverage'

async function contaLocalExiste(email: string): Promise<boolean> {
  const token = await apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await getOrg()
  const page = await req<any>(
    'GET',
    `/users/${org.id}?search=${encodeURIComponent(email)}&limit=100`,
    token,
  ).catch(() => null)
  const lista: any[] = page?.users ?? page?.items ?? (Array.isArray(page) ? page : [])
  return lista.some((u) => (u.email ?? '').toLowerCase() === email.toLowerCase())
}

test(title('us2-unverified'), async ({ page, context }) => {
  const login = new LoginPage(page)
  const provider = new ProviderPage(page)
  const cred = CREDENTIALS.nao_verificado

  const existiaAntes = await contaLocalExiste(cred.identifier)
  expect(
    existiaAntes,
    `a conta local ${cred.identifier} não deveria existir antes desta jornada — ` +
      'se existe, uma execução anterior a deixou e o resultado deixa de ser conclusivo',
  ).toBe(false)

  await test.step('o provedor aceita a credencial e emite o código', async () => {
    await login.goto()
    await login.expectSsoOptionVisible()
    await login.clickSsoLogin()
    await page.waitForURL(/\/realms\//, { timeout: 30_000 })
    await provider.authenticate(cred.identifier, cred.secret)
    // Sai do provedor: a autenticação em si teve êxito.
    await page.waitForURL((url) => !url.pathname.includes('/realms/'), { timeout: 30_000 })
  })

  await test.step('a plataforma recusa a admissão, sem emitir sessão', async () => {
    const cookies = await platformSessionCookies(context)
    expect(
      cookies,
      `admissão recusada não pode emitir sessão, mas emitiu: ${cookies.join(', ')}`,
    ).toHaveLength(0)
  })

  await test.step('nenhuma conta local foi criada', async () => {
    expect(
      await contaLocalExiste(cred.identifier),
      `a recusa criou a conta ${cred.identifier} — não deveria`,
    ).toBe(false)
  })

  await test.step('a pessoa recebe o motivo da recusa NA TELA', async () => {
    // Esta asserção começou fraca e deixou passar meio defeito. A versão
    // anterior só checava (a) que a URL trazia `?error=` e (b) que a página não
    // era um 404 — e passava mesmo com a mensagem invisível, porque o bloco de
    // erro da tela é `{showErrorModal && ...}` e o caminho de SSO nunca ligava
    // esse sinal. Duas camadas do mesmo defeito: caminho errado (404) E mensagem
    // não renderizada. A asserção agora exige o que a pessoa precisa: **ler** o
    // motivo.
    const url = page.url()
    expect(url, 'o motivo deveria vir na URL').toMatch(/[?&]error=/)
    await expect(
      page.getByText(/404|não existe ou foi removida/i),
      'a recusa não pode levar a uma página inexistente',
    ).toHaveCount(0)

    // Texto orientativo de `conta_nao_encontrada`, nos dois idiomas do produto.
    await expect(
      page
        .getByText(
          /identidade corporativa foi validada|corporate identity was validated|não há uma conta correspondente|no matching account/i,
        )
        .first(),
      `a mensagem de recusa não apareceu na tela. URL: ${url}. ` +
        'Sem ela a pessoa é recusada e não descobre por quê.',
    ).toBeVisible({ timeout: 15_000 })
  })
})
