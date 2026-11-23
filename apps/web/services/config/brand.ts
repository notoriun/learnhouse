/**
 * Módulo de marca do fork (feature 005) — fonte ÚNICA da identidade visível.
 *
 * Toda superfície (UI, e-mails do web, metadados) consome getBrand() em vez de
 * literais. A troca do nome final é configuração (runtime config / env) +
 * substituição dos ARQUIVOS em /public/brand/ — nunca retrabalho de código
 * (research D2; contracts/branding.md §1).
 *
 * Identificadores técnicos (cookies LH_*, envs com prefixo herdado do upstream) NÃO passam por
 * aqui e não mudam (FR-009/ADR-07).
 */

import { getConfig } from '@services/config/config'

export interface BrandLogos {
  /** Logo horizontal (símbolo + nome) para fundos claros. */
  horizontal: string
  /** Variante do horizontal para fundos escuros. */
  horizontalDark: string
  /** Símbolo isolado (quadrado) — app icons, avatares, watermark. */
  symbol: string
  /** Símbolo para fundos escuros. */
  symbolDark: string
  /** Versão monocromática (contornos) — contextos de uma cor. */
  mono: string
  monoDark: string
  /** Versão reduzida, legível em 16 px. */
  small: string
  favicon: string
  ogImage: string
}

export interface BrandLegal {
  /** Página de atribuição/licença — único lugar com o nome do projeto de origem. */
  attribution: string
  terms: string
  privacy: string
}

export interface Brand {
  /** Nome de exibição do produto. */
  name: string
  /** Nome legal usado no copyright do rodapé. */
  legalName: string
  /** Tagline curta para metadados/OG. */
  tagline: string
  /** Canal de contato/suporte do fork. */
  contactEmail: string
  logos: BrandLogos
  legal: BrandLegal
}

// Marca PROVISÓRIA (decisão de nome final pendente — Produto/Jurídico).
// A troca definitiva altera estes defaults/envs e os arquivos de /brand/.
const PROVISIONAL_NAME = 'Notoriun'
const PROVISIONAL_TAGLINE = 'Plataforma aberta de aprendizagem'

export function getBrand(): Brand {
  const name = getConfig('NEXT_PUBLIC_LEARNHOUSE_SITE_NAME', PROVISIONAL_NAME)
  return {
    name,
    legalName: getConfig('NEXT_PUBLIC_LEARNHOUSE_LEGAL_NAME', name),
    tagline: getConfig('NEXT_PUBLIC_LEARNHOUSE_SITE_DESCRIPTION', PROVISIONAL_TAGLINE),
    contactEmail: getConfig('NEXT_PUBLIC_LEARNHOUSE_CONTACT_EMAIL', `contato@${name.toLowerCase()}.app`),
    logos: {
      horizontal: '/brand/logo-horizontal.svg',
      horizontalDark: '/brand/logo-horizontal-dark.svg',
      symbol: '/brand/logo-symbol.svg',
      symbolDark: '/brand/logo-symbol-dark.svg',
      mono: '/brand/logo-mono.svg',
      monoDark: '/brand/logo-mono-dark.svg',
      small: '/brand/logo-small.svg',
      favicon: '/brand/favicon.ico',
      ogImage: '/brand/og-default.png',
    },
    legal: {
      attribution: '/legal',
      terms: '/legal/terms',
      privacy: '/legal/privacy',
    },
  }
}
