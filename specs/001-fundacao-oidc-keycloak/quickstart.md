# Quickstart: Validação da Fundação OIDC Keycloak

**Feature**: `001-fundacao-oidc-keycloak` | **Data**: 2026-08-03

Guia para subir o ambiente, executar o fluxo de login e verificar os critérios de aceite (SC-001 a
SC-005) manual e automaticamente.

## 1. Pré-requisitos

- Ambiente dev do LearnHouse funcional (`npx learnhouse dev` — web em `http://localhost:3000`, API
  em `http://localhost:1338`, PostgreSQL e Redis do compose de dev).
- Docker para o Keycloak de desenvolvimento.
- Uma organização de teste (ex.: slug `acme`) com o método de login `sso` permitido na política da
  org, e um usuário local existente com e-mail verificado (ex.: `aluno@acme.dev`) — nesta fase não
  há provisionamento (feature 002): o usuário precisa existir antes.

### Keycloak dev

```bash
docker run -d --name kc-dev -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:latest start-dev
```

No console admin (`http://localhost:8080`):

1. Criar o realm `plataforma`.
2. Criar o client `learnhouse-web`:
   - Tipo OpenID Connect, **Client authentication ON** (confidencial);
   - Standard flow ON, Implicit flow OFF, Direct access grants OFF;
   - Advanced → **Proof Key for Code Exchange: S256** (obrigatório);
   - Valid redirect URI **exata**: `http://localhost:3000/api/auth/keycloak/callback`;
   - Web origins: `http://localhost:3000`.
3. Copiar o client secret (aba Credentials).
4. Criar o usuário de teste no realm com o **mesmo e-mail** do usuário local (`aluno@acme.dev`),
   e-mail marcado como verificado, e definir uma senha.

## 2. Configuração da plataforma

Variáveis de ambiente da API (dev):

```bash
LEARNHOUSE_KEYCLOAK_ENABLED=true
LEARNHOUSE_KEYCLOAK_ISSUER=http://localhost:8080/realms/plataforma   # HTTPS obrigatório fora de dev
LEARNHOUSE_KEYCLOAK_CLIENT_ID=learnhouse-web
LEARNHOUSE_KEYCLOAK_CLIENT_SECRET=<segredo copiado do Keycloak>
LEARNHOUSE_KEYCLOAK_CLOCK_SKEW=30
```

Subir tudo:

```bash
npx learnhouse dev
```

Sanidade: `curl "http://localhost:1338/api/v1/auth/keycloak/status?org=acme"` → `{"enabled": true}`.

## 3. Cenários de validação manual

### 3.1 Login feliz (US1 / SC-001)

1. Abrir `http://localhost:3000/auth/login?org=acme` (página de login da org).
2. Clicar em **"Entrar com identidade corporativa"** → navegador vai ao Keycloak.
3. Autenticar como `aluno@acme.dev`.
4. Esperado: retorno à plataforma já autenticado, na página de destino, em menos de 15 s; cookies
   `LH_access`/`LH_refresh` (httpOnly) e `LH_session` presentes.

### 3.2 Nenhum token no navegador (US2 / SC-003)

Com DevTools abertos durante o login completo:

- **Network**: nenhuma resposta visível ao navegador contém `access_token`, `refresh_token` ou
  `id_token` do Keycloak; a URL de retorno tem apenas `code` e `state` (query, nunca fragmento);
  as respostas das rotas `/api/auth/keycloak/*` são 302 sem corpo com tokens.
- **Application → Local/Session Storage**: nenhum token do provedor.
- **Application → Cookies**: apenas `LH_*`; `LH_access`/`LH_refresh` marcados HttpOnly.
- **Console**: `document.cookie` não revela `LH_access`/`LH_refresh`.

### 3.3 Cancelamento no provedor (US1-AC2)

Na tela do Keycloak, cancelar/voltar. Esperado: retorno a `/login?...&error=acesso_nao_concluido`
com mensagem clara em português e **nenhum** cookie de sessão criado.

### 3.4 State reutilizado (US3 / SC-002)

1. Fazer um login e capturar a URL do callback (`.../api/auth/keycloak/callback?code=...&state=...`)
   no histórico do DevTools.
2. Em uma janela anônima, colar a mesma URL.
3. Esperado: redirect para `/login?...&error=sessao_expirada`, sem sessão (state é uso único —
   `GETDEL` já consumiu a chave).

### 3.5 Nonce/token adulterado (US3)

Simulável apenas com stub (ver testes automatizados) ou alterando o clock/realm; a verificação
manual equivalente é a rotação de chaves: em Realm Settings → Keys, gerar nova chave ativa e fazer
login — deve concluir normalmente (JWKS rebuscado), nunca aceitar assinatura inválida.

### 3.6 Provedor indisponível (SC-005 / FR-011)

1. `docker stop kc-dev`.
2. Usuário já logado continua navegando (sessão interna não depende do Keycloak).
3. Clicar em "Entrar com identidade corporativa" → mensagem de indisponibilidade temporária
   (`error=sso_indisponivel`), sem stack trace.
4. Login nativo por e-mail/senha continua funcionando (SC-004).
5. `docker start kc-dev` e repetir 3.1.

### 3.7 Open redirect (edge case)

Abrir `http://localhost:3000/api/auth/keycloak/authorize?org=acme&redirect=//evil.com` e concluir o
login. Esperado: destino final é `/` (ou caminho interno), nunca `evil.com`. Repetir com
`redirect=https://evil.com` e `redirect=javascript:alert(1)`.

## 4. Testes automatizados

```bash
cd apps/api
# Suíte da feature
uv run pytest src/tests/routers/test_keycloak_auth_router.py src/tests/security/test_keycloak_oidc_validation.py -v

# Regressão dos fluxos de auth existentes (SC-004)
uv run pytest src/tests/routers/test_auth_router.py src/tests/routers/test_login_provenance.py src/tests/security/test_auth_policy.py -v

# Suíte completa da API com cobertura (flag `api` do CI)
uv run pytest
```

Cobertura mínima esperada (SC-002 — todos terminam **sem sessão**):

| Caso negativo | Teste |
|---|---|
| state inválido/expirado/reutilizado | `test_keycloak_auth_router.py` |
| código recusado pelo token_endpoint (expirado/reutilizado/PKCE errado) | `test_keycloak_auth_router.py` |
| assinatura inválida / `kid` desconhecido | `test_keycloak_oidc_validation.py` |
| `iss` incorreto | `test_keycloak_oidc_validation.py` |
| `aud`/`azp` incorretos | `test_keycloak_oidc_validation.py` |
| `exp`/`nbf`/`iat` fora da janela (± leeway) | `test_keycloak_oidc_validation.py` |
| `nonce` divergente | `test_keycloak_oidc_validation.py` |
| `email_verified=false` / usuário inexistente | `test_keycloak_auth_router.py` |
| redirect malicioso (`//host`, esquema externo) | `test_keycloak_auth_router.py` |
| org sem método `sso` permitido | `test_keycloak_auth_router.py` |

## 5. Critérios de saída da fase (aprovação — "login técnico validado")

- [ ] 3.1–3.7 executados com os resultados esperados em dev.
- [ ] Auditoria DevTools (3.2) sem nenhum token do provedor (SC-003).
- [ ] Suíte pytest verde, incluindo todos os casos negativos da tabela acima (SC-002).
- [ ] Login nativo sem regressão (SC-004) — suíte de regressão verde e teste manual de e-mail/senha.
- [ ] Nenhum log da API contém `code`, tokens ou `client_secret` durante os cenários (FR-010).
