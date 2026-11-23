'use client'

import { Browser, Stack, Cube } from '@phosphor-icons/react/dist/ssr'
import FlowDiagram from './FlowDiagram'

// Navegador → seu app Next.js (BFF) → API do Notoriun. A mídia é entregue
// direto pelo endpoint de entrega de conteúdo da API.
const nodes = [
  { label: 'Navegador', sub: 'Seus alunos', icon: Browser, color: '#6366f1', bg: '#eef2ff', border: '#c7d2fe',
    edge: { label: 'HTTP' } },
  { label: 'Seu app Next.js', sub: 'Server Components + BFF Route Handlers', icon: Stack, color: '#0ea5e9', bg: '#e0f2fe', border: '#bae6fd',
    edge: { label: 'REST + Bearer' } },
  { label: 'API do Notoriun', sub: '/api/v1', icon: Cube, color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0' },
]

export default function HeadlessArchitecture() {
  return (
    <FlowDiagram
      nodes={nodes}
      caption="As leituras acontecem em Server Components; tudo que envolve token passa por um Route Handler atuando como Backend-for-Frontend, então os tokens nunca chegam ao navegador. Mídia (miniaturas, vídeo, arquivos) é entregue direto pelo endpoint de entrega de conteúdo do backend em /content/… (servido na raiz, não sob /api/v1)."
    />
  )
}
