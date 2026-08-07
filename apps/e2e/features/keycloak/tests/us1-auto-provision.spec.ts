/**
 * US1 (feature 009) — o primeiro acesso cria a conta e entra.
 *
 * Antes desta feature, uma identidade que existia no provedor mas não tinha
 * conta na plataforma era recusada com `conta_nao_encontrada`: alguém precisava
 * criar a conta local antes, à mão. Era comportamento correto para IdP de
 * terceiro e obstáculo puro no provedor da própria plataforma — onde a feature
 * 007 já expõe autorregistro.
 *
 * A jornada usa identidade EFÊMERA de propósito: reutilizar a credencial fixa
 * faria a segunda execução não ser mais um primeiro acesso, e o veredito mudaria
 * entre execuções.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { BASE_URL } from '../config'
import { canReachAuthenticatedArea, platformSessionCookies } from '../verify'
import { createEphemeralIdentity, deleteIdentity } from '../provider'
import { title } from '../coverage'

test(title('us1-auto-provision'), async ({ page, context }) => {
  const sufixo = `ap${Date.now().toString(36)}`
  // E-mail verificado: é pré-condição da criação automática (FR-008). A jornada
  // do e-mail não verificado é `us2-unverified`, que continua recusando.
  const identidade = await createEphemeralIdentity(sufixo, { emailVerified: true })

  try {
    const login = new LoginPage(page)
    const provider = new ProviderPage(page)

    await test.step('a identidade não tem conta na plataforma ainda', async () => {
      // Sem sessão e sem conta: o estado de primeiro acesso. Se a identidade já
      // tivesse conta, a jornada provaria outra coisa (reentrada, não criação).
      const perfil = await page.request.get(`${BASE_URL}/api/v1/users/profile`)
      const corpo = await perfil.text()
      expect(corpo, 'a suíte deveria começar sem sessão').toContain('user_anonymous')
    })

    await test.step('o primeiro acesso conclui sem recusa', async () => {
      await login.goto()
      await login.expectSsoOptionVisible()
      await login.clickSsoLogin()
      await page.waitForURL(/\/realms\//, { timeout: 30_000 })
      await provider.authenticate(identidade.email, identidade.password)
      await page.waitForURL((url) => !url.pathname.includes('/realms/'), { timeout: 30_000 })

      const erro = login.currentError()
      expect(
        erro,
        `o primeiro acesso foi recusado com "${erro}". `
          + 'Se for conta_nao_encontrada, a criação automática não está ligada '
          + 'no caminho do provedor da plataforma (feature 009).',
      ).toBeNull()
    })

    await test.step('a conta passou a existir e a sessão é utilizável', async () => {
      const cookies = await platformSessionCookies(context)
      expect(cookies.length, 'nenhum cookie de sessão foi emitido').toBeGreaterThan(0)

      const dentro = await canReachAuthenticatedArea(page, BASE_URL)
      expect(dentro, 'a sessão existe mas não dá acesso a área autenticada').toBe(true)

      // A conta é a da identidade que autenticou — não uma conta qualquer.
      const perfil = await page.evaluate(async (url) => {
        const res = await fetch(`${url}/api/v1/users/profile`, { credentials: 'include' })
        return res.ok ? await res.json() : null
      }, BASE_URL)
      expect(perfil?.email?.toLowerCase()).toBe(identidade.email.toLowerCase())
    })

    await test.step('a conta criada não recebeu papel privilegiado', async () => {
      // SC-006: criação automática nunca concede administração. A superfície
      // publicada que revela isso sem endpoint dedicado é a recusa de uma ação
      // administrativa — aqui, listar usuários da organização.
      const status = await page.evaluate(async (url) => {
        const res = await fetch(`${url}/api/v1/orgs/slug/default/users`, {
          credentials: 'include',
        })
        return res.status
      }, BASE_URL)
      expect(
        [401, 403, 404].includes(status),
        `a conta recém-criada obteve acesso administrativo (HTTP ${status})`,
      ).toBeTruthy()
    })
  } finally {
    await deleteIdentity(identidade.providerId)
  }
})
