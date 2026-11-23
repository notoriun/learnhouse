# Quickstart: Validação — Identidade Externa, Linking e Provisionamento

**Feature**: `002-identidade-provisionamento` | **Date**: 2026-08-03

Roteiro de validação manual + comandos de teste. Pré-requisito: ambiente dev
(`npx learnhouse dev`) com PostgreSQL e Redis ativos, e a feature 001 (login/callback OIDC)
funcional com um realm Keycloak de desenvolvimento.

## 1. Migração aplicada

```bash
cd apps/api
uv run alembic upgrade head
```

Verificar no banco:

```sql
\d externalidentity
-- Esperado: colunas id, user_id, organization_id, issuer, subject, provider,
--           email_at_link_time, created_at, last_login_at
-- Constraint: uq_externalidentity_issuer_subject UNIQUE (issuer, subject)
-- FKs: user_id → user(id) ON DELETE CASCADE;
--      organization_id → organization(id) ON DELETE SET NULL

\d user_audit_event
-- Esperado: user_id agora nullable (era NOT NULL)
```

Testar reversibilidade: `uv run alembic downgrade -1 && uv run alembic upgrade head`.

## 2. Cenários de validação

Preparação comum: organização de teste com política configurada (enquanto a tela da feature
004 não existe, ajustar a configuração diretamente no banco/fixture). Padrão restritivo
esperado sem configuração: `auto_provision=False`, `allow_link_by_email=False`.

### 2.1 Primeiro acesso conforme (US1-1)

- Política: `auto_provision=True`, domínio do usuário permitido; usuário novo no Keycloak com
  e-mail verificado.
- Login → **esperado**: entra direto; existe 1 linha em `externalidentity` (issuer+subject,
  `email_at_link_time` preenchido), 1 `user` com `signup_method='sso'` e
  `email_verified=true`, 1 `userorganization` com o `role_id` padrão da política (menor
  privilégio — nunca 1/admin nem 2/maintainer), evento `sso_provisioned` em
  `user_audit_event` SEM tokens no metadata.

### 2.2 E-mail não verificado (US1-2)

- Usuário novo no Keycloak com e-mail NÃO verificado.
- Login → **esperado**: negado com orientação clara; ZERO linhas novas em `user`,
  `externalidentity` e `userorganization`; evento `sso_login_denied`
  (`reason=email_nao_verificado`).

### 2.3 Domínio proibido (US1-4)

- Política com `allowed_email_domains=["empresa.com.br"]`; usuário `@gmail.com` verificado.
- Login → **esperado**: negado; evento `sso_login_denied` (`reason=dominio_nao_permitido`,
  metadata só com o domínio, não o e-mail completo).

### 2.4 Auto-provision desligado (US1-3 + edge case)

- Política: `auto_provision=False`. Usuário novo → **esperado**: negado com orientação para
  contatar a administração; nenhuma conta criada.
- Usuário JÁ provisionado antes (cenário 2.1) → **esperado**: continua entrando normalmente
  (o ramo "localizar" não consulta auto_provision).

### 2.5 Troca de e-mail no provedor (US2)

- Alterar o e-mail do usuário do cenário 2.1 no Keycloak (manter verificado) e logar de novo.
- **Esperado**: mesma conta local (mesmo `user.id`), NENHUMA conta nova
  (`select count(*) from "user"` inalterado), `email_at_link_time` NÃO mudou, `User.email`
  NÃO mudou, `last_login_at` da identidade atualizado; evento `login` com
  `email_changed: true` no metadata.
- Variante de segurança (US2-2): criar usuário novo no Keycloak com o e-mail ANTIGO do
  usuário acima → **esperado**: NÃO entra na conta do antigo dono; termina em conflito ou
  provisionamento de conta própria conforme a política — nunca acesso à conta alheia.

### 2.6 Vínculo a conta pré-existente e conflito (US3)

- Conta local nativa com e-mail X; política `allow_link_by_email=True`; usuário Keycloak com
  e-mail X verificado → **esperado**: login na conta existente, linha nova em
  `externalidentity`, evento `sso_linked`; a conta passa a entrar pelos dois caminhos.
- Mesmo cenário com `allow_link_by_email=False` → **esperado**: fluxo interrompido, sem
  vínculo, evento `sso_conflict` (`reason=email_conflito_politica`) visível para revisão.
- E-mail coincidindo com conta de OUTRA organização → **esperado**: `sso_conflict`
  (`reason=email_em_outra_organizacao`), sem vínculo (Princípio IV).

### 2.7 Sessão e renovação concorrente (US4)

- Após login federado, inspecionar DevTools: cookies `LH_access`/`LH_refresh` httpOnly;
  nenhum token do provedor em rede/localStorage.
- Abrir 5 abas e forçar renovações simultâneas (esperar a expiração do access token ou
  chamar `GET /api/auth/refresh` em paralelo) → **esperado**: todas as abas mantêm a sessão
  (janela de graça re-serve o mesmo par; log `auth.refresh outcome=grace_reused`).
- Reapresentar um refresh token antigo (copiado antes de várias rotações, fora da janela de
  5 min) → **esperado**: 401, log `auth.refresh outcome=replay_detected` (WARNING) e todas as
  sessões do usuário revogadas.

## 3. Comandos de teste

```bash
cd apps/api

# Suíte da feature (novos testes)
uv run pytest src/tests/services/test_provisioning.py -x -q

# Regressão de sessão/rotação (existentes — devem continuar verdes)
uv run pytest src/tests/routers/test_auth_router.py \
              src/tests/routers/test_auth_logout_revocation.py \
              src/tests/routers/test_login_provenance.py -q

# Regressão de autorização (SC-006: zero regressão de permissões)
uv run pytest src/tests/security -q

# Suíte completa da API
uv run pytest src/tests -q
```

## 4. Checklist de aceitação rápida

- [ ] Migração sobe e desce limpa; constraint `uq_externalidentity_issuer_subject` presente.
- [ ] Todos os 6 grupos de cenários acima passam manualmente e via pytest.
- [ ] `select * from user_audit_event where event_type like 'sso_%'` não contém nenhum token,
      código ou segredo em `audit_metadata`.
- [ ] Zero vínculos a partir de e-mail não verificado em qualquer caminho (SC-002).
- [ ] Suíte de autorização existente verde (SC-006).
