/**
 * Chamadas à API usando os cookies de sessão do navegador.
 *
 * Existe porque as jornadas de US4 precisam exercitar a API **como a pessoa
 * autenticada a exercita** — pelos cookies httpOnly que o callback gravou, não
 * por um token obtido à parte. Usar um token de login por senha aqui mudaria o
 * sujeito da chamada e as guardas de conta federada não seriam as mesmas.
 */
import type { Page } from '@playwright/test'
import { API_URL } from '../../core/instance'

export interface RespostaCrua {
  status: number
  body: string
}

/** Chamada autenticada pelos cookies do contexto do navegador. */
export function comSessao(
  page: Page,
  metodo: string,
  caminho: string,
  corpo?: unknown,
): Promise<RespostaCrua> {
  return page.evaluate(
    async ([api, m, p, b]) => {
      const res = await fetch(`${api}${p}`, {
        method: m,
        credentials: 'include',
        headers: b === null ? undefined : { 'Content-Type': 'application/json' },
        body: b === null ? undefined : b,
      })
      return { status: res.status, body: await res.text() }
    },
    [API_URL, metodo, caminho, corpo === undefined ? null : JSON.stringify(corpo)] as [
      string,
      string,
      string,
      string | null,
    ],
  )
}

export interface Perfil {
  id: number
  user_uuid: string
  username: string
  email?: string
}

/** Quem o servidor acha que somos, pelos cookies. Null quando anônimo. */
export async function perfilAtual(page: Page): Promise<Perfil | null> {
  const r = await comSessao(page, 'GET', '/users/profile')
  if (r.status !== 200) return null
  const p = JSON.parse(r.body) as Perfil
  return p.user_uuid === 'user_anonymous' ? null : p
}
