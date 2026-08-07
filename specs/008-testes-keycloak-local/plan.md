# Plano de Implementação: Validação Ponta a Ponta do Login Corporativo (Keycloak)

**Branch**: `008-testes-keycloak-local` | **Data**: 2026-08-06 | **Spec**: [spec.md](./spec.md)

**Input**: Especificação de feature em `/specs/008-testes-keycloak-local/spec.md`

**Idioma**: pt-BR, conforme a seção "Idioma Oficial" da constituição.

## Summary

A entrega é um módulo de validação de aceitação — `apps/e2e/features/keycloak/` — que exercita
as jornadas de identidade corporativa (entrada, registro, encerramento de sessão coordenado e
guardas de conta federada) contra o **Keycloak real** do compose local, produzindo veredito
aprovado/reprovado com relatório e classificação de causa.

A abordagem técnica se firmou em três achados da Fase 0, todos obtidos executando o ambiente:

1. **O harness já serve.** `E2E_BASE_URL`/`E2E_SKIP_BOOT` em
   [core/instance.ts](../../apps/e2e/core/instance.ts) fazem a suíte Playwright existente rodar
   contra uma instância que ela não subiu. O risco de "harness incompatível" e o suposto
   conflito de porta 8080 levantados na especificação **não se confirmaram**.
2. **O ambiente documentado não sobe como documentado.** Falta o `.env` e falta
   `LEARNHOUSE_DEVELOPMENT_MODE=True`. A feature passa a entregar um template versionado de
   ambiente local e a corrigir a documentação.
3. **Duas jornadas têm bloqueio de ambiente, não de código.** US5 é barrada pela proteção
   anti-SSRF que rejeita `localhost` (recusa correta, não defeito) e fica fora da entrega; o
   caminho feliz de US2 exige um coletor de SMTP no compose, que a feature acrescenta.

## Technical Context

**Language/Version**: TypeScript sobre Node/Bun para o módulo de validação (a suíte existente
usa Bun como gerenciador e `@playwright/test`); Python 3 apenas para os testes complementares de
back-channel na suíte da API.

**Primary Dependencies**: `@playwright/test` (já presente em `apps/e2e`); nenhuma dependência
nova na aplicação. No ambiente de teste, um coletor SMTP descartável em contêiner.

**Storage**: nenhuma persistência nova. A validação lê estado pela API REST da plataforma e pela
API do provedor; não toca PostgreSQL nem Redis diretamente (Princípio I).

**Testing**: `@playwright/test` para as jornadas com superfície de navegador; `pytest` na suíte
de `apps/api` para a notificação de encerramento vinda do provedor (back-channel), que não tem
superfície visível.

**Target Platform**: Linux com Docker; ambiente do `docker-compose.local.yml` (aplicação na
porta 80, Keycloak 26.3 na 8080, sidecar de encaminhamento no namespace de rede da aplicação).

**Project Type**: monorepo LearnHouse — a entrega concentra-se em `apps/e2e`, com ajustes de
ambiente em `docker/keycloak/` e `docker-compose.local.yml`, e correção de documentação em
`docs/content/`.

**Performance Goals**: veredito completo em menos de 20 minutos de ponta a ponta contando o
preparo do ambiente (SC-001); a suíte roda serialmente (`workers: 1`, herdado do harness), com
timeout de 120 s por jornada.

**Constraints**: nenhum provedor simulado nas jornadas validadas (FR-001); nenhum acesso a
provedor externo ao ambiente local (FR-013); nenhum segredo em texto legível nos artefatos
(FR-012); repetível sem recriar o ambiente (FR-009).

**Scale/Scope**: 4 áreas de jornada (US1–US4), estimadas em 12 a 16 jornadas verificadas, mais
uma fase de 6 pré-condições de ambiente.

## Constitution Check

*PORTÃO: DEVE passar antes da pesquisa da Fase 0. Reverificado após o design da Fase 1.*

- [x] **I. Fronteiras entre Apps São Contratos** — PASSA. A validação consome exclusivamente
  interfaces publicadas: a interface web, os endpoints REST sob `/api/v1/auth/keycloak/*` e
  `/api/v1/instance/info`, e as interfaces do próprio provedor. Não acessa PostgreSQL nem Redis
  diretamente, e não abre canal paralelo entre apps.
