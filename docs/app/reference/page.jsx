import Link from 'next/link'
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { API_BASE_URL } from '../../lib/reference/config'
import { getSpec } from '../../lib/reference/fetch-spec'
import { buildGroupDirectory, validationErrorFields } from '../../lib/reference/build-model'
import { buildSnippets } from '../../lib/reference/snippets'
import { highlight } from '../../lib/reference/highlight'
import TokenWidget from '../../components/reference/TokenWidget'
import CodePanel from '../../components/reference/CodePanel'
import SchemaFields from '../../components/reference/SchemaFields'

export const revalidate = 3600

export const metadata = {
  title: 'Referência de API',
  description:
    'Referência completa da API REST do Notoriun — endpoints, esquemas de requisição e resposta, exemplos de código e um playground ao vivo.',
  alternates: { canonical: '/reference' },
}

const ERROR_STATUSES = [
  ['401', 'Credenciais ausentes ou inválidas.'],
  ['403', 'Autenticado, mas sem permissão para executar esta ação.'],
  ['404', 'O recurso solicitado não existe.'],
  ['409', 'A requisição conflita com o estado existente (ex.: recurso duplicado).'],
  ['422', 'A validação da requisição falhou — veja o formato de erro abaixo.'],
  ['429', 'Limite de requisições excedido — tente novamente mais tarde.'],
]

export default async function ReferenceOverviewPage() {
  const spec = await getSpec()
  const directory = buildGroupDirectory(spec)
  const totalOps = directory.reduce((sum, g) => sum + g.count, 0)
  const errorFields = validationErrorFields(spec)

  const exampleRaw = buildSnippets({
    method: 'GET',
    url: `${API_BASE_URL}/api/v1/users/profile`,
    auth: true,
  })
  const exampleSnippets = {
    curl: { raw: exampleRaw.curl, html: await highlight(exampleRaw.curl, 'bash') },
    js: { raw: exampleRaw.js, html: await highlight(exampleRaw.js, 'javascript') },
    python: { raw: exampleRaw.python, html: await highlight(exampleRaw.python, 'python') },
  }

  return (
    <div className="lh-ref-overview">
      <header className="lh-ref-overview-head">
        <p className="lh-ref-overview-kicker">Referência de API</p>
        <h1 className="lh-ref-overview-title">A API do Notoriun</h1>
        <p className="lh-ref-overview-lede">
          Uma API REST para operar o Notoriun de forma programática — {totalOps} endpoints
          documentados entre cursos, alunos, tarefas, pagamentos e muito mais. Esta referência é
          gerada diretamente a partir da especificação OpenAPI em produção, então está sempre
          sincronizada com a API.
        </p>
      </header>

      <div className="lh-ref-op-grid">
        <div className="lh-ref-op-prose">
          <section className="lh-ref-section">
            <h2 className="lh-ref-overview-h2">URL Base</h2>
            <p className="lh-ref-op-desc">
              Todos os endpoints vivem sob <code>/api/v1</code>. Instâncias self-hosted usam o
              próprio domínio.
            </p>
            <pre className="lh-ref-baseurl">
              {API_BASE_URL}/api/v1
            </pre>
          </section>

          <section className="lh-ref-section">
            <h2 className="lh-ref-overview-h2">Autenticação</h2>
            <p className="lh-ref-op-desc">
              O acesso programático usa tokens de API da organização, com prefixo <code>lh_</code>.
              Crie-os no seu painel em <strong>Desenvolvedores → Acesso à API</strong> (plano Pro) —
              o token completo é exibido uma única vez, na criação, e pode ser restrito ao menor
              privilégio necessário. Envie-o como bearer token em cada requisição:
            </p>
            <pre className="lh-ref-baseurl">Authorization: Bearer lh_…</pre>
            <p className="lh-ref-op-desc">
              Fluxos no contexto do usuário podem usar em vez disso o JWT devolvido pelo{' '}
              <Link href="/reference/auth">endpoint de login</Link> (form-encoded, não JSON) como
              bearer token. Veja o{' '}
              <Link href="/developers/api/authentication">guia de autenticação</Link> para
              detalhes.
            </p>
          </section>

          <section className="lh-ref-section">
            <h2 className="lh-ref-overview-h2">Erros</h2>
            <p className="lh-ref-op-desc">
              Erros retornam códigos de status HTTP convencionais com um corpo JSON no formato{' '}
              <code>{'{ "detail": "…" }'}</code>. Falhas de validação retornam <code>422</code>{' '}
              com a estrutura abaixo.
            </p>
            <div className="lh-ref-statustable">
              {ERROR_STATUSES.map(([status, description]) => (
                <div key={status} className="lh-ref-statustable-row">
                  <code className="lh-ref-errors-status">{status}</code>
                  <span>{description}</span>
                </div>
              ))}
            </div>
            {errorFields.length > 0 && (
              <details className="lh-ref-errors">
                <summary>Formato do erro de validação 422</summary>
                <SchemaFields fields={errorFields} />
              </details>
            )}
          </section>

          <section className="lh-ref-section">
            <h2 className="lh-ref-overview-h2">Paginação</h2>
            <p className="lh-ref-op-desc">
              Endpoints de listagem paginam com os parâmetros <code>page</code> e{' '}
              <code>limit</code> — como parâmetros de query ou segmentos de caminho (ex.:{' '}
              <code>/courses/org_slug/{'{org_slug}'}/page/1/limit/20</code>), dependendo do
              endpoint. A numeração de página começa em 1.
            </p>
          </section>
        </div>

        <div className="lh-ref-op-code">
          <div className="lh-ref-overview-token">
            <p className="lh-ref-overview-token-title">Seu token de API</p>
            <TokenWidget />
          </div>
          <CodePanel snippets={exampleSnippets} title="Sua primeira requisição" />
        </div>
      </div>

      <section className="lh-ref-section">
        <h2 className="lh-ref-overview-h2">Explore a API</h2>
        <div className="lh-ref-directory">
          {directory.map((group) => (
            <Link key={group.slug} href={`/reference/${group.slug}`} className="lh-ref-card">
              <div className="lh-ref-card-head">
                <span className="lh-ref-card-title">{group.title}</span>
                <span className="lh-ref-card-count">{group.count}</span>
              </div>
              <p className="lh-ref-card-desc">{group.description}</p>
              <span className="lh-ref-card-arrow">
                <ArrowRight size={14} weight="bold" />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
