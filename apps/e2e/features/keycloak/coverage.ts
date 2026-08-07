/**
 * Matriz de rastreabilidade requisito → jornada.
 *
 * Serve a FR-014 e SC-006: toda jornada aponta para o requisito que comprova, e
 * nenhum requisito da amplitude acordada fica sem jornada. A alternativa —
 * manter a matriz em um documento à parte — desatualiza silenciosamente; aqui
 * ela é código, e `tests/coverage.spec.ts` a confronta com os títulos reais.
 *
 * Fonte: specs/008-testes-keycloak-local/contracts/interfaces-consumidas.md §5
 */

export type UserStory = 'US1' | 'US2' | 'US3' | 'US4'

export interface JourneyCoverage {
  /** Identificador estável da jornada; casa com o título do teste. */
  id: string
  userStory: UserStory
  /** Requisitos de origem, no formato `FR-00X (00Y)`. */
  requisitos: string[]
  /** Arquivo de teste que a implementa. */
  arquivo: string
  /**
   * Quando presente, a jornada está DECLARADA e NÃO IMPLEMENTADA, com esta
   * razão. Existe para que a lacuna apareça no relatório em vez de a entrada ser
   * removida da matriz — remover esconderia que o requisito ficou sem cobertura,
   * e é exatamente o "silent cap" que FR-007 proíbe.
   */
  bloqueado?: string
}

export const COVERAGE: JourneyCoverage[] = [
  // --- US1: entrada -------------------------------------------------------
  {
    id: 'us1-login',
    userStory: 'US1',
    requisitos: ['FR-001 (001)', 'FR-002 (001)', 'FR-007 (001)'],
    arquivo: 'tests/us1-login.spec.ts',
  },
  {
    id: 'us1-flow-params',
    userStory: 'US1',
    requisitos: ['FR-002 (001)', 'FR-003 (001)'],
    arquivo: 'tests/us1-flow-params.spec.ts',
  },
  {
    id: 'us1-redirect-uri',
    userStory: 'US1',
    requisitos: ['FR-002 (001)'],
    arquivo: 'tests/us1-redirect-uri.spec.ts',
  },
  {
    id: 'us1-server-side',
    userStory: 'US1',
    requisitos: ['FR-004 (001)'],
    arquivo: 'tests/us1-server-side.spec.ts',
  },
  {
    id: 'us1-discovery',
    userStory: 'US1',
    requisitos: ['FR-006 (001)'],
    arquivo: 'tests/us1-discovery.spec.ts',
  },
  {
    id: 'us1-invalid-credential',
    userStory: 'US1',
    requisitos: ['FR-009 (001)'],
    arquivo: 'tests/us1-invalid-credential.spec.ts',
  },
  {
    id: 'us1-token-validation',
    userStory: 'US1',
    requisitos: ['FR-005 (001)'],
    arquivo: 'tests/us1-token-validation.spec.ts',
    bloqueado:
      'Validação integral do token exige divergência de relógio além da tolerância entre ' +
      'plataforma e provedor. Sem simular o provedor (FR-001 proíbe), isso significa deslocar o ' +
      'relógio de um contêiner — difícil de restaurar com segurança e contamina toda jornada ' +
      'concorrente. Precisa de decisão de abordagem: contêiner de provedor dedicado com relógio ' +
      'deslocado, ou aceitar a cobertura por teste de unidade em test_keycloak_oidc_validation.py.',
  },
  {
    id: 'us1-redirect-allowlist',
    userStory: 'US1',
    requisitos: ['FR-008 (001)'],
    arquivo: 'tests/us1-redirect-allowlist.spec.ts',
  },
  {
    id: 'us1-provider-down',
    userStory: 'US1',
    requisitos: ['FR-011 (001)'],
    arquivo: 'tests/us1-provider-down.spec.ts',
  },

  // --- US2: registro e admissão -------------------------------------------
  {
    id: 'us2-register',
    userStory: 'US2',
    requisitos: ['FR-001 (007)', 'FR-002 (007)', 'FR-006 (002)'],
    arquivo: 'tests/us2-register.spec.ts',
  },
  {
    id: 'us2-unverified',
    userStory: 'US2',
    requisitos: ['FR-002 (007)'],
    arquivo: 'tests/us2-unverified.spec.ts',
  },
  {
    id: 'us2-register-not-platform',
    userStory: 'US2',
    requisitos: ['FR-010 (007)'],
    arquivo: 'tests/us2-register-not-platform.spec.ts',
  },
  {
    id: 'us2-identity-link',
    userStory: 'US2',
    requisitos: ['FR-001 (002)', 'FR-002 (002)', 'FR-003 (002)'],
    arquivo: 'tests/us2-identity-link.spec.ts',
  },
  {
    id: 'us2-identity-conflict',
    userStory: 'US2',
    requisitos: ['FR-004 (002)', 'FR-005 (002)'],
    arquivo: 'tests/us2-identity-conflict.spec.ts',
  },

  // --- US3: encerramento coordenado ---------------------------------------
  {
    id: 'us3-logout',
    userStory: 'US3',
    requisitos: ['FR-001 (003)', 'FR-002 (003)', 'FR-003 (003)'],
    arquivo: 'tests/us3-logout.spec.ts',
  },
  {
    id: 'us3-provider-revocation',
    userStory: 'US3',
    requisitos: ['FR-004 (003)', 'FR-006 (003)'],
    arquivo: 'tests/us3-provider-revocation.spec.ts',
  },
  {
    id: 'us3-native-logout',
    userStory: 'US3',
    requisitos: ['FR-010 (003)'],
    arquivo: 'tests/us3-native-logout.spec.ts',
  },

  // --- US4: guardas de conta federada -------------------------------------
  {
    id: 'us4-federated-guards',
    userStory: 'US4',
    requisitos: ['FR-008 (007)'],
    arquivo: 'tests/us4-federated-guards.spec.ts',
  },
  {
    id: 'us4-account-console',
    userStory: 'US4',
    requisitos: ['FR-008 (007)'],
    arquivo: 'tests/us4-account-console.spec.ts',
  },
  {
    id: 'us4-profile-editable',
    userStory: 'US4',
    requisitos: ['FR-008 (007)'],
    arquivo: 'tests/us4-profile-editable.spec.ts',
  },
  {
    id: 'us4-local-account',
    userStory: 'US4',
    requisitos: ['FR-010 (007)'],
    arquivo: 'tests/us4-local-account.spec.ts',
  },
]

/**
 * Monta o título do teste com o requisito embutido.
 *
 * É o que faz o relatório do Playwright carregar a rastreabilidade sem
 * mecanismo novo: quem lê a saída vê o requisito ao lado da jornada.
 */
export function title(id: string): string {
  const entry = COVERAGE.find((c) => c.id === id)
  if (!entry) {
    throw new Error(`jornada ${id} não está na matriz de cobertura (jornada órfã — SC-006)`)
  }
  return `[${entry.userStory}] ${id} — ${entry.requisitos.join(', ')}`
}

/** Jornadas de uma user story. */
export function byStory(story: UserStory): JourneyCoverage[] {
  return COVERAGE.filter((c) => c.userStory === story)
}

/** Requisitos distintos cobertos pela matriz (só jornadas implementadas). */
export function coveredRequirements(): string[] {
  return [...new Set(COVERAGE.filter((c) => !c.bloqueado).flatMap((c) => c.requisitos))].sort()
}

/** Jornadas declaradas e não implementadas, com a razão. */
export function declaredGaps(): JourneyCoverage[] {
  return COVERAGE.filter((c) => Boolean(c.bloqueado))
}
