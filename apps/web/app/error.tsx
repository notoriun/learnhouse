'use client'

import { useEffect, useState } from 'react'
import { Home, RefreshCcw } from 'lucide-react'
import { captureError } from '@lib/errors/report'
import { getBrand } from '@services/config/brand'
import { useTrackView, AnalyticsEvent } from '@services/analytics'

// Boundary de erro das rotas (dentro dos providers). Captura no Sentry,
// recarrega em erros de deploy obsoleto e mostra uma tela pt-BR com ações
// de recuperação (Tom de voz — specs/005-rebranding-visual/data-model.md).

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const brand = getBrand()
  const [eventId, setEventId] = useState<string | undefined>()

  useTrackView(
    AnalyticsEvent.ErrorViewShown,
    {
      error_digest: error.digest,
      path: typeof window !== 'undefined' ? window.location.pathname : undefined,
    },
    true,
    'public',
  )

  useEffect(() => {
    const msg = error?.message || ''
    // Deploy novo invalidou os chunks/server actions desta página — recarregar
    // é a única correção real.
    if (
      msg.includes('Failed to find Server Action') ||
      msg.includes('older or newer deployment') ||
      error?.name === 'ChunkLoadError' ||
      msg.includes('Loading chunk')
    ) {
      window.location.reload()
      return
    }
    setEventId(captureError(error))
    console.error(error)
  }, [error])

  const btn =
    'flex items-center gap-2 px-6 py-3 rounded-full font-bold text-sm transition-colors'

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-gray-50 px-6 text-center">
      <img
        src={brand.logos.symbol}
        alt={brand.name}
        width={56}
        height={56}
        className="mb-10 opacity-90"
      />
      <h1 className="text-2xl md:text-3xl font-black tracking-tight text-black">
        Algo deu errado
      </h1>
      <p className="mt-4 max-w-md text-gray-600 leading-relaxed">
        Ocorreu um erro inesperado. Tente novamente ou volte ao início. Se o
        problema continuar, contate o suporte.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button onClick={() => reset()} className={`${btn} bg-black text-white hover:bg-black/85`}>
          <RefreshCcw size={16} />
          <span>Tentar novamente</span>
        </button>
        <a href="/" className={`${btn} bg-gray-200 text-gray-700 hover:bg-gray-300`}>
          <Home size={16} />
          <span>Voltar ao início</span>
        </a>
      </div>
      {(error?.digest || eventId) && (
        <p className="mt-8 text-xs font-mono text-gray-400">
          {error?.digest && <>ref {error.digest}</>}
          {error?.digest && eventId && ' · '}
          {eventId && <>evento {eventId}</>}
        </p>
      )}
    </div>
  )
}
