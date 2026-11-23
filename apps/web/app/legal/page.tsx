import Link from 'next/link'
import { Metadata } from 'next'
import { getBrand } from '@services/config/brand'

export const metadata: Metadata = {
  title: 'Informações legais',
  robots: { index: false, follow: false },
}

/**
 * Área legal (feature 005, FR-008) — o ÚNICO lugar da interface onde o nome do
 * projeto de origem aparece (atribuição AGPL), sem uso promocional.
 */
export default function LegalPage() {
  const brand = getBrand()
  return (
    <main className="max-w-2xl mx-auto px-6 py-16 space-y-8 text-sm leading-relaxed text-gray-700">
      <h1 className="text-2xl font-bold text-gray-900">Informações legais</h1>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Licença e código-fonte</h2>
        <p>
          {brand.name} é software livre, licenciado sob a{' '}
          <a
            className="underline"
            href="https://www.gnu.org/licenses/agpl-3.0.html"
            rel="noopener noreferrer"
            target="_blank"
          >
            GNU Affero General Public License v3.0 (AGPL-3.0)
          </a>
          . O código-fonte correspondente à versão em execução está disponível
          gratuitamente a todos os usuários deste serviço.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Atribuição</h2>
        <p>
          Este produto é um trabalho derivado do projeto de código aberto{' '}
          <a
            className="underline"
            href="https://github.com/learnhouse/learnhouse"
            rel="noopener noreferrer"
            target="_blank"
          >
            LearnHouse
          </a>
          , cujos avisos de copyright e licença são preservados no repositório.
        </p>
        <p className="font-medium">
          {brand.name} é um produto independente, não afiliado, não endossado e
          não patrocinado pela LearnHouse, Inc. &quot;LearnHouse&quot; é marca de
          seus respectivos titulares e aparece aqui apenas como atribuição
          factual exigida pela licença.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Documentos</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <Link className="underline" href={brand.legal.terms}>
              Termos de uso
            </Link>
          </li>
          <li>
            <Link className="underline" href={brand.legal.privacy}>
              Política de privacidade
            </Link>
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Contato e segurança</h2>
        <p>
          Suporte:{' '}
          <a className="underline" href={`mailto:${brand.contactEmail}`}>
            {brand.contactEmail}
          </a>
          . Vulnerabilidades de segurança: reporte de forma privada ao mesmo
          canal com o assunto &quot;Segurança&quot; — não as divulgue
          publicamente antes da correção.
        </p>
      </section>
    </main>
  )
}
