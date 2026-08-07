# Quickstart: preparar o ambiente e validar o login corporativo

**Feature**: `008-testes-keycloak-local` | **Data**: 2026-08-06

Este roteiro foi **executado e verificado** na elaboração do plano. Ele corrige três lacunas da
documentação atual de ambiente local (D-03, D-04, D-14) que impedem a subida como documentada.

---

## 1. Construir o `.env`

A documentação atual manda apenas acrescentar 4 variáveis de Keycloak a um `.env` — mas **não
existe `.env` nem template dele no repositório**, e `docker-compose.local.yml` declara
`env_file: .env`. Sem o arquivo, o compose não sobe.

Variáveis mínimas (derivadas de [apps/cli/src/templates/env.ts](../../apps/cli/src/templates/env.ts)):

```env
LEARNHOUSE_DOMAIN=localhost
LEARNHOUSE_FRONTEND_DOMAIN=localhost      # OBRIGATÓRIO — ver passo 2
HTTP_PORT=80

NEXT_PUBLIC_LEARNHOUSE_API_URL=http://localhost/api/v1/
NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL=http://localhost/
NEXT_PUBLIC_LEARNHOUSE_DOMAIN=localhost
NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN=localhost
NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG=False
NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG=default
NEXT_PUBLIC_LEARNHOUSE_HTTPS=False

NEXTAUTH_URL=http://localhost
NEXTAUTH_SECRET=<gere: openssl rand -base64 32>

LEARNHOUSE_SQL_CONNECTION_STRING=postgresql://learnhouse:learnhouse@db:5432/learnhouse
LEARNHOUSE_REDIS_CONNECTION_STRING=redis://redis:6379/learnhouse
LEARNHOUSE_COOKIE_DOMAIN=.localhost
LEARNHOUSE_PORT=9000

LEARNHOUSE_AUTH_JWT_SECRET_KEY=<gere: openssl rand -base64 32>
LEARNHOUSE_INITIAL_ADMIN_EMAIL=admin@e2e-tests.com
LEARNHOUSE_INITIAL_ADMIN_PASSWORD=<sua senha>
LEARNHOUSE_INITIAL_ORG_NAME=Default Organization
LEARNHOUSE_INITIAL_ORG_SLUG=default

COLLAB_INTERNAL_KEY=<gere: openssl rand -base64 32>
LEARNHOUSE_REDIS_URL=redis://redis:6379
NEXT_PUBLIC_COLLAB_URL=ws://localhost/collab

LEARNHOUSE_DEVELOPMENT_MODE=True          # OBRIGATÓRIO — ver passo 2
LEARNHOUSE_LOGFIRE_ENABLED=False
LEARNHOUSE_IS_AI_ENABLED=False
LEARNHOUSE_CONTENT_DELIVERY_TYPE=filesystem

POSTGRES_USER=learnhouse
POSTGRES_PASSWORD=learnhouse
POSTGRES_DB=learnhouse

LEARNHOUSE_KEYCLOAK_ENABLED=true
LEARNHOUSE_KEYCLOAK_ISSUER=http://localhost:8080/realms/dev
LEARNHOUSE_KEYCLOAK_CLIENT_ID=learnhouse
LEARNHOUSE_KEYCLOAK_CLIENT_SECRET=learnhouse-dev-secret
```

> **`.test` é rejeitado.** O validador de e-mail da aplicação recusa os TLDs reservados `.test`,
> `.example` e `.localhost`. Um `LEARNHOUSE_INITIAL_ADMIN_EMAIL` terminando em `.test` derruba a
> aplicação no arranque, com `ValidationError` no `cli.py` durante a criação do administrador.
> Use um domínio de TLD comum. (Curiosamente, `teste@example.com` **é** aceito — `.com` é o TLD
> ali; o reservado seria `.example`.)

## 2. As duas variáveis que a documentação não menciona

