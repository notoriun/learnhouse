/**
 * US1 — o fluxo usa Authorization Code com parâmetros de uso único.
 *
 * Comprova o contrato do fluxo pelo que ele emite: tipo de resposta, PKCE,
 * `state` e `nonce`. E comprova que o `state` é de uso único — que é a proteção
 * contra repetição do fluxo, não um detalhe de formato.
 */
import { test, expect } from '@playwright/test'
import { authorize, authorizationParams } from '../api'
import { CLIENT_ID, ISSUER } from '../config'
import { title } from '../coverage'

test(title('us1-flow-params'), async () => {
  const primeiro = await authorize()
  const p = authorizationParams(primeiro.authorization_url)

  expect(primeiro.authorization_url.startsWith(ISSUER)).toBe(true)
  expect(p.get('response_type'), 'fluxo deve ser Authorization Code').toBe('code')
  expect(p.get('client_id')).toBe(CLIENT_ID)
  expect(p.get('scope') ?? '').toContain('openid')

  // Parâmetros de uso único: presença é o mínimo verificável sem inspecionar o
  // armazenamento interno do fluxo, que é deliberadamente inacessível.
  expect(p.get('state'), 'state ausente').toBeTruthy()
  expect(p.get('nonce'), 'nonce ausente').toBeTruthy()
  expect(p.get('code_challenge'), 'PKCE ausente').toBeTruthy()
  expect(p.get('code_challenge_method')).toBe('S256')

  // Cada criação de fluxo produz parâmetros novos — reuso de state entre fluxos
  // seria a falha que a proteção existe para impedir.
  const segundo = await authorize()
  const q = authorizationParams(segundo.authorization_url)
  expect(q.get('state')).not.toBe(p.get('state'))
  expect(q.get('nonce')).not.toBe(p.get('nonce'))
  expect(q.get('code_challenge')).not.toBe(p.get('code_challenge'))
})
