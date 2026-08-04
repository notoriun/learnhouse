import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { getBrand } from '@services/config/brand'

export default function NotFound() {
  const brand = getBrand()
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-gray-50 px-6 text-center">
      <img
        src={brand.logos.symbol}
        alt={brand.name}
        width={56}
        height={56}
        className="mb-10 opacity-90"
      />
      <h1 className="text-7xl font-black tracking-tight text-black">404</h1>
      <p className="mt-6 max-w-md text-gray-600 leading-relaxed">
        Esta página não existe ou foi removida. Verifique o endereço ou volte ao início.
      </p>
      <Link
        href="/"
        className="mt-8 flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-black/85"
      >
        Voltar ao início
        <ArrowRight size={16} />
      </Link>
    </div>
  )
}
