'use client'

import Sidebar from '../Sidebar/Sidebar'
import TOC from '../TOC/TOC'
import { useConfig } from 'nextra-theme-docs'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { PencilSimple } from '@phosphor-icons/react/dist/ssr'
import { REPO_URL } from '../../lib/site'

function Breadcrumb() {
  const config = useConfig()
  const { activePath } = config.normalizePagesResult

  if (!activePath || activePath.length <= 1) return null

  // Nextra emits both a folder entry and its index page with the same route
  // (e.g. /developers/migration appears twice once you open /developers/migration).
  // Collapse consecutive duplicates so React keys stay unique and the trail
  // does not show the same crumb twice.
  const trail = activePath.filter((item, i, arr) => {
    const next = arr[i + 1]
    return !next || next.route !== item.route
  })

  return (
    <nav className="lh-breadcrumb" aria-label="breadcrumb">
      {trail.map((item, i) => {
        const isLast = i === trail.length - 1
        const title = typeof item.title === 'string' ? item.title : item.name
        return (
          <span key={`${item.route || ''}-${i}`} className="lh-breadcrumb-item">
            {i > 0 && <span className="lh-breadcrumb-sep">/</span>}
            {isLast ? (
              <span className="lh-breadcrumb-current">{title}</span>
            ) : (
              <Link href={item.route || '#'} className="lh-breadcrumb-link">
                {title}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}

function Pagination() {
  const config = useConfig()
  const { flatDocsDirectories, activeIndex } = config.normalizePagesResult

  const prev = activeIndex > 0 ? flatDocsDirectories[activeIndex - 1] : null
  const next = activeIndex < flatDocsDirectories.length - 1 ? flatDocsDirectories[activeIndex + 1] : null

  if (!prev && !next) return null

  return (
    <div className="lh-pagination">
      {prev ? (
        <Link href={prev.route} className="lh-pagination-link lh-pagination-prev">
          <span className="lh-pagination-label">Anterior</span>
          <span className="lh-pagination-title">
            {typeof prev.title === 'string' ? prev.title : prev.name}
          </span>
        </Link>
      ) : <div />}
      {next ? (
        <Link href={next.route} className="lh-pagination-link lh-pagination-next">
          <span className="lh-pagination-label">Próximo</span>
          <span className="lh-pagination-title">
            {typeof next.title === 'string' ? next.title : next.name}
          </span>
        </Link>
      ) : <div />}
    </div>
  )
}

function EditOnGitHub({ filePath }) {
  // `filePath` vem dos metadados de página do Nextra e é o caminho real do
  // arquivo-fonte relativo à raiz do app de docs (ex.: "content/cli/index.mdx").
  // O app de docs vive em docs/ dentro do monorepo, daí o prefixo. Usar isso
  // direto evita ter que adivinhar índice de pasta vs. arquivo-folha pela URL.
  if (!filePath) return null

  const href = `${REPO_URL}/edit/dev/docs/${filePath}`

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="lh-edit-github"
    >
      <PencilSimple size={13} weight="bold" />
      Editar no GitHub
    </a>
  )
}

function LastEdited({ timestamp }) {
  if (!timestamp) return null

  const date = new Date(timestamp).toLocaleDateString('pt-BR', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="lh-last-edited">
      Última edição em {date}
    </div>
  )
}

export default function Wrapper({ children, toc, metadata }) {
  const pathname = usePathname()
  const isHome = pathname === '/'

  return (
    <div className="lh-page">
      <Sidebar />
      <div className="lh-content-area">
        <article className="lh-article">
          <div className="lh-article-header">
            <Breadcrumb />
            {!isHome && <EditOnGitHub filePath={metadata?.filePath} />}
          </div>
          <div className="lh-prose">
            {children}
          </div>
          {!isHome && (
            <div className="lh-article-footer">
              <LastEdited timestamp={metadata?.timestamp} />
            </div>
          )}
          <Pagination />
        </article>
        <div className="lh-toc">
          {toc && toc.length > 0 && (
            <TOC headings={toc} />
          )}
        </div>
      </div>
    </div>
  )
}
