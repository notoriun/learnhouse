# Implementation Plan: Federação de Identidade — Keycloak como Dono Único dos Usuários

**Branch**: `007-federacao-keycloak` | **Date**: 2026-08-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-federacao-keycloak/spec.md`

## Summary

Tornar o Keycloak da plataforma o dono único do ciclo de vida de identidade, com o LearnHouse
como relying party puro: (1) o caminho "Criar conta" das orgs com login corporativo ativo leva
à tela de registro do provedor (endpoint nativo `registrations`, mesmos parâmetros e PKCE do
fluxo de login já existente) e o retorno é processado pela admissão/JIT da feature 002 sem
regra nova; (2) migração one-shot idempotente (`--dry-run` default, filtro opcional por org)
leva as contas locais de senha para o realm importando o hash Argon2 e gravando os vínculos
`externalidentity`; (3) contas federadas têm troca local de senha/e-mail recusada com
direcionamento à account console do provedor. Nenhuma escrita no provedor em runtime; Admin
API só no script offline com client dedicado.

## Technical Context

**Language/Version**: Python 3.12 (API FastAPI/SQLModel), TypeScript/Next.js 16 (web)

**Primary Dependencies**: httpx (já instalado — Admin API no script), PyJWT/jwks e fluxo OIDC
existentes (`keycloak_oidc.py`); nenhuma dependência nova

**Storage**: PostgreSQL — tabelas existentes `user` e `externalidentity`; **nenhuma mudança de
schema** (o vínculo criado pela migração usa o modelo da feature 002)

**Testing**: pytest com mock de httpx no padrão da suíte da API (`apps/api/src/tests`);
typecheck TS no web

**Target Platform**: Docker self-hosted (imagem única) e dev local via compose

**Project Type**: web application (API + web, monorepo)

**Performance Goals**: migração sequencial com relatório — adequada a dezenas de milhares de
contas (uma chamada Admin API por conta; sem exigência de janela curta)

**Constraints**: sem dual-write em runtime (FR-009); credencial admin apenas no script
offline; issuer de terceiros (feature 004) intocado (FR-010); mensagens em pt-BR

**Scale/Scope**: 3 pontos de toque no código existente + 1 script novo; realm compartilhado
com um segundo sistema (e-mail é o identificador único; CPF gerido no provedor)

## Constitution Check

*GATE: aprovado antes da Phase 0; reavaliado após a Phase 1.*

- **I. Fronteiras entre Apps São Contratos** ✅ — o web continua falando com a API só pelo BFF
  REST (`/api/auth/keycloak/authorize` ganha o parâmetro `action`, contrato documentado em
  `contracts/`); o script de migração vive em `apps/api` e usa a camada de dados da própria
  API.
- **II. Backend API-First** ✅ — a troca de path para `registrations` acontece na API
  (`keycloak_oidc.py`); os bloqueios de senha/e-mail federados vivem nos serviços da API; o
  front só repassa `action=register` e exibe mensagens.
- **III. Mudanças de Schema Exigem Migrações e Testes** ✅ — zero mudança de schema (reúso de
  `externalidentity`); mudanças de comportamento acompanhadas de testes pytest (authorize com
  action, guards federados, migração com Admin API mockada).
- **IV. Segurança Multi-Tenant É Inegociável** ✅ — registro escopado por `org_slug` validado
  como no login atual; vínculos criados somente para orgs de que o usuário é membro; guards
  aplicam-se ao próprio usuário autenticado (IDOR já protegido em `update_user_password`);
  anti-SSRF e write-only do segredo (features 001/004) intocados.
- **V. Simplicidade e Reúso Primeiro** ✅ — reúso integral de authorize/callback/admissão/JIT;
  nenhuma dependência nova; nenhuma tabela nova; a alternativa "espelhamento runtime"
  (dual-write) foi rejeitada em brainstorming por complexidade e divergência.

**Violações**: nenhuma — Complexity Tracking vazio.

## Project Structure

### Documentation (this feature)

```text
specs/007-federacao-keycloak/
├── plan.md              # Este arquivo
├── research.md          # Phase 0 — decisões técnicas
├── data-model.md        # Phase 1 — entidades e regras
├── quickstart.md        # Phase 1 — validação ponta a ponta
├── contracts/
│   ├── registro-federado.md   # Contrato API/BFF do registro + guards
│   └── migracao-cli.md        # Contrato do script de migração
└── tasks.md             # Phase 2 (/speckit-tasks — não criado aqui)
```

### Source Code (repository root)

```text
apps/api/
├── src/services/auth/keycloak_oidc.py        # build da URL: suporte a action=register
├── src/routers/keycloak_auth.py              # /authorize aceita action opcional
├── src/services/users/users.py               # guards federados em update_user (e-mail)
│                                             #   e update_user_password
├── src/services/auth/federation.py           # NOVO: is_platform_federated + account console URL
├── scripts/migrate_users_to_keycloak.py      # NOVO: migração one-shot (Admin API)
└── src/tests/
    ├── routers/test_keycloak_auth_router.py  # casos action=register
    ├── services/test_federated_guards.py     # NOVO: bloqueios senha/e-mail
    └── scripts/test_migrate_users.py         # NOVO: migração (httpx mockado)

apps/web/
├── app/api/auth/keycloak/authorize/route.ts  # repassa action=register ao BFF
├── app/auth/login/login.tsx                  # "Criar conta" federado (login corporativo ativo)
└── components/Dashboard/Pages/Users/Security/ # recusa + link para account console

docker/keycloak/realm-dev.json                # dev: registrationAllowed + email-as-username
```

**Structure Decision**: monorepo existente (Princípio I); toda lógica nova na API, front
apenas UX. Helper `federation.py` novo porque a detecção de conta federada é consumida por
dois serviços distintos (senha e e-mail) e pelo front via erro estruturado — evita duplicação
(Princípio V).
