'use client'

import Link from 'next/link'
import { REPO_URL } from '../../lib/site'

const links = [
  { label: 'Documentação', href: '/' },
  { label: 'GitHub', href: REPO_URL },
]

export default function Footer() {
  return (
    <footer className="lh-footer">
      <div className="lh-footer-container">
        <p className="lh-footer-copyright">
          &copy; {new Date().getFullYear()} Notoriun
        </p>
        <nav className="lh-footer-nav">
          {links.map((link) => {
            const isExternal = link.href.startsWith('http')
            const Tag = isExternal ? 'a' : Link
            const props = isExternal
              ? { href: link.href, target: '_blank', rel: 'noopener noreferrer' }
              : { href: link.href }
            return (
              <Tag key={link.label} {...props} className="lh-footer-link">
                {link.label}
              </Tag>
            )
          })}
        </nav>
      </div>
    </footer>
  )
}
