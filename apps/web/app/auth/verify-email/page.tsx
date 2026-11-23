import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getAuthOrgSlug } from '@services/org/orgResolution'
import { getBrand } from '@services/config/brand'
import VerifyEmailClient from './verify-email'
import { Metadata } from 'next'
import OrgNotFound from '@components/Objects/StyledElements/Error/OrgNotFound'
import { Suspense } from 'react'
import PageLoading from '@components/Objects/Loaders/PageLoading'

export async function generateMetadata(): Promise<Metadata> {
  const orgslug = await getAuthOrgSlug()

  if (!orgslug) {
    // Apex (org-less) — o template do layout raiz anexa o nome da marca.
    return { title: 'Verificar e-mail' }
  }

  let org: any = null
  try {
    org = await getOrganizationContextInfo(orgslug, {
      revalidate: 60,
      tags: ['organizations'],
    })
  } catch {
    // Stale cookie or unknown org — fall back to generic title
  }

  return {
    // `absolute` evita que o template do layout raiz duplique o sufixo da marca.
    title: { absolute: `Verificar e-mail — ${org?.name || getBrand().name}` },
    robots: { index: false, follow: false },
  }
}

const VerifyEmailPage = async () => {
  const orgslug = await getAuthOrgSlug()

  let org: any = null
  if (orgslug) {
    try {
      org = await getOrganizationContextInfo(orgslug, {
        revalidate: 60,
        tags: ['organizations'],
      })
    } catch {
      org = null
    }
    if (!org) {
      return <OrgNotFound />
    }
  }

  return (
    <Suspense fallback={<PageLoading />}>
      <VerifyEmailClient org={org} />
    </Suspense>
  )
}

export default VerifyEmailPage
