import { notFound } from 'next/navigation'
import { API_GROUPS, groupBySlug } from '../../../lib/reference/config'
import { SITE_URL } from '../../../lib/site'
import { getSpec } from '../../../lib/reference/fetch-spec'
import { buildGroupModel } from '../../../lib/reference/build-model'
import OperationArticle from '../../../components/reference/OperationArticle'

export const revalidate = 3600
export const dynamicParams = false

export function generateStaticParams() {
  return API_GROUPS.map((g) => ({ group: g.slug }))
}

export async function generateMetadata({ params }) {
  const { group } = await params
  const config = groupBySlug(group)
  if (!config) return {}
  return {
    title: `${config.title} — Referência de API`,
    description: config.description,
    alternates: { canonical: `/reference/${config.slug}` },
  }
}

export default async function GroupPage({ params }) {
  const { group } = await params
  const spec = await getSpec()
  const model = await buildGroupModel(spec, group)
  if (!model || model.operations.length === 0) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'APIReference',
    name: `API do Notoriun — ${model.title}`,
    description: model.description,
    url: `${SITE_URL}/reference/${model.slug}`,
    programmingModel: 'REST',
    targetPlatform: 'Notoriun',
    isPartOf: {
      '@type': 'WebSite',
      name: 'Documentação Notoriun',
      url: SITE_URL,
    },
  }

  return (
    <div className="lh-ref-group">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="lh-ref-group-head">
        <h1 className="lh-ref-group-title">{model.title}</h1>
        <p className="lh-ref-group-desc">{model.description}</p>
      </header>
      {model.operations.map((op) => (
        <OperationArticle key={op.id} op={op} />
      ))}
    </div>
  )
}
