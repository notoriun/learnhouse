/**
 * US1 — o destino final do fluxo não vem de entrada do usuário.
 *
 * Antes (features 001–007) o fluxo transportava um destino pedido pelo cliente e
 * a plataforma o sanitizava: destino hostil era neutralizado e virava `/`. A
 * feature 009 removeu o parâmetro do contrato — o destino passou a ser derivado
 * da organização do fluxo.
 *
 * Esta jornada afirma a propriedade mais forte que isso permite: um destino
 * hostil é **ignorado**, não sanitizado. Não existe entrada do usuário no
 * cálculo do destino, então o vetor de open redirect não existe por construção,
 * em vez de depender de uma função de saneamento estar correta.
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

test(title('us1-redirect-allowlist'), async ({ request }) => {
  for (const hostil of DESTINOS_HOSTIS) {
    await test.step(`destino hostil no corpo da API é ignorado: ${hostil}`, async () => {
      // O campo saiu do contrato; mandá-lo não é erro, apenas não tem efeito.
      const { authorization_url, state } = await authorize({
        extra: { redirect_to: hostil },
      })

      expect(state, 'o fluxo deve ser criado normalmente, ignorando o campo').toBeTruthy()

      // O provedor recebe sempre a redirect URI registrada.
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

    await test.step(`destino hostil na query do BFF é ignorado: ${hostil}`, async () => {
      // Vetor realista: um link forjado para a rota do BFF. Antes, o `redirect`
      // era repassado à API; agora não é nem lido.
      const res = await request.get(
        `${BASE_URL}/api/auth/keycloak/authorize`
          + `?org=default&redirect=${encodeURIComponent(hostil)}`,
        { maxRedirects: 0 },
      )

      expect(
        [302, 303, 307].includes(res.status()),
        `esperado redirecionamento ao provedor, veio ${res.status()}`,
      ).toBeTruthy()

      const location = res.headers()['location'] ?? ''
      expect(
        location,
        `o BFF repassou o destino hostil "${hostil}" no redirecionamento`,
      ).not.toContain('exemplo-invasor.com')
      expect(location.toLowerCase()).not.toContain('javascript:')
      // O destino do redirecionamento é o provedor, não o endereço hostil.
      expect(location).toContain('/protocol/openid-connect/')
    })
  }

  await test.step('o fluxo é idêntico com e sem o parâmetro', async () => {
    // Contraste necessário: se a criação do fluxo falhasse com o campo presente,
    // as asserções acima passariam por um motivo errado (recusa, não indiferença).
    const comCampo = await authorize({ extra: { redirect_to: '/home' } })
    const semCampo = await authorize()

    for (const resposta of [comCampo, semCampo]) {
      expect(resposta.state).toBeTruthy()
      expect(resposta.authorization_url).toContain('/protocol/openid-connect/')
    }
    // Nenhuma das duas URLs carrega destino algum — nem o pedido, nem um default.
    expect(comCampo.authorization_url).not.toContain('%2Fhome')
    expect(comCampo.authorization_url).not.toContain('redirect_to')
  })
})
