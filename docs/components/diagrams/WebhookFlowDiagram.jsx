'use client'

import { Lightning, Cube, ShieldCheck, CheckCircle } from '@phosphor-icons/react/dist/ssr'
import FlowDiagram from './FlowDiagram'

// Como um webhook chega ao seu receptor e é verificado.
const nodes = [
  { label: 'Evento acontece', sub: 'ex.: course_completed', icon: Lightning, color: '#f59e0b', bg: '#fffbeb', border: '#fde68a',
    edge: { label: 'assina o payload' } },
  { label: 'API do Notoriun', sub: 'HMAC-SHA256 sobre o corpo', icon: Cube, color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0',
    edge: { label: 'POST assinado' } },
  { label: 'Seu endpoint', sub: 'Verifica X-Webhook-Signature', icon: ShieldCheck, color: '#0ea5e9', bg: '#e0f2fe', border: '#bae6fd',
    edge: { label: 'válido → processa' } },
  { label: 'Retorna 2xx', sub: 'Entrega registrada', icon: CheckCircle, color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
]

export default function WebhookFlowDiagram() {
  return (
    <FlowDiagram
      nodes={nodes}
      caption="Recalcule o HMAC-SHA256 do corpo bruto da requisição com o segredo do seu endpoint e compare com X-Webhook-Signature antes de confiar no payload. Se o seu endpoint não retornar 2xx, o Notoriun tenta novamente — até 3 tentativas, esperando 1s e depois 4s entre elas."
    />
  )
}
