# Implementation Plan: Criação automática de conta no primeiro acesso via Keycloak

**Branch**: `009-auto-provisionamento-keycloak` | **Date**: 2026-08-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-auto-provisionamento-keycloak/spec.md`

**Idioma**: o conteúdo preenchido DEVE ser escrito em português (pt-BR), conforme a
seção "Idioma Oficial" da constituição. Nomes de arquivos, identificadores de código e
termos técnicos consagrados permanecem em inglês.

## Summary

Quem se autentica no Keycloak da plataforma e ainda não tem conta no LearnHouse
passa a ter a conta criada na hora, permanentemente vinculada àquela identidade, e
cai já autenticado na área da organização com o menu — mesmo destino de quem já
tinha conta.

O mecanismo de identidade federada não é reescrito: ele existe desde a feature 002
e está correto. Três ajustes cirúrgicos o fazem cumprir o pedido:

1. **Política** — no caminho da config global (o provedor da própria plataforma), a
   política de admissão passa a nascer com criação automática ligada, em vez de
   fail-closed. IdP de terceiro configurado por organização segue inalterado.
2. **Destino** — o destino pós-acesso deixa de ser um caminho vindo do cliente
   (`/home`, o seletor de organizações) e passa a ser derivado da organização do
   fluxo: a API devolve `org_slug`, o BFF compõe a raiz do host da organização, que
   é exatamente a área com menu.
3. **Robustez** — colisão de nome de usuário deixa de derrubar a criação inteira e
   passa a ser resolvida com sufixo determinístico.

Nada de schema muda, logo não há migração Alembic. A pesquisa que sustenta cada
escolha está em [research.md](./research.md).

## Technical Context

**Language/Version**: Python 3.12 (`apps/api`), TypeScript 5 / Node 20 (`apps/web`,
`apps/e2e`)

**Primary Dependencies**: FastAPI, SQLModel, `httpx`, `python-jose`/PyJWT já em uso
no fluxo OIDC (`apps/api`); Next.js App Router (`apps/web`); `@playwright/test`
(`apps/e2e`). **Nenhuma dependência nova.**

**Storage**: PostgreSQL via SQLModel (tabelas existentes: `user`,
`userorganization`, `externalidentity`, `oidcproviderconfig`, `upstream_sessions`),
Redis para o fluxo OIDC de uso único. **Nenhuma alteração de schema.**

**Testing**: `pytest` com a flag de cobertura `api` (`apps/api/src/tests/`);
`@playwright/test` contra o ambiente local com Keycloak real (`apps/e2e/features/keycloak/`)

**Target Platform**: Linux server em Docker; navegador moderno para o fluxo de
redirecionamento

**Project Type**: Monorepo web — API FastAPI + frontend Next.js + suíte e2e

**Performance Goals**: o retorno do provedor até a área com menu em menos de 30s
(SC-001); nenhuma chamada de rede adicional ao provedor introduzida por esta
feature

**Constraints**: destino nunca derivado de entrada do usuário (FR-007); nenhuma
guarda de admissão relaxada (e-mail verificado, domínio, papel mínimo, bloqueio de
conta); tokens do provedor nunca saem do servidor; mensagens ao usuário genéricas e
em pt-BR

**Scale/Scope**: 3 arquivos de produção na API, 2 no Web, 1 contrato entre apps;
~6 arquivos de teste (novos e alterados). Concorrência a garantir: 20 retornos
simultâneos da mesma identidade → 1 conta (SC-005).

## Constitution Check

*PORTÃO: DEVE passar antes da pesquisa da Fase 0. Reverificar após o design da Fase 1.*

- [x] **I. Fronteiras entre Apps São Contratos** — PASSA. A feature atravessa
  `apps/api` e `apps/web`, e o contrato alterado está escrito antes da
  implementação em [contracts/api-oidc-provisionamento.md](./contracts/api-oidc-provisionamento.md):
  `POST /auth/keycloak/callback` troca `redirect_to` por `org_slug`;
  `POST /auth/keycloak/authorize` deixa de aceitar `redirect_to`. Nenhum app além da
  API toca PostgreSQL ou Redis — o `apps/web` continua consumindo só os endpoints.
- [x] **II. Backend API-First** — PASSA. A decisão de negócio (criar, vincular,
  recusar, e qual organização) fica inteira em `apps/api`. O `apps/web` recebe o
  `org_slug` e apenas compõe a URL que o navegador deve visitar — conhecimento de
  hospedagem que é legitimamente do Web (tenancy, domínio, porta) e não uma regra de
  servidor duplicada. Nenhuma regra de admissão passa a existir no cliente.
- [x] **III. Mudanças de Schema Exigem Migrações e Testes** — PASSA. Nenhuma
  alteração de modelo, portanto nenhuma migração Alembic é devida (ver research.md
  D4). Toda mudança de comportamento da API tem teste planejado no mesmo PR:
  política de admissão, contrato do callback, colisão de username e concorrência
  (ver Estratégia de Testes).
- [x] **IV. Segurança Multi-Tenant É Inegociável** — PASSA. Nenhum endpoint novo. A
  conta criada entra na organização do fluxo com o papel de menor privilégio e o
  RBAC por organização segue regendo tudo depois (FR-009, SC-006). Guardas
  preservadas sem exceção: e-mail verificado, lista de domínios, bloqueio de conta
  no chokepoint, escopo da organização. O único default que muda é o de admissão, e
  **só** no caminho do provedor da própria plataforma — IdP de terceiro por
  organização permanece fail-closed (SC-008). A superfície de open redirect
  *diminui*: o destino deixa de aceitar entrada do usuário.
- [x] **V. Simplicidade e Reúso Primeiro** — PASSA. Nenhuma dependência nova,
  nenhuma abstração nova, nenhuma coluna nova. Reúsa `getUriWithOrg`,
  `provision_federated_login`, `get_effective_client_config`, a constraint única de
  `ExternalIdentity` e o chokepoint `mint_session_tokens`. A feature **remove** mais
  código do que adiciona no caminho do destino (`redirect_to` + `sanitize_redirect`).
  Sem separação AGPL/Enterprise afetada: o fluxo é do núcleo open-source.
- [x] **Stack Tecnológica** — PASSA. Nenhuma linguagem, framework, banco ou serviço
  externo novo.

**Reverificação pós-design (Fase 1)**: mantida em PASSA nos seis portões. O design
não introduziu entidade, endpoint, dependência nem configuração que não estivesse
prevista; a única adição ao contrato é um campo de resposta (`org_slug`) que
substitui outro (`redirect_to`), o que reduz a superfície em vez de ampliá-la.

## Project Structure

### Documentation (this feature)

```text
specs/009-auto-provisionamento-keycloak/
├── plan.md              # Este arquivo
├── research.md          # Fase 0 — achados no código e 6 decisões
├── data-model.md        # Fase 1 — entidades reusadas, política efetiva, transições
├── quickstart.md        # Fase 1 — como levantar e verificar no ambiente local
├── contracts/
│   └── api-oidc-provisionamento.md   # Fase 1 — delta de contrato API ↔ BFF
├── checklists/
│   └── requirements.md  # Saída do /speckit-specify
└── tasks.md             # Fase 2 — criado pelo /speckit-tasks (NÃO por este comando)
```

### Source Code (repository root)

```text
apps/api/                                  # FastAPI + SQLModel
├── src/routers/keycloak_auth.py           # ALTERA: política do fallback global;
│                                          #   resposta do callback (org_slug)
├── src/services/auth/provisioning.py      # ALTERA: username livre antes de criar
├── src/services/auth/keycloak_oidc.py     # ALTERA: create_flow/consume_flow sem
│                                          #   redirect_to; remove sanitize_redirect
└── src/tests/
    ├── routers/test_keycloak_auth_router.py   # ALTERA: contrato + política
    ├── services/test_provisioning.py          # ALTERA: criação ligada, colisão,
    │                                          #   concorrência
    └── security/test_keycloak_oidc_validation.py  # ALTERA: remove o teste de
                                                   #   sanitize_redirect

