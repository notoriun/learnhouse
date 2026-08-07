/**
 * US2 — registro pela identidade corporativa.
 *
 * ESCOPO REDUZIDO POR BLOQUEIO DE AMBIENTE (D-17), declarado e não silenciado.
 *
 * O caminho feliz completo — registrar-se, verificar o e-mail e receber conta
 * provisionada com o papel de menor privilégio — **não é alcançável no ambiente
 * local documentado**. Provisionar conta nova exige `auto_provision`, que só vem
 * de configuração OIDC por organização, e cadastrar essa configuração apontando
 * para o Keycloak local é recusado pela proteção anti-SSRF (verificado: 400
 * `URL_INVALIDA`, "aponta para uma rede privada ou interna"). A recusa é
 * correta; o bloqueio é de ambiente, não de produto.
 *
 * O que permanece verificável, e é o que esta jornada faz:
 *  - a opção de registro é oferecida quando o provedor é o da plataforma;
 *  - o registro na tela do provedor cria a identidade **no provedor**;
 *  - o provedor envia o e-mail de verificação e a verificação se completa nele;
 *  - a admissão na plataforma recusa sem emitir sessão.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { getKeycloakStatus } from '../api'
import { ephemeralEmail, senhaValida, cleanupProviderIdentities } from '../fixtures'
import { findUserByEmail, sendVerifyEmail } from '../provider'
import { clearMailbox, waitForVerificationLink } from '../mailbox'
import { platformSessionCookies } from '../verify'
import { title } from '../coverage'

test.afterAll(async () => {
  await cleanupProviderIdentities()
})

test(title('us2-register'), async ({ page, context }) => {
  const login = new LoginPage(page)
  const provider = new ProviderPage(page)
  const email = ephemeralEmail('reg')

  await test.step('a opção de registro é oferecida (provedor da plataforma)', async () => {
    const status = await getKeycloakStatus()
    expect(
      status.platform,
      'o provedor efetivo deveria ser o da plataforma para o registro existir',
    ).toBe(true)
    await login.goto()
    await login.expectRegisterOptionVisible()
  })

  await test.step('o registro na tela do provedor cria a identidade no provedor', async () => {
    await login.clickSsoRegister()
    await page.waitForURL(/\/realms\//, { timeout: 30_000 })
    await provider.waitForRegisterForm()
    await provider.register({ email, password: senhaValida("reg") })

    // O registro conclui no provedor e o retorno passa pelo callback.
    await page.waitForURL((url) => !url.pathname.includes('/realms/'), { timeout: 30_000 })

    const criada = await findUserByEmail(email)
    expect(criada, `o provedor não criou a identidade ${email}`).not.toBeNull()
    expect(
      criada!.emailVerified ?? false,
      'a identidade recém-registrada deveria nascer com e-mail não verificado',
    ).toBe(false)
  })

  await test.step('a admissão recusa e nenhuma sessão nasce', async () => {
    // Recusa esperada: o e-mail ainda não foi verificado. Mesmo depois de
    // verificado, a admissão seguiria recusando por auto-provisionamento
    // desligado — ver o cabeçalho deste arquivo e D-17.
    const cookies = await platformSessionCookies(context)
    expect(cookies, `registro sem verificação não pode emitir sessão`).toHaveLength(0)
  })

  await test.step('o provedor envia e conclui a verificação de e-mail', async () => {
    // Aqui o coletor SMTP ganha sua razão de existir. O envio e a verificação
    // são do Keycloak; a validação apenas aciona a ação e lê a caixa (D-06.1).
    await clearMailbox()
    const identidade = await findUserByEmail(email)
    await sendVerifyEmail(identidade!.id)

    const link = await waitForVerificationLink(email, 30_000)
    expect(link, 'o e-mail de verificação não trouxe link de ação').toBeTruthy()

    await provider.completeEmailVerification(link)

    const depois = await findUserByEmail(email)
    expect(
      depois!.emailVerified,
      'a verificação não foi concluída no provedor',
    ).toBe(true)
  })

})

/**
 * A continuação natural do registro — entrar e receber conta provisionada com o
 * papel de menor privilégio — está fora de alcance neste ambiente.
 *
 * Declarada como teste pulado, e não omitida, de propósito: o relatório precisa
 * dizer que esta cobertura não existe. Uma suíte verde silenciosa sobre o
 * caminho feliz do registro seria enganosa.
 */
test.skip(
  'us2-register-provisionamento — BLOQUEADO POR AMBIENTE (D-17): provisionar conta nova exige ' +
    'auto_provision, que exige configuração OIDC por organização, que a proteção anti-SSRF ' +
    'recusa para issuer em loopback (400 URL_INVALIDA). Exige hostname que resolva para ' +
    'endereço público — decisão de ambiente, não de produto.',
  async () => {
    // Intencionalmente vazio: existe para aparecer no relatório com a razão.
  },
)
