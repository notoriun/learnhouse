/**
 * Objeto de página das telas do provedor de identidade (Keycloak).
 *
 * Aqui está a fronteira que sustenta FR-001: autenticar e registrar-se
 * acontecem **nestas telas**, dirigidas pelo navegador. A interface
 * administrativa do provedor (em `../provider.ts`) só prepara e confere estado.
 *
 * Os seletores são os do tema padrão do Keycloak 26.x: campos `username`,
 * `password`, `email`, `firstName`, `lastName`, `password-confirm`.
 */
import { Page, expect } from '@playwright/test'
import { PROVIDER_URL } from '../config'

export class ProviderPage {
  constructor(private readonly page: Page) {}

  /** True quando o navegador está numa tela do provedor. */
  isOnProvider(): boolean {
    return this.page.url().startsWith(PROVIDER_URL)
  }

  /** Aguarda a tela de autenticação do provedor carregar. */
  async waitForLoginForm(): Promise<void> {
    await expect(this.page.locator('#kc-form-login, form#kc-form-login')).toBeVisible({
      timeout: 20_000,
    })
  }

  /** Aguarda a tela de registro do provedor carregar. */
  async waitForRegisterForm(): Promise<void> {
    await expect(this.page.locator('#kc-register-form, form#kc-register-form')).toBeVisible({
      timeout: 20_000,
    })
  }

  /**
   * Autentica na tela do provedor.
   *
   * Espera o desfecho antes de retornar — sem isso, quem chama corre com o
   * re-render: uma credencial recusada fazia `stayedOnLoginForm()` responder
   * antes de o Keycloak repintar a tela com o erro, e a jornada falhava de
   * forma intermitente (violando FR-009, que exige veredito idêntico entre
   * execuções). O desfecho é um de dois: saímos do provedor (sucesso) ou a tela
   * volta com mensagem de erro (recusa).
   */
  async authenticate(identifier: string, secret: string): Promise<void> {
    await this.waitForLoginForm()
    await this.page.locator('#username').fill(identifier)
    await this.page.locator('#password').fill(secret)
    await Promise.all([
      this.page.waitForLoadState('domcontentloaded'),
      this.page.locator('#kc-login').click(),
    ])
    // Um dos dois estados estáveis tem de valer antes de devolvermos o controle.
    await Promise.race([
      this.page.waitForURL((url) => !url.pathname.includes('/realms/'), { timeout: 20_000 }),
      this.page
        .getByText(
          /invalid username or password|usuário ou senha inválidos|invalid user credentials|account is disabled|conta está desabilitada/i,
        )
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 }),
    ]).catch(() => undefined)
  }

  /**
   * Preenche o registro na tela do provedor.
   *
   * O realm usa `registrationEmailAsUsername`, então não há campo de nome de
   * usuário: o e-mail é o identificador.
   */
  async register(user: {
    email: string
    password: string
    firstName?: string
    lastName?: string
  }): Promise<void> {
    await this.waitForRegisterForm()
    await this.page.locator('#firstName').fill(user.firstName ?? 'Efemera')
    await this.page.locator('#lastName').fill(user.lastName ?? 'Teste')
    await this.page.locator('#email').fill(user.email)
    await this.page.locator('#password').fill(user.password)
    await this.page.locator('#password-confirm').fill(user.password)
    await this.page.locator('input[type="submit"], #kc-form-buttons input').first().click()
  }

  /**
   * Mensagem de erro exibida pelo provedor, se houver.
   *
   * Usada para distinguir "o provedor recusou" de "a plataforma recusou" — sem
   * isso, uma credencial inválida e uma admissão negada pareceriam o mesmo
   * desfecho.
   */
  async errorMessage(): Promise<string | null> {
    // O Keycloak 26 não usa um seletor único de erro: dependendo da versão do
    // tema, a mensagem sai em `#input-error`, num item de texto auxiliar do
    // PatternFly (`#input-error-username`, `.pf-*helper-text*`) ou no bloco
    // `#kc-error-message`. Cobrir só os antigos fez esta verificação reportar
    // "sem mensagem" enquanto a tela exibia "Invalid username or password" —
    // falso negativo que teria virado defeito de produto no relatório.
    const seletores = [
      '#input-error',
      '#input-error-username',
      '#input-error-password',
      '#kc-error-message',
      '.alert-error',
      '.kc-feedback-text',
      '[class*="helper-text"]',
      '[aria-live="polite"]',
    ].join(', ')

    const alert = this.page.locator(seletores)
    const total = await alert.count()
    for (let i = 0; i < total; i++) {
      const texto = (await alert.nth(i).textContent())?.trim()
      if (texto) return texto
    }

    // Último recurso: procurar a mensagem pelo texto que o Keycloak emite.
    const porTexto = this.page.getByText(
      /invalid username or password|usuário ou senha inválidos|invalid user credentials|account is disabled|conta está desabilitada/i,
    )
    if ((await porTexto.count()) > 0) {
      return (await porTexto.first().textContent())?.trim() ?? null
    }
    return null
  }

  /**
   * True quando o provedor manteve a pessoa na tela de autenticação.
   *
   * Verifica a URL **e** o formulário: só o formulário era frágil durante a
   * navegação, e só a URL não distinguiria a tela de autenticação de outra tela
   * do provedor.
   */
  async stayedOnLoginForm(): Promise<boolean> {
    if (!this.isOnProvider()) return false
    return (await this.page.locator('#kc-form-login, form#kc-form-login').count()) > 0
  }

  /** Conclui a verificação de e-mail abrindo o link recebido no coletor. */
  async completeEmailVerification(actionLink: string): Promise<void> {
    await this.page.goto(actionLink)
    // O Keycloak pode pedir confirmação explícita antes de concluir a ação.
    const confirm = this.page.getByRole('link', { name: /clique aqui|click here/i })
    if ((await confirm.count()) > 0) {
      await confirm.first().click()
    }
  }
}
