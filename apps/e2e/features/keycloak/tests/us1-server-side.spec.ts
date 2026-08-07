/**
 * US1 — o retorno é processado só no servidor e nenhum token do provedor vaza
 * para o navegador.
 *
 * A regra é que os tokens do provedor nunca transitem pelo JavaScript: a
 * plataforma age como relying party e emite a própria sessão. Um vazamento aqui
 * não quebra nenhuma funcionalidade — é justamente por isso que passa
 * despercebido sem uma verificação dedicada.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { CREDENTIALS } from '../config'
import { title } from '../coverage'

const PADROES_DE_TOKEN = [/\beyJ[A-Za-z0-9._-]{10,}/, /access_token/i, /id_token/i, /refresh_token/i]

/**
 * Cookies que realmente carregam credencial, de
 * `apps/web/services/auth/cookies.ts`. São estes que precisam ser httpOnly —
 * `LH_session` e `LH_sso` são marcadores de valor "1", legíveis de propósito.
 */
const TOKEN_COOKIES = ['LH_access', 'LH_refresh']

test(title('us1-server-side'), async ({ page, context }) => {
  const login = new LoginPage(page)
  const provider = new ProviderPage(page)
  const cred = CREDENTIALS.verificado

  await login.goto()
  await login.expectSsoOptionVisible()
  await login.clickSsoLogin()
  await page.waitForURL(/\/realms\//, { timeout: 30_000 })
  await provider.authenticate(cred.identifier, cred.secret)
  await page.waitForURL((url) => !url.pathname.includes('/realms/'), { timeout: 30_000 })

  await test.step('os cookies que carregam token são httpOnly', async () => {
    // A asserção certa não é "todo cookie com 'session' no nome é httpOnly": a
    // plataforma emite de propósito marcadores legíveis (`LH_session`,
    // `LH_sso`) cujo valor é literalmente "1" e que não carregam credencial
    // nenhuma — é assim que o cliente sabe que há sessão sem ir à rede. O que
    // FR-004 exige é que o **token** nunca esteja acessível ao script.
    const cookies = await context.cookies()
    const platformCookies = cookies.filter((c) => !c.domain.includes('8080'))

    const portadores = platformCookies.filter((c) => TOKEN_COOKIES.includes(c.name))
    expect(
      portadores.length,
      `nenhum cookie portador de token encontrado (esperados: ${TOKEN_COOKIES.join(', ')})`,
    ).toBeGreaterThan(0)

    const expostos = portadores.filter((c) => !c.httpOnly).map((c) => c.name)
    expect(
      expostos,
      `cookies portadores de token sem httpOnly: ${expostos.join(', ')}`,
    ).toHaveLength(0)
  })

  await test.step('nenhum cookie legível por script contém algo parecido com token', async () => {
    const cookies = await context.cookies()
    const legiveis = cookies.filter((c) => !c.httpOnly && !c.domain.includes('8080'))
    const suspeitos = legiveis
      .filter((c) => PADROES_DE_TOKEN.some((p) => p.test(c.value)))
      .map((c) => c.name)
    expect(
      suspeitos,
      `cookies legíveis por script com aparência de token: ${suspeitos.join(', ')}`,
    ).toHaveLength(0)
  })

  await test.step('nenhum token do provedor está no armazenamento do navegador', async () => {
    const armazenamento = await page.evaluate(() => {
      const dump = (s: Storage) =>
        Object.keys(s)
          .map((k) => `${k}=${s.getItem(k) ?? ''}`)
          .join('\n')
      try {
        return `${dump(localStorage)}\n${dump(sessionStorage)}`
      } catch {
        return ''
      }
    })
    for (const padrao of PADROES_DE_TOKEN) {
      expect(
        padrao.test(armazenamento),
        `armazenamento do navegador contém algo que casa com ${padrao}`,
      ).toBe(false)
    }
  })

  await test.step('a URL final não carrega código nem token', async () => {
    const url = page.url()
    expect(url, 'o código de autorização não deve sobrar na URL final').not.toMatch(/[?&]code=/)
    for (const padrao of PADROES_DE_TOKEN) {
      expect(padrao.test(url), `a URL final casa com ${padrao}`).toBe(false)
    }
  })
})
