# Quickstart: verificar a criação automática de conta e o destino no menu

**Feature**: `009-auto-provisionamento-keycloak` | **Data**: 2026-08-07

O ambiente é o mesmo da feature 008 (Keycloak 26.3 real, realm `dev`, plataforma na
porta 80, tenancy `single`, organização `default`). **Não repita a montagem aqui**:
siga [specs/008-testes-keycloak-local/quickstart.md](../008-testes-keycloak-local/quickstart.md)
passos 1 a 4 para construir o `.env`, subir e conferir as pré-condições.

O que este roteiro acrescenta é a verificação desta feature — e o ponto central é
que **o passo 5 daquele quickstart deixa de ser necessário**. Hoje ele instrui a
criar a conta local antes, porque sem ela o acesso corporativo recusa com
`conta_nao_encontrada`. É exatamente essa pré-condição que esta feature elimina.

## 0. Por que o ambiente local exercita o caminho certo

O Keycloak local é configurado por variáveis de ambiente
(`LEARNHOUSE_KEYCLOAK_*` no `.env`), não por configuração de organização. Logo não
existe linha `OIDCProviderConfig` e o fluxo percorre o **fallback global** — o
caminho do provedor da própria plataforma, que é onde a criação automática passa a
estar ligada (research.md D1). Confirme com:

```bash
curl -s "http://localhost/api/v1/auth/keycloak/status?org=default"
# esperado: {"enabled":true,"platform":true}   ← "platform":true = provedor da plataforma
```

## 1. Criar uma identidade no provedor que NÃO tem conta na plataforma

As credenciais do realm `dev` (`teste@example.com`, `nao-verificado@example.com`)
não servem para este teste: a primeira é usada com conta local preexistente. Crie
uma identidade nova, com e-mail verificado, via console administrativo do Keycloak
(`http://localhost:8080`, `admin`/`admin`) ou pela API de administração:

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/realms/master/protocol/openid-connect/token \
  -d "client_id=admin-cli&username=admin&password=admin&grant_type=password" | jq -r .access_token)

curl -s -X POST http://localhost:8080/admin/realms/dev/users \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"username":"novo@example.com","email":"novo@example.com","emailVerified":true,
       "enabled":true,"firstName":"Nova","lastName":"Pessoa",
       "credentials":[{"type":"password","value":"teste123","temporary":false}]}'
```

Confirme que **não** existe conta local com esse e-mail antes de prosseguir — é a
pré-condição do teste:

```bash
docker exec learnhouse-db-local psql -U learnhouse -d learnhouse -tAc \
  "select count(*) from \"user\" where lower(email)='novo@example.com';"
# esperado: 0
```

## 2. Percorrer o primeiro acesso no navegador

1. Abra `http://localhost/login?org=default`.
2. Clique em **Entrar com identidade corporativa**.
3. Autentique no Keycloak como `novo@example.com` / `teste123`.

**Resultado esperado** (US1, FR-001, FR-005, SC-001):

- O navegador termina na **raiz do host** — `http://localhost/` — que é a área da
  organização com o menu de navegação, já autenticado.
- Não passa por `/home` (seletor de organizações) e não volta para `/login`.
- A barra de endereços não carrega `?error=`.

Antes desta feature o mesmo percurso terminava em
`http://localhost/login?error=conta_nao_encontrada`.

## 3. Conferir o que foi gravado

```bash
docker exec learnhouse-db-local psql -U learnhouse -d learnhouse -tAc \
  "select u.id, u.username, u.email, uo.role_id
     from \"user\" u join userorganization uo on uo.user_id = u.id
    where lower(u.email)='novo@example.com';"
# esperado: 1 linha, username 'novo', role_id 4 (papel de menor privilégio)

docker exec learnhouse-db-local psql -U learnhouse -d learnhouse -tAc \
  "select issuer, subject, provider, email_at_link_time from externalidentity
    where user_id = (select id from \"user\" where lower(email)='novo@example.com');"
# esperado: 1 linha, issuer http://localhost:8080/realms/dev, provider keycloak
```

Verificações que isso comprova: FR-002 (conta criada no provedor da plataforma),
FR-003 (vínculo por `issuer`+`subject`), FR-009 (papel de menor privilégio e
membresia na organização do fluxo).

## 4. Percorrer o segundo acesso

Encerre a sessão e repita o passo 2 com a mesma identidade.

**Resultado esperado** (US2, FR-004, FR-006, SC-004): a mesma conta (mesmo `id`), o
mesmo destino (raiz do host, área com menu), e **nenhuma conta nova**:

```bash
docker exec learnhouse-db-local psql -U learnhouse -d learnhouse -tAc \
  "select count(*) from \"user\" where lower(email)='novo@example.com';"
# esperado: 1 (não 2)
```

Variante que vale rodar: altere o e-mail dessa identidade no console do Keycloak e
entre de novo. O acesso DEVE cair na mesma conta, sem criar outra (FR-004).

## 5. Conferir que o destino ignora entrada do usuário

O `redirect` deixou de existir no contrato (contracts §1). Uma tentativa de
injetá-lo não muda o destino:

```bash
curl -si "http://localhost/api/auth/keycloak/authorize?org=default&redirect=https://exemplo-externo.invalid/" \
  | grep -i '^location:'
# a URL de autorização do Keycloak sai normalmente; nenhum destino externo é
# carregado no fluxo, e o retorno termina na área da organização
```

Comprova FR-007 e a jornada `us1-redirect-allowlist` reescrita.

## 6. Conferir que IdP de terceiro segue fail-closed

Esta é a metade da feature que **não** deve mudar (SC-008). Com uma configuração
OIDC de organização apontando um issuer diferente do global e
`auto_provision_users=false`, uma identidade nova DEVE continuar sendo recusada com
`conta_nao_encontrada`. No ambiente local isso é mais rápido de verificar pelo teste
de API do que pelo navegador — ver `test_provisioning.py` na estratégia de testes do
[plan.md](./plan.md).

## 7. Auditoria

```bash
docker exec learnhouse-db-local psql -U learnhouse -d learnhouse -tAc \
  "select event_type, metadata from user_audit_event order by id desc limit 5;"
```

Esperado: `SSO_PROVISIONED` no primeiro acesso e `LOGIN` (com `method=sso`) no
segundo — desfechos distinguíveis, como exige FR-013 e SC-007.

## 8. Suíte automatizada

```bash
cd apps/e2e
bun install && bunx playwright install chromium
E2E_BASE_URL=http://localhost bun run test features/keycloak
```

`E2E_BASE_URL` liga `SKIP_BOOT` — a suíte roda contra o ambiente de pé. As jornadas
novas desta feature são `us1-auto-provision`, `us1-destino-menu` e
`us2-reentrada-mesma-conta`; `zz-coverage.spec.ts` confronta a matriz de
`coverage.ts` com os títulos reais, então uma jornada declarada e não implementada
aparece no relatório.

## 9. Desfazer

```bash
docker compose -f docker-compose.local.yml down       # preserva dados
docker compose -f docker-compose.local.yml down -v    # apaga volumes (reimporta o realm)
```

> Para repetir o teste de primeiro acesso sem derrubar tudo, apague só a conta e o
> vínculo criados (`delete from "user" where lower(email)='novo@example.com'` — o
> vínculo cai por `ON DELETE CASCADE`).
