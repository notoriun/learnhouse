/**
 * US1 — os endpoints usados no fluxo vêm do documento de descoberta do issuer.
 *
 * A alternativa que este teste descarta é endereço de provedor codificado na
 * aplicação: funcionaria no ambiente local e quebraria em qualquer realm com
 * caminho diferente.
 */
import { test, expect } from '@playwright/test'
import { authorize } from '../api'
import { getDiscovery } from '../provider'
import { ISSUER } from '../config'
import { title } from '../coverage'

test(title('us1-discovery'), async () => {
  const discovery = await getDiscovery()

  expect(discovery.issuer, 'o issuer do provedor deve ser o configurado').toBe(ISSUER)
  expect(discovery.authorization_endpoint).toBeTruthy()
  expect(discovery.token_endpoint).toBeTruthy()
  expect(discovery.jwks_uri, 'sem jwks_uri não há como validar assinatura').toBeTruthy()

  // A URL que a plataforma monta tem de sair do authorization_endpoint
  // anunciado, não de um caminho montado à mão.
  const { authorization_url } = await authorize()
  const emitido = authorization_url.split('?')[0]
  expect(
    emitido,
    `a plataforma usou "${emitido}", mas o provedor anuncia "${discovery.authorization_endpoint}"`,
  ).toBe(discovery.authorization_endpoint)
})