apps/web/                                  # Next.js
├── app/api/auth/keycloak/callback/route.ts    # ALTERA: destino via org_slug
├── app/auth/login/login.tsx                   # ALTERA: para de enviar redirect=/home
└── services/config/config.ts                  # REÚSA (sem alteração): getUriWithOrg

apps/e2e/features/keycloak/                # Playwright contra Keycloak real
├── coverage.ts                            # ALTERA: novas jornadas na matriz
├── api.ts                                 # ALTERA: authorize sem redirect_to
└── tests/
    ├── us1-auto-provision.spec.ts         # NOVO: primeiro acesso cria e cai no menu
    ├── us1-destino-menu.spec.ts           # NOVO: destino é a área com menu
    ├── us2-reentrada-mesma-conta.spec.ts  # NOVO: segundo acesso, mesma conta
    └── us1-redirect-allowlist.spec.ts     # ALTERA: destino ignora entrada do usuário
```

**Structure Decision**: monorepo LearnHouse, exatamente como está. A feature vive
em `apps/api` (regra de negócio e contrato), `apps/web` (composição do destino e
tela de entrada) e `apps/e2e` (verificação de ponta a ponta com provedor real).
Nenhum diretório novo, nenhum app novo. Os caminhos acima são os arquivos reais
apurados na Fase 0 — não há placeholder.

## Estratégia de Testes

O Princípio III exige teste para toda mudança de comportamento da API. Mapeamento
requisito → verificação:

| Requisito | Verificação | Onde |
|-----------|-------------|------|
| FR-001, FR-002 (plataforma) | Identidade nova sem conta, config global → conta criada e desfecho `provisioned` | `test_provisioning.py`, `test_keycloak_auth_router.py` |
| FR-002 (terceiro), SC-008 | Linha de config de org com `auto_provision_users=False` → nenhuma conta criada, comportamento idêntico ao atual | `test_provisioning.py` |
| FR-003, FR-004, SC-004 | Segundo acesso com mesmo `(issuer, subject)` → mesma conta, desfecho `login`, contagem de contas inalterada; e-mail alterado no provedor não cria conta nova | `test_provisioning.py`, `us2-reentrada-mesma-conta.spec.ts` |
| FR-005, FR-006, FR-007, SC-002 | Resposta do callback traz `org_slug` e não traz `redirect_to`; BFF compõe a raiz do host da organização; `redirect` malicioso na URL de autorização é ignorado | `test_keycloak_auth_router.py`, `us1-destino-menu.spec.ts`, `us1-redirect-allowlist.spec.ts` |
| FR-008 | E-mail não verificado e domínio fora da lista → recusa sem criação | `test_provisioning.py` (já coberto; reverificar com criação ligada) |
| FR-009, SC-006 | Conta criada recebe papel 4 e membresia da organização do fluxo; nunca papel administrativo | `test_provisioning.py` |
| FR-010 | E-mail coincidente na mesma org → vínculo; em outra org → conflito sem criação | `test_provisioning.py` (já coberto) |
| FR-011, SC-005 | Duas criações concorrentes da mesma identidade → 1 conta, perdedora conclui como login | `test_provisioning.py` (teste de `IntegrityError`) |
| FR-012 | Recusa e conflito não deixam conta, vínculo nem membresia órfã | `test_provisioning.py` |
| FR-013, SC-007 | `SSO_PROVISIONED`, `SSO_LINKED`, `LOGIN` e recusas distinguíveis na auditoria | `test_provisioning.py` |
| FR-014 | Recusas com mensagem genérica em pt-BR, sem revelar existência de conta/organização | `test_keycloak_auth_router.py` (já coberto) |
| Colisão de username (edge case, D3) | Username derivado já em uso por outro e-mail → conta criada com sufixo, acesso conclui | `test_provisioning.py` |
| SC-001 | Jornada completa em navegador, primeiro acesso → área com menu | `us1-auto-provision.spec.ts` |

Toda jornada e2e nova entra em `coverage.ts` com os requisitos que comprova — a
matriz é código e `zz-coverage.spec.ts` a confronta com os títulos reais, então
uma jornada declarada e não implementada aparece no relatório em vez de sumir.

## Complexity Tracking

> Nenhuma violação do Constitution Check. Seção intencionalmente vazia.