- [x] **II. Backend API-First** — PASSA. Nenhuma lógica de negócio é criada. A validação lê o
  estado pela API, tratada como fonte única da verdade, e não reimplementa nenhuma regra de
  admissão, provisionamento ou revogação para conferir resultado.
- [x] **III. Mudanças de Schema Exigem Migrações e Testes** — N/A para migração (a feature não
  altera nenhum modelo SQLModel), PASSA para testes (a entrega **é** teste; os testes
  complementares de back-channel entram na suíte de `apps/api` no mesmo PR).
- [x] **IV. Segurança Multi-Tenant É Inegociável** — PASSA. Nenhum endpoint é criado ou
  alterado, portanto nenhuma verificação de RBAC é afetada. A validação **reforça** o princípio:
  as jornadas de negação comprovam que acesso recusado não cria sessão (FR-008), e D-05
  documenta que a proteção anti-SSRF que barra `localhost` é comportamento correto a preservar,
  não obstáculo a contornar. Nenhum atalho de teste enfraquece autenticação ou validação de
  fronteira.
- [x] **V. Simplicidade e Reúso Primeiro** — PASSA. Zero dependência nova na aplicação; o módulo
  reaproveita harness, helpers de autenticação, relatório e padrão de estrutura por área já
  existentes em `apps/e2e`. A única adição de infraestrutura é o coletor SMTP, justificado em
  D-06 e restrito ao compose local de desenvolvimento — não entra em nenhum caminho de produção
  nem na separação open-source/Enterprise.
- [x] **Stack Tecnológica** — PASSA. TypeScript, Playwright, pytest e Docker já são a stack. O
  coletor SMTP é serviço de ambiente de teste descartável, não serviço da plataforma, e por isso
  não constitui "novo serviço externo" no sentido constitucional.

**Resultado**: nenhuma violação. Complexity Tracking permanece vazio.

## Execução real do ambiente (Fase 0)

O usuário pediu explicitamente para subir o ambiente e testar. O que ocorreu, na ordem:

| Passo | Resultado |
|---|---|
| Docker disponível | OK — Docker 29.6.1, Compose v5.1.4 |
| Portas 80 e 8080 livres no host | OK — nenhuma delas em escuta |
| `.env` presente | **FALHOU** — inexistente, e sem template no repositório (D-03) |
| `.env` construído a partir de `apps/cli/src/templates/env.ts` | OK — segredos gerados localmente, `LEARNHOUSE_DEVELOPMENT_MODE=True` incluído por D-04 |
| `docker compose -f docker-compose.local.yml up -d --build` | OK — 5 serviços de pé (aplicação, db, redis, keycloak, sidecar) |
| Arranque da aplicação, 1ª tentativa | **FALHOU** — `ValidationError` no `cli.py`: `admin@local.test` recusado, TLD reservado |
| `LEARNHOUSE_FRONTEND_DOMAIN` presente | **FALHOU** — ausente; ver D-13 |
| Arranque da aplicação, após correções | OK — rota de saúde em 200 |

### Pré-condições (D-08) — todas verdes

| Pré-condição | Resultado |
|---|---|
| Saúde da aplicação | OK — 200 |
| Descoberta do realm no host | OK — issuer `http://localhost:8080/realms/dev` |
| Estado do login corporativo | OK — `{"enabled":true,"platform":true}` |
| Encaminhamento interno (sidecar) alcança o provedor de dentro da aplicação | OK — 200 |
| Realm contém os usuários de teste esperados | OK — `teste@example.com` verificado, `nao-verificado@example.com` não verificado |
| `account_console_url` exposto | OK — `http://localhost:8080/realms/dev/account` |

### Jornadas exercitadas contra o Keycloak real

O fluxo OIDC completo foi executado como um navegador faria — criação do fluxo, tela de
autenticação do provedor, envio de credencial, código de autorização, callback do BFF:

| Jornada | Resultado | Veredito |
|---|---|---|
| Credencial verificada → sessão | Redireciona para a raiz; cookie `LH_session` emitido | **Aprovado** |
| Credencial inválida | Provedor não redireciona; nenhum código; nenhuma sessão | **Aprovado** (FR-008) |
| E-mail não verificado | Provedor emite código; plataforma recusa; nenhuma sessão | **Aprovado** (FR-008) |

**O login corporativo funciona ponta a ponta contra o Keycloak real** — mas só depois de duas
correções que a documentação não pede (D-13, D-14).

