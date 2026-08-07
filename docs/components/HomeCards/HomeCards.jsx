'use client'

import Link from 'next/link'
import {
  RocketLaunch,
  BookOpen,
  Cloud,
  Code,
  GraduationCap,
} from '@phosphor-icons/react/dist/ssr'

const cards = [
  {
    href: '/getting-started',
    icon: RocketLaunch,
    color: '#6366f1',
    title: 'Primeiros Passos',
    desc: 'Configure sua primeira organização e curso em minutos',
    pattern: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
    patternSize: '14px 14px',
  },
  {
    href: '/platform',
    icon: BookOpen,
    color: '#10b981',
    title: 'Guia da Plataforma',
    desc: 'Cursos, editor, IA, tarefas e muito mais',
    pattern: 'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
    patternSize: '20px 20px',
  },
  {
    href: '/self-hosting',
    icon: Cloud,
    color: '#f97316',
    title: 'Self Hosting',
    desc: 'Implante na sua própria infraestrutura com a CLI',
    pattern: 'repeating-linear-gradient(45deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 8px)',
    patternSize: '12px 12px',
  },
  {
    href: '/developers',
    icon: Code,
    color: '#8b5cf6',
    title: 'Desenvolvedores',
    desc: 'Arquitetura, API REST e guia de contribuição',
    pattern: 'repeating-linear-gradient(0deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 6px)',
    patternSize: '6px 6px',
  },
  {
    href: '/guides',
    icon: GraduationCap,
    color: '#0ea5e9',
    title: 'Guias',
    desc: 'Construa sua própria plataforma de aprendizagem e recursos personalizados',
    pattern: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
    patternSize: '16px 16px',
  },
]

export default function HomeCards() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, margin: '32px 0' }}>
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Link
            key={card.href}
            href={card.href}
            className="nice-shadow"
            style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '22px 24px',
              borderRadius: 16,
              background: '#fff',
              overflow: 'hidden',
              position: 'relative',
              textDecoration: 'none',
              transition: 'transform 0.15s ease',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {/* Pattern */}
            <div
              style={{
                position: 'absolute', inset: 0,
                pointerEvents: 'none',
                opacity: 0.05,
                color: card.color,
                backgroundImage: card.pattern,
                backgroundSize: card.patternSize,
                maskImage: 'linear-gradient(to right, black 0%, transparent 60%)',
                WebkitMaskImage: 'linear-gradient(to right, black 0%, transparent 60%)',
              }}
            />

            {/* Icon */}
            <div
              style={{
                position: 'relative', zIndex: 1,
                flexShrink: 0,
                width: 42, height: 42,
                borderRadius: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: card.color + '10',
              }}
            >
              <Icon size={20} weight="duotone" style={{ color: card.color }} />
            </div>

            {/* Text */}
            <div style={{ position: 'relative', zIndex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 650, color: '#1a1a1a', lineHeight: 1.3, margin: 0 }}>{card.title}</div>
              <div style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.45, margin: 0, marginTop: 3 }}>{card.desc}</div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
