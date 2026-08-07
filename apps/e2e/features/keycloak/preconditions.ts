/**
 * Fase de pré-condições.
 *
 * Existe para responder uma pergunta antes de qualquer jornada rodar: *o
 * ambiente está apto?* Sem ela, um sidecar de rede órfão ou um realm não
 * reimportado se disfarçam de defeito de produto — e a validação viraria uma
 * fonte de alarme falso em vez de evidência.
 *
 * Regra de ouro: a fase é ordenada e para na primeira falha. As seguintes ficam
 * `nao_executada` e nenhuma jornada roda (FR-003, FR-004, FR-007).
 *
 * A classificação de cada pré-condição vem da tabela de D-08 em research.md.
 */
import { CREDENTIALS, ISSUER, REALM, CLIENT_ID, REGISTERED_REDIRECT_URI } from './config'
import { getKeycloakStatus, isPlatformHealthy, getOrg, login, createStudent } from './api'
import { getDiscovery, findUserByEmail, findClient, isProviderReachable } from './provider'
import { isMailboxReachable } from './mailbox'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../core/instance'

export type FailureCategory = 'indisponibilidade' | 'preparacao'
export type PreconditionResult = 'ok' | 'falhou' | 'nao_executada'

export interface Precondition {
  id: string
  descricao: string
  categoriaDeFalha: FailureCategory
  /** Obrigatória quando `categoriaDeFalha === 'preparacao'`. */
  instrucaoDeCorrecao: string
  check: () => Promise<{ ok: boolean; observado?: string }>
}

export interface PreconditionOutcome {
  id: string
  descricao: string
  categoriaDeFalha: FailureCategory
  instrucaoDeCorrecao: string
  resultado: PreconditionResult
  observado: string
}

const QUICKSTART = 'specs/008-testes-keycloak-local/quickstart.md'

/**
 * As pré-condições, na ordem em que devem rodar.
 *
 * A ordem não é estética: cada uma pressupõe as anteriores. Verificar o
 * encaminhamento interno antes de saber que o provedor responde produziria uma
 * mensagem de erro que aponta para o lugar errado.
 */
export const PRECONDITIONS: Precondition[] = [
  {
    id: 'app-health',
    descricao: 'A aplicação responde na rota de saúde',
    categoriaDeFalha: 'indisponibilidade',
    instrucaoDeCorrecao:
      'Suba o ambiente: docker compose -f docker-compose.local.yml up -d --build ' +
      `(preparo completo em ${QUICKSTART})`,
    async check() {
      const ok = await isPlatformHealthy()
      return { ok, observado: ok ? 'saúde OK' : 'rota de saúde não respondeu' }
    },
  },
  {
    id: 'provider-discovery',
    descricao: 'O provedor responde no documento de descoberta do realm',
    categoriaDeFalha: 'indisponibilidade',
    instrucaoDeCorrecao:
      'Confira o contêiner do Keycloak: docker compose -f docker-compose.local.yml ps keycloak',
    async check() {
      if (!(await isProviderReachable())) {
        return { ok: false, observado: 'documento de descoberta inacessível' }
      }
      const discovery = await getDiscovery()
      if (discovery.issuer !== ISSUER) {
        return {
          ok: false,
          observado: `issuer do provedor é ${discovery.issuer}, esperado ${ISSUER}`,
        }
      }
      return { ok: true, observado: `issuer ${discovery.issuer}` }
    },
  },
  {
    id: 'sso-enabled',
    descricao: 'O login corporativo está ativo para a organização',
    categoriaDeFalha: 'preparacao',
    instrucaoDeCorrecao:
      'Confira LEARNHOUSE_KEYCLOAK_ENABLED/ISSUER/CLIENT_ID no .env e habilite o método SSO ' +
      'nos métodos de entrada da organização (Segurança da organização)',
    async check() {
      const status = await getKeycloakStatus()
      if (!status.enabled) {
        return { ok: false, observado: `status: ${JSON.stringify(status)}` }
      }
      return { ok: true, observado: `enabled=${status.enabled} platform=${status.platform}` }
    },
  },
  {
    id: 'internal-forwarding',
    descricao: 'A aplicação alcança o provedor pelo mesmo endereço que o navegador usa',
    categoriaDeFalha: 'preparacao',
    instrucaoDeCorrecao:
      'Recrie o sidecar de encaminhamento — ele fica órfão quando só a aplicação é recriada: ' +
      'docker compose -f docker-compose.local.yml up -d --force-recreate learnhouse-app keycloak-fwd',
    async check() {
      // `authorize` roda **dentro** da aplicação e precisa alcançar o issuer
      // para montar a URL. Se o sidecar estiver órfão, isto falha com
      // indisponibilidade do provedor — que é justamente o sintoma que se
      // disfarça de provedor fora do ar. Distinguir aqui é o ponto.
      const { authorize } = await import('./api')
      try {
        const { authorization_url } = await authorize()
        return { ok: true, observado: `URL de autorização montada (${new URL(authorization_url).origin})` }
      } catch (e) {
        return {
          ok: false,
          observado:
            `a aplicação não conseguiu montar a URL de autorização: ${(e as Error).message}. ` +
            'O provedor responde no host, então o suspeito é o encaminhamento interno.',
        }
      }
    },
  },
  {
    id: 'realm-provisioned',
    descricao: 'O realm contém o client e os usuários de teste esperados',
    categoriaDeFalha: 'preparacao',
    instrucaoDeCorrecao:
      'O realm só é importado na primeira criação do volume. Para reimportar: ' +
      'docker compose -f docker-compose.local.yml down -v && up -d (apaga os dados locais)',
    async check() {
      const client = await findClient(CLIENT_ID)
      if (!client) {
        return { ok: false, observado: `client ${CLIENT_ID} ausente no realm ${REALM}` }
      }
      const uris: string[] = client.redirectUris ?? []
      if (!uris.includes(REGISTERED_REDIRECT_URI)) {
        return {
          ok: false,
          observado:
            `o client ${CLIENT_ID} não registra ${REGISTERED_REDIRECT_URI}; ` +
            `registradas: ${uris.join(', ') || '(nenhuma)'}`,
        }
      }
      const faltando: string[] = []
      for (const cred of Object.values(CREDENTIALS)) {
        const user = await findUserByEmail(cred.identifier)
        if (!user) {
          faltando.push(`${cred.identifier} (ausente)`)
        } else if ((user.emailVerified ?? false) !== cred.emailVerified) {
          faltando.push(
            `${cred.identifier} (emailVerified=${user.emailVerified}, esperado ${cred.emailVerified})`,
          )
        }
      }
      if (faltando.length) return { ok: false, observado: faltando.join('; ') }
      return { ok: true, observado: `client e ${Object.keys(CREDENTIALS).length} usuários conferem` }
    },
  },
  {
    id: 'mailbox-reachable',
    descricao: 'O coletor SMTP responde, para as jornadas de verificação de e-mail',
    categoriaDeFalha: 'preparacao',
    instrucaoDeCorrecao:
      'Suba o coletor: docker compose -f docker-compose.local.yml up -d mailpit',
    async check() {
      const ok = await isMailboxReachable()
      return { ok, observado: ok ? 'coletor OK' : 'coletor não respondeu' }
    },
  },
  {
    // T012 — a pré-condição que a documentação oficial não menciona e que faz
    // toda a diferença: sem configuração OIDC por organização, só o vínculo por
    // e-mail está ativo, e ele exige conta local preexistente. Sem ela a
    // admissão recusa com conta_nao_encontrada, que é comportamento CORRETO
    // (D-14) — e que sem esta pré-condição pareceria defeito de produto.
    id: 'local-link-account',
    descricao: 'Existe conta local para o vínculo por e-mail da credencial verificada',
    categoriaDeFalha: 'preparacao',
    instrucaoDeCorrecao:
      `Crie a conta local com o e-mail de CREDENTIALS.verificado (ver passo 5 de ${QUICKSTART}). ` +
      'A validação tenta criá-la automaticamente; se falhou, confira as credenciais ' +
      'administrativas iniciais no .env. ' +
      'SE AS JORNADAS DE ENTRADA FALHAREM COM 403 mesmo com esta pré-condição verde: o contêiner ' +
      'do Keycloak provavelmente foi recriado sozinho, o que regenera os subject dos usuários e ' +
      'invalida os vínculos federados já gravados (a recusa da plataforma é correta). Recrie os ' +
      'dois lados juntos: docker compose -f docker-compose.local.yml down -v && up -d',
    async check() {
      const email = CREDENTIALS.verificado.identifier
      const org = await getOrg()
      try {
        const adminTok = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
        await createStudent(adminTok, org.id, {
          email,
          username: email.split('@')[0],
          password: `Vinculo!${org.id}`,
          first_name: 'Teste',
          last_name: 'Vinculo',
        })
        return { ok: true, observado: `conta local ${email} criada nesta execução` }
      } catch (e) {
        // Conta já existente é o caso normal a partir da segunda execução —
        // é o que sustenta a repetibilidade exigida por FR-009.
        const msg = (e as Error).message
        if (/409|already|existe|duplicate/i.test(msg)) {
          return { ok: true, observado: `conta local ${email} já existia` }
        }
        return { ok: false, observado: `não foi possível garantir a conta local: ${msg}` }
      }
    },
  },
]

