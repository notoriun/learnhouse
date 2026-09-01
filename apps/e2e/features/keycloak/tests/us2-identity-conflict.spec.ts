/**
 * US2 — coincidência de e-mail não é prova de identidade.
 *
 * A regra que isto protege é a mais perigosa de errar em federação: se a
 * plataforma tratasse e-mail coincidente como prova, quem conseguisse registrar
 * um endereço no provedor assumiria a conta local correspondente.
 *
 * **Reescrita pela feature 009.** Antes, esta jornada comprovava a regra pelo
 * caso "identidade sem conta local não recebe sessão" — o que deixou de ser
 * verdade de propósito: no provedor da plataforma o primeiro acesso agora cria a
 * conta. Continuar afirmando aquilo seria fixar a política antiga.
 *
 * O caso montável que preserva o princípio é a **tentativa de tomada de conta**:
 * uma identidade DIFERENTE (outro `sub`) chega com o e-mail de uma conta que já
 * está vinculada a outra identidade. Isso não pode virar acesso — nem por
 * vínculo, nem por criação.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { newProviderIdentity, cleanupProviderIdentities, ephemeralEmail } from '../fixtures'
import { updateIdentityEmail } from '../provider'
import { platformSessionCookies } from '../verify'
import { title } from '../coverage'

test.afterAll(async () => {
  await cleanupProviderIdentities()
})

async function entrar(page: any, email: string, senha: string) {
  const login = new LoginPage(page)
  const provider = new ProviderPage(page)
  await login.goto()
  await login.expectSsoOptionVisible()
  await login.clickSsoLogin()
  await page.waitForURL(/\/realms\//, { timeout: 30_000 })
  await provider.authenticate(email, senha)
  await page.waitForURL((url: URL) => !url.pathname.includes('/realms/'), { timeout: 30_000 })
  return login
}

test(title('us2-identity-conflict'), async ({ page, context }) => {
  // Dona legítima: primeiro acesso cria a conta, vinculada ao seu `sub`.
  const dona = await newProviderIdentity('conflito-dona', { emailVerified: true })
  const emailDisputado = dona.email

  await test.step('a dona legítima entra e a conta passa a existir', async () => {
    const login = await entrar(page, dona.email, dona.password)
    expect(login.currentError(), 'o primeiro acesso da dona foi recusado').toBeNull()
    const cookies = await platformSessionCookies(context)
    expect(cookies.length, 'a dona legítima deveria receber sessão').toBeGreaterThan(0)
  })

  await test.step('o endereço é liberado no provedor e outra identidade o assume', async () => {
    // A dona troca de e-mail no provedor — a conta local CONTINUA com o
    // endereço antigo, porque a identidade é chaveada por (issuer, sub) e não
    // por e-mail. Isso libera o endereço para outra pessoa no provedor.
    await updateIdentityEmail(dona.providerId, ephemeralEmail('conflito-dona-novo'))
  })

  await test.step('a identidade intrusa NÃO assume a conta pelo e-mail', async () => {
    await context.clearCookies()
    // Mesmo e-mail da conta local, `sub` diferente: é a tentativa de tomada.
    const intrusa = await newProviderIdentity('conflito-intrusa', { emailVerified: true })
    await updateIdentityEmail(intrusa.providerId, emailDisputado)

    const login = await entrar(page, emailDisputado, intrusa.password)

    const cookies = await platformSessionCookies(context)
    expect(
      cookies,
      'uma identidade diferente assumiu a conta por coincidência de e-mail — '
        + `emitiu: ${cookies.join(', ')}`,
    ).toHaveLength(0)
    // A recusa é comunicada, não silenciosa: a pessoa precisa saber o motivo.
    expect(login.currentError(), 'a recusa não foi comunicada na tela de entrada').not.toBeNull()
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
