import { Metadata } from 'next'
import { getBrand } from '@services/config/brand'

export const metadata: Metadata = {
  title: 'Termos de uso',
  robots: { index: false, follow: false },
}

/** Termos próprios do fork (FR-011) — texto base provisório; a operação
 * comercial deve validá-lo juridicamente antes do go-live. */
export default function TermsPage() {
  const brand = getBrand()
  return (
    <main className="max-w-2xl mx-auto px-6 py-16 space-y-6 text-sm leading-relaxed text-gray-700">
      <h1 className="text-2xl font-bold text-gray-900">Termos de uso</h1>
      <p>
        Ao utilizar a plataforma {brand.name}, você concorda com estes termos.
        A plataforma é fornecida &quot;como está&quot;, sem garantias, nos
        limites da legislação aplicável e da licença AGPL-3.0.
      </p>
      <p>
        O conteúdo publicado pelas organizações e por seus usuários é de
        responsabilidade de quem o publica. Uso abusivo, ilegal ou que
        comprometa a segurança do serviço pode resultar em suspensão de acesso.
      </p>
      <p>
        Dúvidas sobre estes termos:{' '}
        <a className="underline" href={`mailto:${brand.contactEmail}`}>
          {brand.contactEmail}
        </a>
        .
      </p>
    </main>
  )
}