### Correções aplicadas durante o preparo

1. `LEARNHOUSE_INITIAL_ADMIN_EMAIL` trocado de domínio `.test` para `.com` — o validador de
   e-mail rejeita os TLDs reservados `.test`, `.example` e `.localhost`, e o arranque morre com
   `ValidationError` (D-09).
2. `LEARNHOUSE_FRONTEND_DOMAIN=localhost` acrescentado — sem ela a `redirect_uri` sai como
   `localhost:3000`, divergente da registrada no realm (**defeito de produto**, D-13).
3. Conta local `teste@example.com` criada — sem ela a admissão recusa com `conta_nao_encontrada`,
   que é comportamento **correto** e não defeito (D-14).

Nada ficou pendente nesta bateria. O que **não** foi exercitado, com razão registrada: US3
(encerramento coordenado) e US4 (guardas federadas), que precisam do módulo automatizado para
serem verificadas com rigor; o caminho feliz de US2, bloqueado pela falta de SMTP no realm (D-06);
e US5, bloqueada por D-05.

## Project Structure

### Documentation (this feature)

```text
specs/008-testes-keycloak-local/
├── plan.md              # Este arquivo
├── research.md          # Fase 0 — decisões D-01 a D-12 com evidência
├── data-model.md        # Fase 1 — entidades da validação
├── quickstart.md        # Fase 1 — como preparar o ambiente e executar
├── contracts/           # Fase 1 — contratos consumidos e matriz de rastreabilidade
├── checklists/
│   └── requirements.md  # Checklist de qualidade da especificação
└── tasks.md             # Fase 2 — gerado por /speckit-tasks
```

### Source Code (repository root)

```text
apps/e2e/
├── core/                          # reaproveitado sem alteração (auth, client, fixtures, instance)
└── features/
    └── keycloak/                  # NOVO — módulo desta feature
        ├── api.ts                 # leitura de estado pela API da plataforma
        ├── provider.ts            # leitura do provedor: descoberta, admin, coletor de e-mail
        ├── preconditions.ts       # fase de pré-condições e classificação de causa (D-08)
        ├── coverage.ts            # matriz requisito -> jornada (D-10)
        ├── pages/                 # objetos de página: entrada, tela do provedor, perfil
        ├── tests/                 # jornadas US1 a US4
        └── verify.ts              # asserções de estado no servidor

apps/api/src/tests/routers/        # teste complementar de back-channel logout (sem UI)

docker/keycloak/realm-dev.json     # + smtpServer apontando ao coletor (D-06)
docker-compose.local.yml           # + serviço do coletor SMTP
.env.local.example                 # NOVO — template de ambiente local (D-03, D-04)
docs/content/developers/contributing/keycloak-local.mdx   # correções de D-03, D-04, D-07
```

**Structure Decision**: módulo novo dentro de `apps/e2e/features/`, seguindo o layout já usado
por `assignments` e `scorm` (`api.ts`, `pages/`, `tests/`, `verify.ts`) e acrescentando três
arquivos próprios ao problema desta feature: `provider.ts` (o provedor real é interlocutor novo
para a suíte), `preconditions.ts` (classificação de causa exigida por FR-007) e `coverage.ts`
(rastreabilidade exigida por FR-014). O `core/` existente não é alterado — a parametrização
necessária já está exposta por variável de ambiente.

## Escopo desta entrega

**Dentro**: US1 (entrada), US2 (registro e recusa de e-mail não verificado), US3 (encerramento
coordenado), US4 (guardas de conta federada) — conforme FR-016. Mais: template de ambiente
local, coletor SMTP no compose, correções na documentação e registro dos defeitos encontrados.

**Fora, com razão registrada**:
- **US5** (administração da configuração por organização) — bloqueada por D-05: a proteção
  anti-SSRF recusa `localhost`, e a recusa é correta. Precisa de um hostname que resolva para
  endereço público; decisão de ambiente para feature própria.
- **US6** (migração de contas) — mantida fora por FR-016, e depende do passo manual de conceder
  `manage-users` à conta de serviço, que a documentação já descreve como manual.
- **Correção dos defeitos que a validação expuser** — premissa explícita da especificação; a
  entrega inclui o registro rastreável, não a correção.

## Complexity Tracking

> Preencher SOMENTE se o Constitution Check tiver violações a justificar.

Sem violações. Nada a registrar.
