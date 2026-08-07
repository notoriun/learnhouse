/**
 * US2 (feature 009) — o segundo acesso cai na MESMA conta criada no primeiro.
 *
 * O risco que isto fecha é específico da feature 009: com a criação automática
 * ligada, o passo de criação passou a ser alcançável de verdade. Uma falha no
 * reconhecimento da identidade não daria mais "conta não encontrada" — daria uma
 * conta nova a cada acesso, silenciosamente, com o histórico de aprendizagem
 * ficando para trás na conta anterior.
 *
 * Difere de `us2-identity-link`, que parte de conta local preexistente: aqui a
 * conta do primeiro acesso é criada pelo próprio fluxo.
 */
import { test, expect } from '../../../core/fixtures'
import { LoginPage } from '../pages/login'
import { ProviderPage } from '../pages/provider'
import { BASE_URL } from '../config'
import { canReachAuthenticatedArea } from '../verify'
import { createEphemeralIdentity, deleteIdentity } from '../provider'
import { title } from '../coverage'

async function entrarPorSSO(page: any, email: string, senha: string) {
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

/** Identificador estável da conta, pela API — não por heurística de página. */
async function contaAtual(page: any): Promise<{ id: number; email: string }> {
  const perfil = await page.evaluate(async (url: string) => {
    const res = await fetch(`${url}/api/v1/users/profile`, { credentials: 'include' })
    return res.ok ? await res.json() : null
  }, BASE_URL)
  expect(perfil, 'não foi possível ler o perfil da sessão').not.toBeNull()
  return { id: perfil.id, email: perfil.email }
}

test(title('us2-reentrada-mesma-conta'), async ({ page, context }) => {
  const sufixo = `re${Date.now().toString(36)}`
  const identidade = await createEphemeralIdentity(sufixo, { emailVerified: true })

  try {
    let primeira: { id: number; email: string }

    await test.step('primeiro acesso cria a conta', async () => {
      const login = await entrarPorSSO(page, identidade.email, identidade.password)
      expect(login.currentError(), 'o primeiro acesso foi recusado').toBeNull()
      primeira = await contaAtual(page)
      expect(primeira.email.toLowerCase()).toBe(identidade.email.toLowerCase())
    })

    await test.step('o destino do primeiro acesso é a área com menu', async () => {
      expect(new URL(page.url()).pathname).toBe('/')
      await expect(page.getByRole('navigation', { name: /Top navigation/i })).toBeVisible({
        timeout: 15_000,
      })
    })

    await test.step('segundo acesso entra na MESMA conta', async () => {
      await context.clearCookies()
      const login = await entrarPorSSO(page, identidade.email, identidade.password)
      expect(login.currentError(), 'o segundo acesso foi recusado').toBeNull()

      const segunda = await contaAtual(page)
      expect(
        segunda.id,
        `o segundo acesso caiu na conta ${segunda.id}, não na ${primeira.id} do primeiro `
          + '— identidade não foi reconhecida e uma conta paralela foi criada',
      ).toBe(primeira.id)
      expect(segunda.email.toLowerCase()).toBe(primeira.email.toLowerCase())
    })

    await test.step('o destino do segundo acesso é o mesmo do primeiro', async () => {
      expect(new URL(page.url()).pathname).toBe('/')
      await expect(page.getByRole('navigation', { name: /Top navigation/i })).toBeVisible({
        timeout: 15_000,
      })
      expect(await canReachAuthenticatedArea(page, BASE_URL)).toBe(true)
    })
  } finally {
    await deleteIdentity(identidade.providerId)
  }
})
