/**
 * Objeto de página da tela de entrada da plataforma.
 *
 * Os rótulos vêm de apps/web/app/auth/login/login.tsx, onde os botões de
 * identidade corporativa são renderizados sob `keycloakEnabled` (entrada) e
 * `keycloakEnabled && keycloakPlatform` (registro) — essa distinção é o que a
 * jornada de "provedor de terceiro não oferece registro" comprova.
 *
 * Os textos são os `defaultValue` das chaves de tradução; a UI é pt-BR no
 * ambiente local.
 */
import { Page, expect } from '@playwright/test'
import { BASE_URL } from '../config'

/**
 * Rótulos dos botões, nos dois idiomas que o produto traduz.
 *
 * Casar apenas o texto pt-BR foi um erro real cometido aqui: o ambiente local
 * serve a interface em inglês, e as jornadas reprovaram como se o botão não
 * existisse. O idioma da interface não é parte do que estas jornadas comprovam,
 * então o seletor aceita ambos — de `apps/web/locales/{en,pt}.json`, chaves
 * `auth.keycloak_sso_button` e `auth.keycloak_register_button`.
 */
const ENTRAR_SSO = /Entrar com identidade corporativa|Sign in with corporate identity/
const CRIAR_CONTA_SSO = /Criar conta pela identidade corporativa|Create account with corporate identity/
const ENTRAR = /^(Login|Entrar)$/
const CAMPO_EMAIL = /^(Email|E-mail)$/
const CAMPO_SENHA = /^(Password|Senha)$/

export class LoginPage {
  constructor(private readonly page: Page) {}

  /**
   * Vai para a tela de entrada.
   *
   * O caminho servido é `/login`, não `/auth/login` — verificado contra a
   * instância de pé, nos dois níveis (nginx e servidor Next). `/auth/login`
   * responde 404, ainda que `app/auth/login/page.tsx` exista no código e no
   * build. Essa divergência é a causa do defeito D-16: o callback do login
   * corporativo redireciona toda recusa para `/auth/login`, e a pessoa cai numa
   * página 404 sem ver o motivo.
   */
  async goto(): Promise<void> {
    await this.page.goto(`${BASE_URL}/login`)
    // Os botões só aparecem depois que a página consulta a rota de status, que
    // é uma chamada assíncrona — esperar o formulário evita ler o DOM antes.
    await this.page.waitForLoadState('domcontentloaded')
  }

  private ssoButton() {
    return this.page.getByRole('button', { name: ENTRAR_SSO })
  }

  private registerButton() {
    return this.page.getByRole('button', { name: CRIAR_CONTA_SSO })
  }

  /** Aguarda a opção de entrada corporativa aparecer e a devolve. */
  async expectSsoOptionVisible(): Promise<void> {
    await expect(this.ssoButton()).toBeVisible({ timeout: 15_000 })
  }

  /** Comprova que a opção de entrada corporativa NÃO é oferecida. */
  async expectSsoOptionAbsent(): Promise<void> {
    await expect(this.ssoButton()).toHaveCount(0)
  }

  /** Comprova que a opção de registro é oferecida (só provedor da plataforma). */
  async expectRegisterOptionVisible(): Promise<void> {
    await expect(this.registerButton()).toBeVisible({ timeout: 15_000 })
  }

  /** Comprova que a opção de registro NÃO é oferecida (provedor de terceiro). */
  async expectRegisterOptionAbsent(): Promise<void> {
    await expect(this.registerButton()).toHaveCount(0)
  }

  /**
   * Clica em entrar por identidade corporativa.
   *
   * É navegação de topo (`window.location.assign`), não fetch — por isso a
   * espera é de navegação para o domínio do provedor, e não de resposta.
   */
  async clickSsoLogin(): Promise<void> {
    await this.ssoButton().click()
  }

  async clickSsoRegister(): Promise<void> {
    await this.registerButton().click()
  }

  /** Entrada nativa por e-mail e senha, para as jornadas de contraste. */
  async loginWithPassword(email: string, password: string): Promise<void> {
    await this.page.getByRole('textbox', { name: CAMPO_EMAIL }).fill(email)
    await this.page.getByRole('textbox', { name: CAMPO_SENHA }).fill(password)
    await this.page.getByRole('button', { name: ENTRAR }).click()
  }

  /** Código de erro que a tela expõe na URL após uma recusa. */
  currentError(): string | null {
    try {
      return new URL(this.page.url()).searchParams.get('error')
    } catch {
      return null
    }
  }

  /** True quando a pessoa continua (ou voltou) na tela de entrada. */
  isOnLogin(): boolean {
    return /\/(auth\/)?login(\?|$)/.test(this.page.url())
  }
}
