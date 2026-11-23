'use client'

import { Browser, Stack, SignIn, Cookie } from '@phosphor-icons/react/dist/ssr'
import FlowDiagram from './FlowDiagram'

// O fluxo de login via BFF: o navegador fala só com o seu servidor Next.js,
// que guarda os tokens do Notoriun no próprio cookie httpOnly.
const nodes = [
  { label: 'Navegador', sub: 'Formulário de login', icon: Browser, color: '#6366f1', bg: '#eef2ff', border: '#c7d2fe',
    edge: { label: 'e-mail + senha' } },
  { label: 'Route Handler do Next.js', sub: 'Seu BFF', icon: Stack, color: '#0ea5e9', bg: '#e0f2fe', border: '#bae6fd',
    edge: { label: 'POST do formulário' } },
  { label: 'POST /auth/login', sub: 'Devolve access + refresh tokens', icon: SignIn, color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0',
    edge: { label: 'tokens no corpo', dashed: true } },
  { label: 'Cookie de sessão httpOnly', sub: 'Tokens ficam no servidor', icon: Cookie, color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
]

export default function AuthFlowDiagram() {
  return (
    <FlowDiagram
      nodes={nodes}
      caption="O navegador só guarda o cookie de sessão da sua própria aplicação — nunca os tokens do Notoriun. Para renovar, seu servidor reenvia o refresh token armazenado para GET /auth/refresh como um cabeçalho Cookie: LH_refresh=… (o endpoint só o lê a partir desse cookie)."
    />
  )
}
