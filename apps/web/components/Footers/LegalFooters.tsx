'use client'
// Shared legal/footer bits.
//
// AuthFooter   — the "By continuing, you agree to … Terms of Service and
//                Privacy Policy." line shown under the auth forms.
// CopyrightFooter — the "© {year} {legalName}" line for app surfaces
//                (the apex /home hub, the onboarding page, …).
//
// Legal pages live in-app under /legal — paths come from the brand module
// (feature 005), never hardcoded domains.
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { getBrand } from '@services/config/brand'
import { getConfig, getAPIUrl } from '@services/config/config'

const TERMS_URL = getBrand().legal.terms
const PRIVACY_URL = getBrand().legal.privacy

// Repositório público do fork — destino da oferta de código-fonte AGPL
// (feature 006). O link NUNCA desaparece: sem versão resolvida, aponta para a
// lista de releases (FR-001).
const FORK_REPO_URL = getConfig(
  'NEXT_PUBLIC_LEARNHOUSE_SOURCE_REPO_URL',
  'https://github.com/notoriun/learnhouse'
)

/** Link para a fonte da EXATA versão em execução (FR-005). Busca a versão da
 * instância uma vez; enquanto não resolve, cai para a lista de releases. */
function useSourceCodeUrl(): string {
  const [version, setVersion] = React.useState<string | null>(null)
  React.useEffect(() => {
    let alive = true
    fetch(`${getAPIUrl()}instance/info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.version && d.version !== 'unknown') setVersion(d.version)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return version
    ? `${FORK_REPO_URL}/releases/tag/${version}`
    : `${FORK_REPO_URL}/releases`
}

export function AuthFooter({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <div className={`pb-8 pt-6 text-center px-6 ${className}`}>
      <p className="text-[13px] text-black/30 font-medium">
        {t('auth.terms_text', { defaultValue: "By continuing, you agree to {{brand}}'s" })}{' '}
        <Link
          href={TERMS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-black/50 hover:text-black/70 transition-colors"
        >
          {t('auth.terms_of_service', { defaultValue: 'Terms of Service' })}
        </Link>{' '}
        {t('auth.and', { defaultValue: 'and' })}{' '}
        <Link
          href={PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-black/50 hover:text-black/70 transition-colors"
        >
          {t('auth.privacy_policy', { defaultValue: 'Privacy Policy' })}
        </Link>
        .
      </p>
    </div>
  )
}

export function CopyrightFooter({
  year,
  className = '',
  tone = 'light',
}: {
  year: number
  className?: string
  // `light` → dark text on light bg; `dark` → light text on dark bg.
  tone?: 'light' | 'dark'
}) {
  const { t } = useTranslation()
  const base = tone === 'dark' ? 'text-white/40' : 'text-black/35'
  const link = tone === 'dark' ? 'text-white/60 hover:text-white/80' : 'text-black/55 hover:text-black/75'
  const sourceUrl = useSourceCodeUrl()
  return (
    <footer className={`w-full py-6 px-6 ${className}`}>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-x-5 gap-y-2 text-[13px] font-medium">
        <p className={base}>
          {t('common.copyright', { defaultValue: '© {{year}} {{legalName}}', year })}
        </p>
        <nav className="flex items-center gap-x-5">
          <Link
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${link} transition-colors`}
          >
            {t('auth.terms_of_service', { defaultValue: 'Terms of Service' })}
          </Link>
          <Link
            href={PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${link} transition-colors`}
          >
            {t('auth.privacy_policy', { defaultValue: 'Privacy Policy' })}
          </Link>
          <Link
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${link} transition-colors`}
          >
            {t('common.source_code', { defaultValue: 'Código-fonte (AGPL-3.0)' })}
          </Link>
          <Link
            href={getBrand().legal.attribution}
            className={`${link} transition-colors`}
          >
            {t('common.legal_notices', { defaultValue: 'Informações legais' })}
          </Link>
        </nav>
      </div>
    </footer>
  )
}
