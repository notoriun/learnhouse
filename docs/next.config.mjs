import nextra from 'nextra'

const withNextra = nextra({ search: true })

export default withNextra({
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
})
