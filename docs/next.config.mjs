import nextra from 'nextra'

const withNextra = nextra({ search: true })

// Static export (GitHub Pages): no server, so directory-style URLs, a
// repo-name basePath and no headers -- the host serves plain files.
const staticExport = process.env.DOCS_STATIC_EXPORT === '1'

const serverOptions = {
  // Empacota apenas o necessário para rodar em produção (server.js + node_modules
  // rastreados), o que mantém a imagem Docker enxuta. Não inclui public/ nem
  // .next/static — ambos são copiados explicitamente no Dockerfile.docs.
  output: 'standalone',
  trailingSlash: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

const exportOptions = {
  output: 'export',
  basePath: process.env.NEXT_PUBLIC_DOCS_BASE_PATH || '',
  images: { unoptimized: true },
}

export default withNextra({
  trailingSlash: staticExport,
  ...(staticExport ? exportOptions : serverOptions),
})
