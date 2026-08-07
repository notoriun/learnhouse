/**
 * Guarda do script `test:keycloak`.
 *
 * O módulo de Keycloak só faz sentido contra o ambiente do
 * docker-compose.local.yml, que traz um Keycloak real provisionado. Rodá-lo
 * sem E2E_BASE_URL faria o harness bootar uma instância própria pela CLI — que
 * não tem provedor de identidade nenhum — e toda jornada reprovaria por um
 * motivo enganoso.
 *
 * Falhar aqui, com instrução de correção, é mais honesto do que reprovar 20
 * jornadas por ambiente errado.
 */
const baseUrl = process.env.E2E_BASE_URL

if (!baseUrl) {
  console.error(
    [
      '',
      'E2E_BASE_URL não está definida.',
      '',
      'O módulo de Keycloak precisa apontar para o ambiente local que já tem o',
      'provedor de identidade de pé. Suba-o e execute assim:',
      '',
      '  docker compose -f docker-compose.local.yml up -d',
      '  E2E_BASE_URL=http://localhost bun run test:keycloak',
      '',
      'Preparo completo do ambiente:',
      '  specs/008-testes-keycloak-local/quickstart.md',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

console.log(`[keycloak] validando contra ${baseUrl}`)
