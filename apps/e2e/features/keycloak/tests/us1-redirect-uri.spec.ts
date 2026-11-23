/**
 * US1 — a redirect URI que a plataforma emite coincide com a registrada no
 * provedor.
 *
 * Esta jornada existe por causa de um defeito real (D-13): a plataforma montava
 * a redirect URI a partir de `hosting_config.frontend_domain`, que não cai para
 * `LEARNHOUSE_DOMAIN`, e emitia `localhost:3000` enquanto o realm registrava a
 * porta 80. O Keycloak recusava a autorização e o login corporativo não
 * funcionava — em qualquer instalação que não definisse
 * `LEARNHOUSE_FRONTEND_DOMAIN`, o que inclui todo self-host da edição
 * community.
 *
 * É a verificação mais barata do módulo e cobre uma classe inteira de quebra de
 * configuração: nenhuma tela, nenhum navegador, duas leituras e uma comparação.
 */
import { test, expect } from '@playwright/test'
import { authorize, authorizationParams } from '../api'
import { registeredRedirectUris } from '../provider'
import { title } from '../coverage'

test(title('us1-redirect-uri'), async () => {
  const { authorization_url } = await authorize()
  const emitida = authorizationParams(authorization_url).get('redirect_uri')
  const registradas = await registeredRedirectUris()

  expect(emitida, 'a URL de autorização deve trazer redirect_uri').toBeTruthy()

  // A comparação é contra o que o provedor realmente registra, lido da
  // interface administrativa — não contra uma constante derivada da mesma
  // origem que gerou a URI. Derivá-la faria o teste concordar consigo mesmo.
  expect(
    registradas,
    `a plataforma emite "${emitida}", mas o client do provedor registra ` +
      `[${registradas.join(', ')}]. O Keycloak recusa autorização com redirect_uri ` +
      'não registrada — confira LEARNHOUSE_FRONTEND_DOMAIN (D-13).',
  ).toContain(emitida!)
})
