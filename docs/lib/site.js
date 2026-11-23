/**
 * Deployment identity, injected at build time.
 *
 * A static export served from a repository subpath (GitHub Pages) needs the
 * basePath prepended by hand on every root-relative asset: Next.js applies it
 * to routes and bundles, but not to raw <img src>, favicons or the manifest.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_DOCS_SITE_URL || 'https://notoriun.github.io/learnhouse'

export const BASE_PATH = process.env.NEXT_PUBLIC_DOCS_BASE_PATH || ''

// Repository this site is published from -- the "edit this page" target.
export const REPO_URL = 'https://github.com/notoriun/learnhouse'

export const asset = (path) => `${BASE_PATH}${path}`
