/**
 * US3 — sair encerra a sessão local **e** a sessão no provedor.
 *
 * O defeito que isto pega e que verificação manual não pega: encerrar só um dos
 * dois lados. Se a sessão do provedor sobrevive, a próxima entrada corporativa
 * passa direto sem pedir credencial — a pessoa acredita que saiu, e não saiu.
 * Conferir isso exige olhar dois sistemas ao mesmo tempo, que é exatamente o que
 * um Keycloak real permite e um provedor simulado não.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { CREDENTIALS, BASE_URL } from '../config'
import { canReachAuthenticatedArea, platformSessionCookies } from '../verify'
import { findUserByEmail, userSessions } from '../provider'
import { title } from '../coverage'

test(title('us3-logout'), async ({ page, context }) => {
  const login = new LoginPage(page)
  const provider = new ProviderPage(page)
  const cred = CREDENTIALS.verificado

  const noProvedor = await findUserByEmail(cred.identifier)
  expect(noProvedor).not.toBeNull()

  // Sessões que já existiam no provedor ANTES desta jornada. O logout coordenado
  // encerra a sessão desta jornada, não todas as do usuário — e as demais vêm
  // das outras jornadas da mesma execução (cada uma entra uma vez) e de
  // execuções anteriores. Comparar totais, ou até "todas as de agora", fazia o
  // veredito depender de quantas jornadas rodaram antes: a não-repetibilidade
  // que FR-009 proíbe, cometida pelo próprio teste. O alvo é o **delta**.
  let preexistentes: string[] = []
  let sessaoDestaJornada: string | undefined

  await test.step('entra por identidade corporativa', async () => {
    preexistentes = (await userSessions(noProvedor!.id)).map((s) => s.id)

    await login.goto()
    await login.expectSsoOptionVisible()
    await login.clickSsoLogin()
    await page.waitForURL(/\/realms\//, { timeout: 30_000 })
    await provider.authenticate(cred.identifier, cred.secret)
    await page.waitForURL((url) => !url.pathname.includes('/realms/'), { timeout: 30_000 })
    expect(await canReachAuthenticatedArea(page, BASE_URL)).toBe(true)
  })

  await test.step('o provedor registrou a sessão desta jornada', async () => {
    const agora = (await userSessions(noProvedor!.id)).map((s) => s.id)
    const novas = agora.filter((id) => !preexistentes.includes(id))
    expect(
      novas.length,
      'o provedor não registrou nenhuma sessão nova para esta entrada',
    ).toBeGreaterThan(0)
    sessaoDestaJornada = novas[0]
  })

  await test.step('sair pela plataforma dispara o encerramento coordenado', async () => {
    // Navegação de topo para a rota de logout do BFF — é o que a interface faz.
    await page.goto(`${BASE_URL}/api/auth/keycloak/logout?redirect=/login`)
    await page.waitForLoadState('domcontentloaded')
  })

  await test.step('todas as variantes de cookie de sessão saíram', async () => {
    const restantes = await platformSessionCookies(context)
    expect(
      restantes,
      `cookies de sessão sobreviveram ao logout: ${restantes.join(', ')}`,
    ).toHaveLength(0)
  })

  await test.step('a sessão local não vale mais', async () => {
    const aindaDentro = await canReachAuthenticatedArea(page, BASE_URL)
    expect(aindaDentro, 'a sessão local sobreviveu ao logout').toBe(false)
  })

  await test.step('o provedor também encerrou a sessão desta jornada', async () => {
    // A asserção que separa logout local de logout coordenado. Sem ela, um
    // logout que só limpa cookies passaria como correto.
    const depois = (await userSessions(noProvedor!.id)).map((s) => s.id)
    expect(
      depois,
      `a sessão desta jornada (${sessaoDestaJornada}) sobreviveu no provedor — ` +
        'a próxima entrada passaria sem pedir credencial',
    ).not.toContain(sessaoDestaJornada)
  })
})