/**
 * Roda a fase completa. Para na primeira falha — as seguintes ficam
 * `nao_executada`, porque um ambiente já reprovado produz observações
 * enganosas nas verificações posteriores.
 */
export async function runPreconditions(): Promise<PreconditionOutcome[]> {
  const outcomes: PreconditionOutcome[] = []
  let barrado = false
  for (const p of PRECONDITIONS) {
    const base = {
      id: p.id,
      descricao: p.descricao,
      categoriaDeFalha: p.categoriaDeFalha,
      instrucaoDeCorrecao: p.instrucaoDeCorrecao,
    }
    if (barrado) {
      outcomes.push({ ...base, resultado: 'nao_executada', observado: '' })
      continue
    }
    try {
      const { ok, observado } = await p.check()
      outcomes.push({ ...base, resultado: ok ? 'ok' : 'falhou', observado: observado ?? '' })
      if (!ok) barrado = true
    } catch (e) {
      outcomes.push({ ...base, resultado: 'falhou', observado: (e as Error).message })
      barrado = true
    }
  }
  return outcomes
}

/** True quando toda pré-condição passou. */
export function allPassed(outcomes: PreconditionOutcome[]): boolean {
  return outcomes.every((o) => o.resultado === 'ok')
}

/** A primeira reprovação, ou null. É ela que define a categoria de causa. */
export function firstFailure(outcomes: PreconditionOutcome[]): PreconditionOutcome | null {
  return outcomes.find((o) => o.resultado === 'falhou') ?? null
}

/**
 * Verificação de construção do módulo: pré-condição de preparação sem
 * instrução de correção é erro de quem escreveu, não resultado de execução
 * (regra do data-model). Falhar cedo e alto.
 */
export function assertWellFormed(): void {
  const quebradas = PRECONDITIONS.filter(
    (p) => p.categoriaDeFalha === 'preparacao' && !p.instrucaoDeCorrecao.trim(),
  )
  if (quebradas.length) {
    throw new Error(
      `pré-condições de preparação sem instrução de correção: ${quebradas.map((p) => p.id).join(', ')}`,
    )
  }
}
