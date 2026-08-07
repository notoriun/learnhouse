/**
 * API Reference configuration — single source of truth for the base URL,
 * caching, token placeholder, and which OpenAPI tags are documented.
 *
 * The FastAPI spec ships without servers/securitySchemes/tag metadata,
 * so everything presentation-related about groups lives here.
 */

// No public instance to default to: an unconfigured build must never point
// example requests or the live-spec fetch at a third party's server.
export const API_BASE_URL = (
  process.env.LEARNHOUSE_API_URL || 'http://localhost:1338'
).replace(/\/$/, '')

export const SPEC_REVALIDATE_SECONDS = 3600 // 1h ISR window for all reference pages

export const TOKEN_PLACEHOLDER = 'lh_YOUR_API_TOKEN'
export const TOKEN_STORAGE_KEY = 'lh:api-token'
export const LANG_STORAGE_KEY = 'lh:ref-lang'

/**
 * Documented endpoint groups, in display order.
 * `tags` are OpenAPI tags folded into the group (first tag of each operation wins).
 * Any operation whose first tag is not listed here is NOT documented —
 * internal surfaces (superadmin, cloud_internal, ee, dev, …) stay out by default.
 *
 * `access` mirrors the router-level auth wiring in apps/api/src/router.py:
 *   'token'          — accepts lh_ API tokens or a user session
 *   'token-required' — API token only (the headless /admin surface)
 *   'session'        — user session only, API tokens are rejected
 *   'public'         — credential/public endpoints (login, refresh, …)
 * `rightsBucket` is the API-token rights bucket enforced by the RBAC layer
 * (apps/api/src/security/rbac/rbac.py) — the docs derive the required action
 * from the HTTP method (GET → read, POST → create, PUT/PATCH → update,
 * DELETE → delete).
 */
export const API_GROUPS = [
  {
    slug: 'auth',
    title: 'Autenticação',
    tags: ['auth'],
    access: 'public',
    rightsBucket: null,
    description:
      'Login, renovação de token, logout, OAuth e verificação de e-mail. O login é form-encoded e devolve um JWT para fluxos no contexto do usuário.',
  },
  {
    slug: 'api-tokens',
    title: 'Tokens de API',
    tags: ['api-tokens', 'api_tokens'],
    access: 'session',
    rightsBucket: null,
    description:
      'Crie e gerencie tokens de API da organização (lh_) com privilégios restritos. O valor completo do token só é devolvido uma vez, na criação. Somente sessão: um token não pode gerar outros tokens.',
  },
  {
    slug: 'orgs',
    title: 'Organizações',
    tags: ['orgs'],
    access: 'session',
    rightsBucket: null,
    description:
      'CRUD de organizações, membros, convites, configuração, identidade visual e configurações de SEO.',
  },
  {
    slug: 'users',
    title: 'Usuários',
    tags: ['users'],
    access: 'session',
    rightsBucket: null,
    description: 'Contas de usuário, perfis, informações de sessão e gestão de senha.',
  },
  {
    slug: 'usergroups',
    title: 'Grupos de Usuários',
    tags: ['usergroups'],
    access: 'token',
    rightsBucket: 'usergroups',
    description: 'Agrupe alunos para gestão de turmas e controle de acesso.',
  },
  {
    slug: 'courses',
    title: 'Cursos',
    tags: ['courses'],
    access: 'token',
    rightsBucket: 'courses',
    description:
      'CRUD de cursos, clonagem, exportação/importação e gestão de colaboradores. Os endpoints de criação e atualização aceitam multipart form data.',
  },
  {
    slug: 'chapters',
    title: 'Capítulos',
    tags: ['chapters'],
    access: 'token',
    rightsBucket: 'coursechapters',
    description: 'CRUD e ordenação de capítulos dentro dos cursos.',
  },
  {
    slug: 'activities',
    title: 'Atividades',
    tags: ['activities'],
    access: 'token',
    rightsBucket: 'activities',
    description:
      'Unidades individuais de conteúdo dentro dos capítulos: páginas dinâmicas, vídeos, documentos, tarefas e pacotes SCORM.',
  },
  {
    slug: 'blocks',
    title: 'Blocos',
    tags: ['blocks'],
    access: 'session',
    rightsBucket: null,
    description: 'Blocos de conteúdo dentro de atividades de página dinâmica.',
  },
  {
    slug: 'assignments',
    title: 'Tarefas',
    tags: ['assignments'],
    access: 'token',
    rightsBucket: 'assignments',
    description:
      'Criação de tarefas, subtarefas, envios e correção — totalmente operável de forma headless com um token de API. Os endpoints "/me" e de envio, do lado do aluno, permanecem somente-sessão.',
  },
  {
    slug: 'folders',
    title: 'Pastas',
    tags: ['folders'],
    access: 'token',
    rightsBucket: 'folders',
    description: 'Pastas de conteúdo usadas para organizar e agrupar cursos (coleções).',
  },
  {
    slug: 'media',
    title: 'Mídia',
    tags: ['media'],
    access: 'token',
    rightsBucket: 'media',
    description: 'Envie e gerencie arquivos de mídia.',
  },
  {
    slug: 'certifications',
    title: 'Certificações',
    tags: ['certifications'],
    access: 'token',
    rightsBucket: 'certifications',
    description: 'Geração e gestão de certificados de conclusão de curso.',
  },
  {
    slug: 'payments',
    title: 'Pagamentos',
    tags: ['payments'],
    access: 'token',
    rightsBucket: 'payments',
    description:
      'Produtos, preços, checkout e matrícula via a API aberta de pagamentos, incluindo provedor próprio (bring-your-own).',
  },
  {
    slug: 'search',
    title: 'Busca',
    tags: ['search'],
    access: 'token',
    rightsBucket: 'search',
    description: 'Busca em texto completo por cursos e conteúdo. Os tokens precisam do privilégio de leitura de busca.',
  },
  {
    slug: 'analytics',
    title: 'Analytics',
    tags: ['analytics'],
    access: 'session',
    rightsBucket: null,
    description: 'Métricas de uso e analytics de cursos.',
  },
  {
    slug: 'webhooks',
    title: 'Webhooks',
    tags: ['webhooks'],
    access: 'session',
    rightsBucket: null,
    description: 'Registre endpoints HTTP que recebem notificações de eventos do Notoriun.',
  },
  {
    slug: 'headless',
    title: 'Headless',
    tags: ['admin'],
    access: 'token-required',
    rightsBucket: null,
    description:
      'Endpoints servidor-a-servidor para integrações headless: provisionar usuários, matricular alunos e gerenciar conteúdo de forma programática. Esses endpoints exigem um token de API lh_.',
  },
]

/** Required token action per HTTP method (mirrors the RBAC action names). */
export const METHOD_TO_ACTION = {
  GET: 'read',
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
}

const TAG_TO_GROUP = new Map()
for (const group of API_GROUPS) {
  for (const tag of group.tags) TAG_TO_GROUP.set(tag, group)
}

export function groupForTag(tag) {
  return TAG_TO_GROUP.get(tag) || null
}

export function groupBySlug(slug) {
  return API_GROUPS.find((g) => g.slug === slug) || null
}
