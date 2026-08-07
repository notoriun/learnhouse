/**
 * US2 — e-mail coincidente não vincula automaticamente identidade externa.
 *
 * A regra que isto protege é a mais perigosa de errar em federação: tratar
 * coincidência de e-mail como prova de identidade. Se a plataforma vinculasse
 * por e-mail sem política explícita, qualquer pessoa capaz de registrar um
 * endereço no provedor assumiria a conta local correspondente.
 *
 * O ambiente local tem uma organização, então o cenário "e-mail em outra
 * organização" não é montável aqui. O que é montável, e é o mesmo princípio: uma
 * identidade nova no provedor cujo e-mail **não** tem conta local não entra — a
 * coincidência de e-mail não é criada nem inferida.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { newProviderIdentity, cleanupProviderIdentities } from '../fixtures'
import { platformSessionCookies } from '../verify'
import { title } from '../coverage'

test.afterAll(async () => {
  await cleanupProviderIdentities()
})

test(title('us2-identity-conflict'), async ({ page, context }) => {
  const login = new LoginPage(page)
  const provider = new ProviderPage(page)

  // Identidade que existe no provedor com e-mail já verificado, mas sem conta
  // local correspondente. É o caso em que um vínculo automático seria o defeito.
  const identidade = await newProviderIdentity('conflito', { emailVerified: true })

  await test.step('a identidade autentica no provedor', async () => {
    await login.goto()
    await login.expectSsoOptionVisible()
    await login.clickSsoLogin()
    await page.waitForURL(/\/realms\//, { timeout: 30_000 })
    await provider.authenticate(identidade.email, identidade.password)
    await page.waitForURL((url) => !url.pathname.includes('/realms/'), { timeout: 30_000 })
  })

  await test.step('a plataforma não cria nem vincula conta por conta própria', async () => {
    const cookies = await platformSessionCookies(context)
    expect(
      cookies,
      'identidade sem conta local correspondente não pode receber sessão — ' +
        `emitiu: ${cookies.join(', ')}`,
    ).toHaveLength(0)
  })
})

test.skip(
  'us2-identity-conflict-outra-org — BLOQUEADO POR AMBIENTE: o cenário "e-mail coincide com conta ' +
    'de outra organização" exige duas organizações com membros distintos, e o ambiente local sobe ' +
    'com organização única (NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG=False). A recusa por ' +
    'email_em_outra_organizacao permanece sem cobertura ponta a ponta aqui.',
  async () => {
    // Intencionalmente vazio: declara a lacuna no relatório.
  },
)
