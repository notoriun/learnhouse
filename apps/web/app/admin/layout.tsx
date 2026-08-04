import type { Metadata } from 'next'
import AdminProviders from './providers'
import React from 'react'
import { getBrand } from '@services/config/brand'

const brand = getBrand()

export const metadata: Metadata = {
  title: {
    template: `%s | ${brand.name} Admin`,
    default: `${brand.name} Admin`,
  },
}

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AdminProviders>{children}</AdminProviders>
}