| Variável | Por que é obrigatória |
|---|---|
| `LEARNHOUSE_DEVELOPMENT_MODE=True` | O issuer local é `http://` sem TLS. A validação de URL só admite `http` em modo desenvolvimento ([url_validation.py:34](../../apps/api/src/services/security/url_validation.py#L34)). |
| `LEARNHOUSE_FRONTEND_DOMAIN=localhost` | A `redirect_uri` do login corporativo é montada a partir de `hosting_config.frontend_domain`, que **não** cai para `LEARNHOUSE_DOMAIN` — sem ela, fica `localhost:3000`, divergente da URI registrada no realm, e o Keycloak recusa a autorização. Ver D-13. |

## 3. Subir

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Aguarde a saúde da aplicação (o arranque roda migrações e cria a organização inicial):

```bash
until curl -sf http://localhost/api/v1/health >/dev/null; do sleep 5; done
```

> **Se recriar apenas a aplicação, recrie o sidecar junto** — ele compartilha o namespace de rede
> da aplicação e fica órfão no contêiner antigo. Sintoma: login corporativo falhando como se o
> provedor estivesse fora.
> ```bash
> docker compose -f docker-compose.local.yml up -d --force-recreate learnhouse-app keycloak-fwd
> ```

## 4. Conferir as pré-condições

Todas verificadas verdes na elaboração deste plano:

```bash
curl -s -o /dev/null -w "app: %{http_code}\n" http://localhost/api/v1/health
curl -s -o /dev/null -w "realm: %{http_code}\n" http://localhost:8080/realms/dev/.well-known/openid-configuration
curl -s "http://localhost/api/v1/auth/keycloak/status?org=default"      # {"enabled":true,"platform":true}
docker exec learnhouse-app-local curl -s -o /dev/null -w "sidecar: %{http_code}\n" \
  http://localhost:8080/realms/dev/.well-known/openid-configuration     # 200 = encaminhamento OK
```

A `redirect_uri` emitida DEVE coincidir com a registrada no realm
(`http://localhost/api/auth/keycloak/callback`):

```bash
curl -s -X POST http://localhost/api/v1/auth/keycloak/authorize \
  -H "Content-Type: application/json" -d '{"org_slug":"default","action":"login"}'
```

## 5. Criar a conta local de vínculo (a pré-condição não documentada)

> **Superado pela feature 009** (2026-08-07). Esta pré-condição **deixou de existir** para o
> provedor da plataforma — que é o caso do ambiente local. O primeiro acesso pela identidade
> corporativa passou a criar a conta automaticamente, então não é mais preciso criar a conta
> local antes. Ver [009-auto-provisionamento-keycloak](../009-auto-provisionamento-keycloak/spec.md).
>
> O passo permanece registrado abaixo porque descreve o comportamento vigente quando a feature
> 008 foi escrita, e porque continua valendo para organizações com IdP de terceiro que não
> habilitaram a criação automática.

Sem isto, o login corporativo recusa com `conta_nao_encontrada` — e é comportamento **correto**:
sem configuração OIDC por organização, só o vínculo por e-mail está ativo, e ele exige conta local
preexistente (D-14).

```bash
curl -s -X POST http://localhost/api/v1/users/1 -H "Content-Type: application/json" \
  -d '{"username":"teste","email":"teste@example.com","password":"<senha>","first_name":"Teste","last_name":"Local"}'
```

A conta nasce com `email_verified: true`, que é o que o vínculo por e-mail exige.

## 6. Executar a validação

Quando o módulo desta feature existir:

```bash
cd apps/e2e
bun install && bunx playwright install chromium
E2E_BASE_URL=http://localhost bun run test features/keycloak
```

`E2E_BASE_URL` liga `SKIP_BOOT` automaticamente — a suíte roda contra o ambiente de pé em vez de
subir o seu próprio. `E2E_PORT` não participa e não há conflito com a porta 8080 do Keycloak
(D-02).

## 7. Desfazer

```bash
docker compose -f docker-compose.local.yml down          # preserva dados
docker compose -f docker-compose.local.yml down -v        # apaga volumes; necessário para reimportar o realm
```

---

## Credenciais de teste do realm `dev`

Verificadas na instância de pé — o Keycloak normaliza o `username` para o e-mail por efeito de
`registrationEmailAsUsername`, então os identificadores de entrada são os e-mails:

| Identificador | Senha | E-mail verificado |
|---|---|---|
| `teste@example.com` | `teste123` | sim |
| `nao-verificado@example.com` | `teste123` | não |

Console administrativo do Keycloak: `http://localhost:8080`, `admin` / `admin`.
