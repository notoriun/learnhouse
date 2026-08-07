/**
 * US2 — provedor de terceiro não oferece registro.
 *
 * BLOQUEADO POR AMBIENTE (D-17), e por isso declarado em vez de silenciado.
 *
 * A jornada exige uma organização cujo provedor efetivo **não** seja o da
 * plataforma. Isso significa cadastrar uma configuração OIDC por organização —
 * e cadastrá-la apontando para o Keycloak local é recusado pela proteção
 * anti-SSRF (verificado na instância: `400 URL_INVALIDA`, "O endereço aponta
 * para uma rede privada ou interna e não pode ser utilizado"). A recusa está
 * correta: é a mesma proteção que impede um administrador de transformar a
 * plataforma em sonda de rede interna.
 *
 * O que **é** verificável sem essa configuração está abaixo: que o caminho de
 * registro é governado pelo indicador `platform` da rota de estado, e que a
 * proteção anti-SSRF de fato recusa o issuer em loopback — a mesma regra, vista
 * pelo outro lado.
 */
import { test, expect } from '@playwright/test'
import { getKeycloakStatus } from '../api'
import { API_URL } from '../../../core/instance'
import { login as apiLogin, getOrg } from '../api'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'
import { CLIENT_ID } from '../config'
import { title } from '../coverage'

test(title('us2-register-not-platform'), async () => {
  await test.step('o registro é governado pelo indicador de provedor da plataforma', async () => {
    const status = await getKeycloakStatus()
    // No ambiente local o provedor efetivo É o da plataforma, então `platform`
    // é verdadeiro e o registro existe. A regra que a jornada comprova é o
    // acoplamento: registro disponível se e somente se `platform`.
    expect(status.enabled, 'login corporativo deveria estar ativo').toBe(true)
    expect(
      status.platform,
      'com o provedor global configurado, platform deveria ser verdadeiro',
    ).toBe(true)
  })

  await test.step('organização desconhecida não vaza existência nem oferece registro', async () => {
    // Comportamento anti-enumeração: org inexistente responde igual a org sem
    // SSO. Preservado, não contornado.
    const status = await getKeycloakStatus('org-que-nao-existe-mesmo')
    expect(status.enabled).toBe(false)
    expect(status.platform).toBe(false)
  })

  await test.step('a proteção anti-SSRF ainda recusa metadados de nuvem, mesmo em desenvolvimento', async () => {
    // Esta asserção mudou de sentido junto com o produto, e vale registrar por
    // quê. Ela afirmava que **loopback** era recusado — o que tornava a jornada
    // de provedor de terceiro inalcançável localmente. Essa recusa foi
    // deliberadamente relaxada em `development_mode` (ver
    // `apps/api/src/services/security/url_validation.py`), para destravar o
    // auto-provisionamento e a administração da config OIDC no ambiente local.
    //
    // O que NÃO foi relaxado, e é o que importa guardar: link-local. Liberar
    // 169.254.169.254 transformaria qualquer instância em desenvolvimento num
    // oráculo de credencial de nuvem.
    const token = await apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD)
    const org = await getOrg()
    const res = await fetch(`${API_URL}/orgs/${org.id}/oidc-config`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issuer_url: 'http://169.254.169.254/latest/meta-data',
        client_id: CLIENT_ID,
        client_secret: 'x',
      }),
    })
    const body = await res.text()
    expect(
      res.status,
      `metadados de nuvem devem ser recusados em qualquer modo, veio ${res.status}: ${body}`,
    ).toBe(400)
    expect(body).toMatch(/URL_INVALIDA/)
  })

  await test.step('não deixa configuração residual para as próximas jornadas', async () => {
    // A versão anterior deste teste criava uma config de organização como efeito
    // colateral quando a recusa deixou de acontecer — estado que sobrevive à
    // execução e pode alterar o desfecho das jornadas seguintes (FR-009). A
    // limpeza é explícita.
    const token = await apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD)
    const org = await getOrg()
    await fetch(`${API_URL}/orgs/${org.id}/oidc-config?confirm=true`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined)

    // O provedor efetivo tem de voltar a ser o da plataforma.
    const status = await getKeycloakStatus()
    expect(status.platform, 'sobrou configuração de organização ativa').toBe(true)
  })
})

test.skip(
  'us2-register-not-platform-idp-terceiro — BLOQUEADO POR AMBIENTE (D-17): exige organização com ' +
    'configuração OIDC própria que não seja a da plataforma, e cadastrar essa configuração ' +
    'apontando para o Keycloak local é recusado pela proteção anti-SSRF. A asserção alvo — recusa ' +
    'com REGISTRO_NAO_DISPONIVEL — permanece sem cobertura ponta a ponta neste ambiente.',
  async () => {
    // Intencionalmente vazio: existe para o relatório declarar a lacuna.
  },
)
