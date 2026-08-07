/**
 * Captura as evidências visuais do fluxo desta feature.
 *
 * Roda contra o ambiente local com Keycloak real (docker-compose.local.yml).
 * Existe versionado para que a evidência do PR seja reproduzível: quem duvidar
 * de um print roda o script e compara.
 *
 * Uso, da raiz do repo, com o ambiente de pé:
 *   node specs/009-auto-provisionamento-keycloak/evidencias/capturar.mjs
 *
 * Pré-condição: uma identidade no realm `dev` com e-mail verificado e SEM conta
 * local — é o que faz o percurso ser um primeiro acesso de verdade.
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
// Playwright vive em apps/e2e, não aqui. Resolver a partir de lá mantém o
// script executável da raiz do repo, sem depender do cwd nem de caminho da
// máquina de quem roda.
const requireDoE2E = createRequire(join(resolve(DIR, '../../..'), 'apps/e2e/package.json'))
const { chromium } = requireDoE2E('playwright')
const BASE = process.env.BASE_URL || 'http://localhost'
const NOVO = { email: process.env.KC_NOVO || 'joao.print@example.com', senha: 'teste123' }
const NAO_VERIFICADO = { email: 'nao-verificado@example.com', senha: 'teste123' }

mkdirSync(DIR, { recursive: true })
const shot = (page, nome) =>
  page.screenshot({ path: join(DIR, `${nome}.png`), fullPage: false })

const SSO = /Entrar com identidade corporativa|Sign in with corporate identity/

async function autenticar(page, cred) {
  await page.goto(`${BASE}/login?org=default`)
  await page.getByRole('button', { name: SSO }).waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: SSO }).click()
  await page.waitForURL(/\/realms\//, { timeout: 30_000 })
  await page.fill('#username', cred.email)
  await page.fill('#password', cred.senha)
  return page
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })

// 1-3. Primeiro acesso: entrada -> provedor -> destino (área com menu)
{
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login?org=default`)
  await page.getByRole('button', { name: SSO }).waitFor({ timeout: 15_000 })
  await shot(page, '1-tela-de-entrada')

  await autenticar(page, NOVO)
  await shot(page, '2-provedor-keycloak')

  await page.click('#kc-login')
  await page.waitForURL((u) => !u.pathname.includes('/realms/'), { timeout: 30_000 })
  await page.waitForLoadState('networkidle')
  await shot(page, '3-destino-area-da-organizacao')
  console.log('destino do primeiro acesso:', page.url())
  await page.close()
}

// 4. Reentrada: mesma identidade, mesma conta, mesmo destino
{
  await ctx.clearCookies()
  const page = await ctx.newPage()
  await autenticar(page, NOVO)
  await page.click('#kc-login')
  await page.waitForURL((u) => !u.pathname.includes('/realms/'), { timeout: 30_000 })
  await page.waitForLoadState('networkidle')
  await shot(page, '4-reentrada-mesma-conta')
  console.log('destino da reentrada:', page.url())
  await page.close()
}

// 5. Guarda preservada: e-mail não verificado continua recusado
{
  await ctx.clearCookies()
  const page = await ctx.newPage()
  await autenticar(page, NAO_VERIFICADO)
  await page.click('#kc-login')
  await page.waitForURL((u) => !u.pathname.includes('/realms/'), { timeout: 30_000 })
  await page.waitForLoadState('networkidle')
  await shot(page, '5-recusa-email-nao-verificado')
  console.log('recusa:', page.url())
  await page.close()
}

await browser.close()
console.log('prints em', DIR)
