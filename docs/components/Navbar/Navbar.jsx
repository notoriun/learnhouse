'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Search } from 'nextra/components'
import { GithubLogo, Code, ArrowUpRight, List, X, BracketsCurly } from '@phosphor-icons/react/dist/ssr'

function Navbar() {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  useEffect(() => setMounted(true), [])

  // Close mobile menu on route change
  useEffect(() => {
    const handleRouteChange = () => setMobileMenuOpen(false)
    window.addEventListener('popstate', handleRouteChange)
    return () => window.removeEventListener('popstate', handleRouteChange)
  }, [])

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileMenuOpen])

  const logoSrc = '/img/logos/notoriun-dark.svg'

  return (
    <>
      <div className="lh-navbar">
        <div className="lh-navbar-inner">
          {/* Left: logo + nav */}
          <div className="lh-navbar-left">
            <Link href="/" className="lh-navbar-logo">
              {mounted ? (
                <img src={logoSrc} alt="Notoriun" />
              ) : (
                <div style={{ width: 100, height: 20 }} />
              )}
            </Link>

            <span className="lh-navbar-badge">docs</span>

            <nav className="lh-navbar-nav lh-hide-mobile">
              <Link
                href="/developers"
                className="lh-navbar-nav-item"
              >
                <Code size={15} weight="fill" />
                Developers
              </Link>
              <Link
                href="/reference"
                className="lh-navbar-nav-item"
              >
                <BracketsCurly size={15} weight="fill" />
                API Reference
              </Link>
            </nav>
          </div>

          {/* Right: search + links + hamburger */}
          <div className="lh-navbar-right">
            <Search className="lh-navbar-search" placeholder="Search docs..." />
            <a
              href="https://github.com/notoriun/learnhouse"
              target="_blank"
              rel="noopener noreferrer"
              className="lh-navbar-nav-item lh-hide-mobile"
            >
              <GithubLogo size={16} weight="fill" />
              GitHub
            </a>

            {/* Mobile hamburger */}
            <button
              className="lh-mobile-menu-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileMenuOpen ? <X size={20} weight="bold" /> : <List size={20} weight="bold" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="lh-mobile-overlay" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Mobile sidebar drawer */}
      <div className={`lh-mobile-drawer ${mobileMenuOpen ? 'lh-mobile-drawer-open' : ''}`}>
        <div className="lh-mobile-drawer-links">
          <Link href="/developers" className="lh-mobile-drawer-link" onClick={() => setMobileMenuOpen(false)}>
            <Code size={16} weight="fill" />
            Developers
          </Link>
          <Link href="/reference" className="lh-mobile-drawer-link" onClick={() => setMobileMenuOpen(false)}>
            <BracketsCurly size={16} weight="fill" />
            API Reference
          </Link>
          <a href="https://github.com/notoriun/learnhouse" target="_blank" rel="noopener noreferrer" className="lh-mobile-drawer-link">
            <GithubLogo size={16} weight="fill" />
            GitHub
          </a>
        </div>
        <div className="lh-mobile-drawer-sidebar" id="mobile-sidebar-mount" />
      </div>
    </>
  )
}

export default Navbar
