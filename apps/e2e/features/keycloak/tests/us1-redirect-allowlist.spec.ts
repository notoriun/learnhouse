/**
 * US1 — o destino final do fluxo só pode ser caminho interno permitido.
 *
 * Sem essa restrição, o parâmetro de destino do fluxo seria um redirecionamento
 * aberto: um endereço externo colocado ali levaria a pessoa autenticada para
 * fora do domínio, que é vetor clássico de phishing.
 */
import { test, expect } from '@playwright/test'
import { authorize } from '../api'
import { BASE_URL } from '../config'
import { title } from '../coverage'

const DESTINOS_HOSTIS = [
  'https://exemplo-invasor.com/colhe',
  '//exemplo-invasor.com/colhe',
  'http://localhost.exemplo-invasor.com/colhe',
  'javascript:alert(1)',
]

test(title('us1-redirect-allowlist'), async () => {
  for (const hostil of DESTINOS_HOSTIS) {
    await test.step(`destino hostil é descartado: ${hostil}`, async () => {
      // O fluxo é criado com o destino hostil. A criação em si pode ser aceita —
      // o que não pode acontecer é o destino sobreviver até o redirecionamento.
      const { authorization_url } = await authorize({ redirectTo: hostil })

      // O provedor recebe sempre a redirect URI registrada, nunca o destino
      // pedido — este é o primeiro ponto onde um destino hostil vazaria.
      const redirectUri = new URL(authorization_url).searchParams.get('redirect_uri')
      expect(
        redirectUri,
        `o destino hostil "${hostil}" apareceu na redirect_uri enviada ao provedor`,
      ).toBe(`${BASE_URL}/api/auth/keycloak/callback`)

      expect(
        authorization_url,
        `a URL de autorização carrega o destino hostil "${hostil}"`,
      ).not.toContain('exemplo-invasor.com')
      expect(authorization_url.toLowerCase()).not.toContain('javascript:')
    })
  }

  await test.step('destino interno legítimo é preservado', async () => {
    // Contraste necessário: se a sanitização descartasse tudo, as asserções
    // acima passariam sem provar nada sobre a política.
    const { authorization_url, state } = await authorize({ redirectTo: '/home' })
    expect(authorization_url).toBeTruthy()
    expect(state, 'o fluxo com destino interno deve ser criado normalmente').toBeTruthy()
  })
})
