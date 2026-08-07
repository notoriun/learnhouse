import { Layout } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'
import '../styles.css'
import { Analytics } from '@vercel/analytics/react'
import CustomNavbar from '../components/Navbar/Navbar'
import CustomFooter from '../components/Footer/Footer'
import PostHogProvider from '../components/Analytics/PostHogProvider'

export const metadata = {
  title: {
    default: 'Documentação Notoriun',
    template: '%s – Documentação Notoriun',
  },
  description:
    'Documentação oficial do Notoriun, a plataforma de aprendizagem de código aberto. Guias para self-hosting, criação de cursos, recursos de IA, referência de API e muito mais.',
  keywords: [
    'Notoriun',
    'LMS de código aberto',
    'plataforma de aprendizagem',
    'LMS self-hosted',
    'criação de cursos',
    'documentação Notoriun',
    'docs Notoriun',
  ],
  metadataBase: new URL('https://docs.notoriun.com.br'),
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    url: 'https://docs.notoriun.com.br',
    siteName: 'Documentação Notoriun',
    description:
      'Documentação oficial do Notoriun, a plataforma de aprendizagem de código aberto. Guias para self-hosting, criação de cursos, recursos de IA, referência de API e muito mais.',
  },
  icons: {
    icon: [
      { url: '/favicons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/favicons/apple-touch-icon.png',
  },
  manifest: '/favicons/site.webmanifest',
}

export default async function RootLayout({ children }) {
  return (
    <html lang="pt-BR" dir="ltr" suppressHydrationWarning>
      <Head faviconGlyph="">
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Wix+Madefor+Text:ital,wght@0,400..700;1,400..700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Wix+Madefor+Display:wght@600;700;800;900&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      <body>
        <PostHogProvider>
          <CustomNavbar />
          <Layout
            pageMap={await getPageMap()}
            docsRepositoryBase="https://github.com/notoriun/learnhouse/tree/dev/docs"
            sidebar={{ defaultMenuCollapseLevel: 2 }}
            editLink="Editar esta página no GitHub"
            footer={<></>}
            navbar={<></>}
            nextThemes={{ forcedTheme: 'light', defaultTheme: 'light' }}
          >
            {children}
          </Layout>
          <CustomFooter />
        </PostHogProvider>
        <Analytics />
      </body>
    </html>
  )
}
