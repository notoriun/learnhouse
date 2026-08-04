import { Metadata } from 'next'
import { getBrand } from '@services/config/brand'

export const metadata: Metadata = {
  title: 'Política de privacidade',
  robots: { index: false, follow: false },
}

/** Política de privacidade própria do fork (FR-011) — texto base provisório;
 * a operação comercial deve validá-lo juridicamente antes do go-live. */
export default function PrivacyPage() {
  const brand = getBrand()
  return (
    <main className="max-w-2xl mx-auto px-6 py-16 space-y-6 text-sm leading-relaxed text-gray-700">
      <h1 className="text-2xl font-bold text-gray-900">Política de privacidade</h1>
      <p>
        A plataforma {brand.name} coleta apenas os dados necessários para
        operar o serviço: dados de conta (nome, e-mail), progresso de
        aprendizagem e registros técnicos de acesso e segurança.
      </p>
      <p>
        Dados não são vendidos nem compartilhados para fins de publicidade.
        Organizações têm acesso aos dados de aprendizagem de seus próprios
        membros, conforme o escopo de cada organização.
      </p>
      <p>
        Para solicitar acesso, correção ou exclusão dos seus dados, contate{' '}
        <a className="underline" href={`mailto:${brand.contactEmail}`}>
          {brand.contactEmail}
        </a>
        .
      </p>
    </main>
  )
}
