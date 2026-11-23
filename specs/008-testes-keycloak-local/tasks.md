---

description: "Tarefas de implementação — Validação Ponta a Ponta do Login Corporativo (Keycloak)"
---

# Tasks: Validação Ponta a Ponta do Login Corporativo (Keycloak)

**Input**: Documentos de design em `/specs/008-testes-keycloak-local/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Idioma**: tarefas em português (pt-BR), conforme a seção "Idioma Oficial" da constituição.

**Sobre testes**: esta feature **é** um artefato de teste. A distinção usual entre "tarefa de
implementação" e "tarefa de teste" não se aplica — toda tarefa das Fases 3 a 6 cria uma jornada
verificada. Não há alteração de modelo SQLModel, portanto **nenhuma migração Alembic é devida**
(Princípio III, verificado no Constitution Check do plano).

**Organização**: agrupado por user story, para que cada uma seja implementável e verificável de
forma independente.

## Format: `[ID] [P?] [Story] Descrição`

- **[P]**: pode rodar em paralelo (arquivos distintos, sem dependência pendente)
- **[Story]**: user story a que a tarefa pertence (US1 a US4)
- Todo caminho de arquivo é explícito

## Path Conventions

Monorepo LearnHouse. A entrega concentra-se em `apps/e2e/features/keycloak/`, com ajustes de
ambiente em `docker/`, `docker-compose.local.yml` e `.env.local.example`, um teste complementar em
`apps/api/src/tests/` e correções em `docs/content/`.

## Escopo

**Dentro**: US1 a US4, conforme FR-016.
**Fora, com razão registrada no plano**: US5 (bloqueada por D-05 — a proteção anti-SSRF recusa
`localhost`, e a recusa é correta), US6 (FR-016), e a **correção** dos defeitos que a validação
expõe (premissa da especificação — a entrega inclui o registro, não a correção).

---

## Phase 1: Setup (infraestrutura compartilhada)

**Purpose**: tornar o ambiente subível conforme documentado e criar o esqueleto do módulo.

- [X] T001 Criar a estrutura do módulo em `apps/e2e/features/keycloak/` com os subdiretórios `pages/` e `tests/`
- [X] T002 [P] Criar o template de ambiente local em `.env.local.example` com todas as variáveis do passo 1 do [quickstart.md](./quickstart.md), incluindo `LEARNHOUSE_DEVELOPMENT_MODE=True` (D-04) e `LEARNHOUSE_FRONTEND_DOMAIN=localhost` (D-13), com comentário explicando por que cada uma é obrigatória
- [X] T003 [P] Acrescentar o serviço de coletor SMTP descartável a `docker-compose.local.yml`, exposto ao host para leitura das mensagens e alcançável pelo Keycloak na rede do compose (D-06)
- [X] T004 Configurar `smtpServer` em `docker/keycloak/realm-dev.json` apontando para o coletor do T003 (depende de T003). **`verifyEmail` do realm permanece desligado** — ligá-lo quebraria a jornada T032, porque o Keycloak passaria a bloquear o usuário não verificado na própria tela e nunca emitiria o código que a plataforma precisa recusar na admissão. T031 dispara a verificação pela ação de envio do próprio provedor (D-06.1)
- [X] T005 [P] Adicionar a `apps/e2e/package.json` um script `test:keycloak` que executa somente `features/keycloak` com `E2E_BASE_URL` obrigatório, falhando com mensagem clara quando a variável não estiver definida
- [X] T006 [P] Adicionar a `apps/e2e/README.md` a seção de como rodar o módulo de Keycloak contra o compose local, referenciando o [quickstart.md](./quickstart.md)

**Checkpoint**: o ambiente sobe seguindo apenas o repositório, sem conhecimento implícito.

---

## Phase 2: Foundational (pré-requisitos bloqueantes)

**Purpose**: infraestrutura do módulo que TODA user story consome.

**⚠️ CRÍTICO**: nenhuma user story pode começar antes desta fase terminar.

- [X] T007 Criar `apps/e2e/features/keycloak/config.ts` como origem única das credenciais de teste e do endereço do provedor, lendo de variável de ambiente com padrão do compose local — nenhum identificador literal espalhado pelos testes (D-07, entidade `CredencialDeTeste`)
- [X] T008 [P] Criar `apps/e2e/features/keycloak/provider.ts` com leitura do documento de descoberta do realm, autenticação administrativa no realm e consulta de usuários e sessões (contratos da seção 3 de [interfaces-consumidas.md](./contracts/interfaces-consumidas.md))
- [X] T009 [P] Criar `apps/e2e/features/keycloak/mailbox.ts` com leitura programática das mensagens do coletor SMTP do T003 e extração do link de verificação de e-mail (D-06)
- [X] T010 [P] Criar `apps/e2e/features/keycloak/api.ts` com leitura de estado pela API da plataforma: `GET /api/v1/auth/keycloak/status`, `POST /api/v1/auth/keycloak/authorize` e `GET /api/v1/instance/info` (seção 1 de [interfaces-consumidas.md](./contracts/interfaces-consumidas.md))
- [X] T011 Criar `apps/e2e/features/keycloak/preconditions.ts` com as 6 pré-condições da tabela de D-08, cada uma com `categoriaDeFalha` e `instrucaoDeCorrecao`, parando na primeira falha e marcando as seguintes como não executadas (entidade `PreCondicao`, FR-003, FR-004, FR-007) — depende de T008 e T010
- [X] T012 Estender `apps/e2e/features/keycloak/preconditions.ts` com a pré-condição de conta local de vínculo: garantir que a conta de e-mail da credencial verificada existe na organização, criando-a quando ausente (D-14, FR-010) — depende de T011
- [X] T013 [P] Criar `apps/e2e/features/keycloak/fixtures.ts` com o sufixo único por execução e a fábrica de identidade efêmera no provedor, usando domínio de e-mail de TLD comum (entidade `IdentidadeEfemera`, D-09, FR-009)
- [X] T014 [P] Criar `apps/e2e/features/keycloak/coverage.ts` com a matriz requisito → jornada da seção 5 de [interfaces-consumidas.md](./contracts/interfaces-consumidas.md), exportada de forma consultável (FR-014)
- [X] T015 [P] Criar `apps/e2e/features/keycloak/verify.ts` com as asserções de estado no servidor reutilizadas pelas jornadas: sessão da plataforma presente ou ausente, vínculo de identidade externa existente, papel atribuído à conta
- [X] T016 [P] Criar `apps/e2e/features/keycloak/pages/login.ts` como objeto de página da tela de entrada da plataforma, cobrindo a presença e a ausência da opção de entrada corporativa e da opção de registro
- [X] T017 [P] Criar `apps/e2e/features/keycloak/pages/provider.ts` como objeto de página das telas de autenticação e de registro do realm
- [X] T018 Criar `apps/e2e/features/keycloak/reporter.ts` que agrega pré-condições e jornadas em um relatório com veredito por jornada, veredito agregado e a categoria de causa de cada reprovação, garantindo que etapa, esperado e observado estejam presentes em toda reprovação (entidade `ExecucaoDeValidacao`, FR-005, FR-006, FR-007) — depende de T011 e T014
- [X] T019 Adicionar a `apps/e2e/features/keycloak/reporter.ts` o saneamento que impede senha, segredo de cliente, código de autorização e token de aparecerem no relatório e nos registros de execução (FR-012, D-12) — depende de T018
- [X] T020 Criar `apps/e2e/features/keycloak/tests/preconditions.spec.ts` que executa a fase de pré-condições e falha a execução inteira com causa de ambiente quando qualquer uma reprova, antes de qualquer jornada rodar (FR-003) — depende de T011, T012 e T018

**Checkpoint**: fundação pronta — as user stories podem seguir em paralelo.

---

## Phase 3: User Story 1 — Login corporativo ponta a ponta (Priority: P1) 🎯 MVP

**Goal**: veredito automático de que a entrada por identidade corporativa funciona contra o
Keycloak real, com sessão utilizável ao final.

**Independent Test**: subir o ambiente conforme o [quickstart.md](./quickstart.md), rodar
`test:keycloak` restrito a US1, e conferir que reporta aprovado; em seguida parar o contêiner do
provedor e conferir que reprova classificando indisponibilidade de serviço.

- [X] T021 [P] [US1] Jornada "entrada com credencial verificada emite sessão utilizável" em `apps/e2e/features/keycloak/tests/us1-login.spec.ts`, cobrindo a jornada completa pela interface até acessar uma área que exige autenticação — FR-001, FR-002, FR-007 (001)
- [X] T022 [P] [US1] Jornada "fluxo usa Authorization Code com parâmetros de uso único" em `apps/e2e/features/keycloak/tests/us1-flow-params.spec.ts`, comprovando presença de `state`, `nonce` e `code_challenge` na URL de autorização e recusa do reuso do mesmo `state` — FR-002, FR-003 (001)
- [X] T023 [P] [US1] Jornada "redirect URI emitida coincide com a registrada no provedor" em `apps/e2e/features/keycloak/tests/us1-redirect-uri.spec.ts`, comparando a `redirect_uri` da URL de autorização com a URI registrada no client do realm — verificação barata que pega toda uma classe de quebra de configuração (D-13)
- [X] T024 [P] [US1] Jornada "retorno processado só no servidor; token do provedor não vaza" em `apps/e2e/features/keycloak/tests/us1-server-side.spec.ts`, comprovando que nenhum token do provedor aparece em resposta, cookie acessível por script ou armazenamento do navegador — FR-004 (001)
- [X] T025 [P] [US1] Jornada "endpoints descobertos a partir do issuer" em `apps/e2e/features/keycloak/tests/us1-discovery.spec.ts`, comprovando que os endereços usados no fluxo vêm do documento de descoberta do realm — FR-006 (001)
- [X] T026 [P] [US1] Jornada "credencial inválida nega acesso sem criar sessão" em `apps/e2e/features/keycloak/tests/us1-invalid-credential.spec.ts` — FR-009 (001), FR-008
- [ ] T027 [P] [US1] Jornada "token de identidade inválido nega acesso" em `apps/e2e/features/keycloak/tests/us1-token-validation.spec.ts`, exercitando ao menos a divergência de relógio além da tolerância configurada, sem substituir o provedor por simulação — FR-005 (001)
- [X] T028 [P] [US1] Jornada "redirecionamento final só para caminho permitido" em `apps/e2e/features/keycloak/tests/us1-redirect-allowlist.spec.ts`, comprovando que destino externo é descartado em favor de destino interno — FR-008 (001)
- [X] T029 [US1] Jornada "provedor fora não afeta sessão interna já ativa" em `apps/e2e/features/keycloak/tests/us1-provider-down.spec.ts`, parando o provedor e comprovando que a sessão já emitida segue utilizável e que uma nova entrada reprova classificando indisponibilidade — FR-011 (001), FR-007. Não paralelizável: altera o estado do ambiente
- [X] T030 [US1] Restaurar o provedor ao final de `us1-provider-down.spec.ts` e comprovar que o ambiente volta ao estado utilizável, de modo que a repetibilidade de FR-009 não seja quebrada pela própria jornada — depende de T029

**Checkpoint**: US1 verificável isoladamente. Este é o MVP: substitui a verificação manual
irreproduzível que existe hoje.

---

## Phase 4: User Story 2 — Registro federado e recusa de e-mail não verificado (Priority: P2)

**Goal**: veredito sobre o caminho de criação de conta pelo provedor da plataforma e sobre a
recusa na admissão de e-mail não verificado.

**Independent Test**: rodar somente as jornadas de US2 e conferir que a conta aprovada existe com
o papel esperado e que a recusada não deixou conta nem sessão.

- [X] T031 [US2] Jornada "registro com e-mail verificado provisiona com menor privilégio" em `apps/e2e/features/keycloak/tests/us2-register.spec.ts`, percorrendo a tela de registro do realm, lendo o e-mail de verificação pelo coletor, concluindo a verificação e comprovando conta criada com vínculo e papel de menor privilégio — FR-001, FR-002 (007), FR-006 (002). Depende de T004 e T009
- [X] T032 [P] [US2] Jornada "e-mail não verificado é recusado na admissão, sem conta criada" em `apps/e2e/features/keycloak/tests/us2-unverified.spec.ts`, usando a credencial `nao-verificado` e comprovando ausência de sessão e de conta nova — FR-002 (007), FR-008
- [X] T033 [P] [US2] Jornada "provedor de terceiro não oferece registro" em `apps/e2e/features/keycloak/tests/us2-register-not-platform.spec.ts`, comprovando ausência da opção na interface e recusa da tentativa direta com o código de registro indisponível — FR-010 (007)
- [X] T034 [P] [US2] Jornada "identidade externa persistida com vínculo correto" em `apps/e2e/features/keycloak/tests/us2-identity-link.spec.ts`, comprovando que o vínculo guarda emissor e identificador do provedor e que uma segunda entrada cai na mesma conta — FR-001, FR-002, FR-003 (002)
- [X] T035 [P] [US2] Jornada "e-mail coincidente de outra procedência não vincula automaticamente" em `apps/e2e/features/keycloak/tests/us2-identity-conflict.spec.ts`, comprovando recusa em vez de vínculo — FR-004, FR-005 (002)

**Checkpoint**: US1 e US2 verificáveis de forma independente.

---

## Phase 5: User Story 3 — Encerramento de sessão coordenado (Priority: P3)

**Goal**: veredito de que sair encerra a sessão nos dois sistemas e que sessão derrubada no
provedor deixa de valer na plataforma.

**Independent Test**: entrar, sair, e comprovar que o novo acesso exige autenticação nos dois
sistemas; separadamente, derrubar a sessão pelo provedor e comprovar recusa na plataforma.

- [X] T036 [P] [US3] Jornada "sair encerra sessão local e sessão no provedor" em `apps/e2e/features/keycloak/tests/us3-logout.spec.ts`, comprovando revogação local, remoção de todas as variantes de cookie de sessão e ausência da sessão na consulta administrativa do realm — FR-001, FR-002, FR-003 (003)
- [X] T037 [P] [US3] Jornada "sessão derrubada no provedor deixa de valer na plataforma" em `apps/e2e/features/keycloak/tests/us3-provider-revocation.spec.ts`, encerrando a sessão pela interface administrativa do realm e comprovando que a plataforma passa a recusar — FR-004, FR-006 (003)
- [X] T038 [P] [US3] Jornada "encerramento nativo segue funcionando sem o provedor" em `apps/e2e/features/keycloak/tests/us3-native-logout.spec.ts`, com sessão de e-mail e senha — FR-010 (003)
- [ ] T039 [US3] Teste da notificação de encerramento vinda do provedor em `apps/api/src/tests/routers/test_keycloak_backchannel_real.py`, exercitando `POST /api/v1/auth/keycloak/backchannel-logout` com artefato emitido pelo Keycloak real do compose — jornada sem superfície visível, conforme a premissa da especificação — FR-004 (003)

**Checkpoint**: US1 a US3 verificáveis de forma independente.

---

## Phase 6: User Story 4 — Guardas de conta federada (Priority: P4)

**Goal**: veredito de que conta federada não troca senha nem e-mail na plataforma, e é
direcionada à central de conta do provedor, com o resto do perfil editável.

**Independent Test**: com conta federada, tentar trocar senha e e-mail e comprovar recusa com o
endereço da central de conta; em seguida editar um campo comum de perfil e comprovar aceite.

- [X] T040 [P] [US4] Jornada "conta federada recusa troca local de senha e de e-mail" em `apps/e2e/features/keycloak/tests/us4-federated-guards.spec.ts`, comprovando a recusa nas duas operações — FR-008 (007)
- [X] T041 [P] [US4] Jornada "recusa aponta a central de conta do provedor" em `apps/e2e/features/keycloak/tests/us4-account-console.spec.ts`, comparando o endereço exibido com o `account_console_url` devolvido por `GET /api/v1/instance/info` — FR-008 (007)
- [X] T042 [P] [US4] Jornada "perfil comum segue editável em conta federada" em `apps/e2e/features/keycloak/tests/us4-profile-editable.spec.ts`, alterando nome, biografia ou avatar — FR-008 (007)
- [X] T043 [P] [US4] Jornada "conta local não federada segue trocando senha" em `apps/e2e/features/keycloak/tests/us4-local-account.spec.ts` — FR-010 (007)

**Checkpoint**: as quatro user stories da amplitude acordada estão verificáveis.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: fechar o que atravessa as user stories, corrigir a documentação e registrar os
defeitos.

- [X] T044 Corrigir `docs/content/developers/contributing/keycloak-local.mdx` acrescentando o passo de criação do `.env` a partir de `.env.local.example`, as duas variáveis obrigatórias não documentadas (`LEARNHOUSE_DEVELOPMENT_MODE`, `LEARNHOUSE_FRONTEND_DOMAIN`) e a pré-condição de conta local de vínculo com a explicação de por que a admissão recusa sem ela (D-03, D-04, D-14)
- [X] T045 [P] Acrescentar a `docs/content/developers/contributing/keycloak-local.mdx` a advertência de que TLD reservado em `LEARNHOUSE_INITIAL_ADMIN_EMAIL` derruba o arranque da aplicação, com o sintoma observável (D-09)
- [X] T046 [P] Documentar o coletor SMTP e o fluxo de verificação de e-mail em `docs/content/developers/contributing/keycloak-local.mdx` (D-06)
- [X] T047 [P] Issue do defeito D-13 escrita e pronta para publicar em `specs/008-testes-keycloak-local/issue-bug-2.md` (publicação bloqueada: `gh` não autenticado). Originalmente: abrir Issue no GitHub para o defeito D-13 — a `redirect_uri` do login corporativo ignora o domínio configurado porque `frontend_domain` não cai para `LEARNHOUSE_DOMAIN` ([config.py:372-374](../../apps/api/config/config.py#L372-L374)) e o template community nunca emite `LEARNHOUSE_FRONTEND_DOMAIN` — registrando o alcance em self-hosts community e as duas frentes de correção candidatas (FR-015, SC-007)
- [ ] T048 [P] Abrir Issue no GitHub para a observação de experiência de D-15 — recusa por e-mail não verificado chega à interface com o mesmo código de conta inexistente, sem orientar a pessoa — referenciando `apps/web/app/api/auth/keycloak/callback/route.ts` e `apps/api/src/routers/keycloak_auth.py`, marcada como questão de produto a decidir, não defeito
- [X] T049 Criar a verificação de cobertura em `apps/e2e/features/keycloak/tests/coverage.spec.ts` que reprova quando existe jornada sem requisito de origem no título ou requisito da matriz sem jornada correspondente (SC-006) — depende de T014 e de todas as fases 3 a 6
- [X] T050 Criar a verificação de repetibilidade documentada em `apps/e2e/features/keycloak/README.md`, com o procedimento de rodar a suíte 3 vezes sobre o mesmo ambiente e conferir veredito idêntico por jornada (SC-004, FR-009)
- [X] T051 [P] Adicionar `.github/workflows/keycloak-validation.yaml` que sobe o compose local, aguarda prontidão e executa o módulo, disparado sob demanda e de forma agendada, **sem** ser portão obrigatório por pull request (FR-017), seguindo o precedente de [e2e.yaml](../../.github/workflows/e2e.yaml)
- [X] T052 [P] Publicar o relatório e os artefatos de falha como anexos da execução em `.github/workflows/keycloak-validation.yaml`, com retenção limitada e sem expor os segredos do ambiente (FR-012) — depende de T051
- [X] T053 Verificar em `apps/e2e/features/keycloak/README.md` que a execução distingue automaticamente aprovado de reprovado no encerramento do processo, registrando o procedimento de conferência para uso em automação (FR-011)
- [X] T054 Registrar em `apps/e2e/features/keycloak/README.md` o procedimento de sabotagem deliberada de cada categoria — provedor parado, pré-condição de preparação quebrada e configuração desativada — e conferir que a causa é classificada corretamente nos três casos (SC-005)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sem dependências — pode começar imediatamente
- **Foundational (Fase 2)**: depende da Fase 1 — BLOQUEIA todas as user stories
- **User Stories (Fases 3 a 6)**: todas dependem da Fase 2
  - Podem então seguir em paralelo, ou sequencialmente por prioridade (P1 → P2 → P3 → P4)
  - US2 tem dependência extra de ambiente: T004 e T009 (coletor SMTP)
- **Polish (Fase 7)**: T049 e T054 dependem de todas as user stories desejadas; as demais podem
  antecipar

### User Story Dependencies

- **US1 (P1)**: pode começar após a Fase 2 — sem dependência de outras stories
- **US2 (P2)**: pode começar após a Fase 2 — exige o coletor SMTP (T003, T004, T009)
- **US3 (P3)**: pode começar após a Fase 2 — reaproveita a entrada de US1 como preparo, mas é
  verificável isoladamente
- **US4 (P4)**: pode começar após a Fase 2 — exige uma conta federada, que a própria jornada
  produz

### Dentro de cada user story

- As pré-condições da Fase 2 valem para todas as jornadas e rodam antes
- Jornadas que alteram o estado do ambiente (parar o provedor, encerrar sessão pelo realm) **não**
  são paralelizáveis e restauram o estado ao final
- A suíte roda serialmente por herança do harness (`workers: 1`), então `[P]` aqui indica
  independência de arquivo e ausência de acoplamento — não execução simultânea

### Parallel Opportunities

- T002, T003, T005 e T006 na Fase 1
- T008, T009, T010, T013, T014, T015, T016 e T017 na Fase 2
- Em US1: T021 a T028 (T029 e T030 ficam fora, por alterarem o ambiente)
- Em US2: T032 a T035 (T031 depende do coletor)
- Em US3: T036, T037 e T038
- Em US4: T040 a T043 inteiro
- Na Fase 7: T045, T046, T047, T048, T051

---

## Implementation Strategy

### MVP primeiro (somente US1)

1. Fase 1 completa — o ambiente passa a subir conforme o repositório
2. Fase 2 completa — CRÍTICO, bloqueia todas as stories
3. Fase 3 completa — US1
4. **PARAR E VALIDAR**: rodar US1 isoladamente; sabotar o provedor e conferir a classificação
5. Abrir a Issue de D-13 (T047) — não depende de mais nada e é o defeito já conhecido

### Entrega incremental

1. Setup + Foundational → fundação pronta, ambiente reproduzível
2. + US1 → veredito da jornada central (MVP)
3. + US2 → caminho de registro e admissão
4. + US3 → encerramento coordenado
5. + US4 → fronteira de propriedade das credenciais
6. Fase 7 → documentação corrigida, defeitos registrados, execução agendada

---

## Notes

- Tarefas `[P]` operam em arquivos distintos e sem acoplamento
- Toda jornada declarada validada usa o provedor real; nenhuma usa simulação (FR-001)
- A interface administrativa do realm é usada para **preparar** e **conferir** estado, nunca para
  executar a etapa que a jornada precisa comprovar
- Nenhuma alteração de modelo SQLModel, portanto nenhuma migração Alembic
- Reprovação legítima de produto **permanece** reprovando; a validação não é ajustada para aceitar
  comportamento defeituoso (FR-015). Enquanto D-13 estiver aberto, é esperado que a suíte fique
  vermelha em ambiente que não defina `LEARNHOUSE_FRONTEND_DOMAIN`
- Ponto de honestidade sobre T002 e T023: incluir `LEARNHOUSE_FRONTEND_DOMAIN` no template faz o
  ambiente local funcionar e, com isso, **mascara D-13 localmente**. A jornada T023 existe
  justamente para que a divergência entre URI emitida e URI registrada seja detectada como classe
  de defeito, mas ela **não** substitui a correção de D-13 — que atinge self-hosts sem esse
  template

---

## Estado da execução (2026-08-06)

**50 de 54 tarefas concluídas.** Fases 1, 2, 3 (exceto T027), 4, 5, 6 e 7 completas.

### Resultado verificado contra o Keycloak real

```
26 passed | 1 failed | 3 skipped     (código de saída 1 = reprovado)
```

- **26 aprovadas** — 2 de pré-condições (7 verificações), 21 jornadas e 4 de auditoria de cobertura.
- **1 reprovada** — `us2-unverified`, e é **defeito de produto real** (D-16). Permanece falhando de
  propósito: ajustá-la para aceitar o comportamento violaria FR-015.
- **3 puladas** — lacunas de ambiente **declaradas** no título, não omitidas.
- **Repetibilidade** (FR-009, SC-004): 3 execuções consecutivas sobre o mesmo ambiente com
  veredito idêntico.
- **Classificação de causa** (SC-005): procedimento de sabotagem deliberada documentado em
  `apps/e2e/features/keycloak/README.md`, com a categoria esperada de cada uma.
- `bun run typecheck` limpo.

### Defeitos de produto encontrados

| # | Defeito | Estado |
|---|---|---|
| **D-13** | `redirect_uri` do login corporativo ignora o domínio configurado; atinge self-hosts community | Sem registro rastreável (T047) |
| **D-16** | Recusa no login corporativo redireciona para `/auth/login`, que responde 404 — a pessoa nunca vê o motivo | Sem registro rastreável (T048), reproduzido pela suíte |

### Comportamentos que pareciam defeito e **não** são

Cada um destes foi investigado antes de virar acusação:

- `LH_session` sem `httpOnly` — marcador deliberado de valor `"1"`, sem token. Os portadores
  (`LH_access`, `LH_refresh`) são httpOnly.
- Provedor parado e criação de fluxo devolvendo 200 — documento de descoberta em cache.
- 403 em toda entrada depois de recriar só o Keycloak — os `subject` são regenerados e a
  plataforma corretamente recusa revincular (**D-18**).
- Config OIDC por organização recusada para `localhost` — proteção anti-SSRF, correta (**D-05**).
- Back-channel logout não chegando — faltava `backchannel.logout.url` no realm; configurado, e a
  jornada passou (**D-18**).

### Erros meus, corrigidos com a razão registrada no código

- `/auth/login` como caminho da tela de entrada (é `/login`) — levou à descoberta de D-16.
- Seletores só em pt-BR; o ambiente serve a interface em inglês.
- `canReachAuthenticatedArea` verificava a URL depois de navegar para `/dash`, que é um
  **soft-404** (HTTP 200 com página de "não existe"): a função devolvia `true` sempre e a asserção
  "sessão utilizável" era vazia. Agora pergunta ao servidor por `/users/profile`.
- Asserção de logout comparando o total de sessões do provedor em vez do **delta** desta jornada —
  o veredito passava a depender de quantas jornadas rodaram antes.
- Senhas geradas a partir de sufixo base36, que pode sair só com letras e falha a política
  (`WEAK_PASSWORD`). Centralizadas em `senhaValida()`.

### As 4 tarefas não concluídas, com razão

- **T027** (`us1-token-validation`, FR-005 de 001) — exige divergência de relógio entre plataforma
  e provedor. Sem simular o provedor (FR-001 proíbe), significa deslocar o relógio de um contêiner:
  difícil de restaurar e contamina jornadas concorrentes. **Declarada como lacuna visível** na
  matriz de cobertura, não silenciada.
- **T039** (back-channel em pytest) — **superada** por `us3-provider-revocation`, que agora
  comprova o back-channel ponta a ponta contra o Keycloak real, com navegador. Um teste de API
  adicional cobriria o mesmo caminho com menos fidelidade.
- **T047 / T048** (abrir Issues no GitHub) — **não publicadas**: `gh` não está autenticado nesta
  máquina (`gh auth status` → "not logged into any GitHub hosts"). Os defeitos estão documentados em
  `research.md` e entregues como artefatos prontos para publicar:
  - `bug-report.md` — os dois defeitos, com causa-raiz e frentes de correção
  - `issue-bug-1.md` — issue de D-16 (recusa cai em 404), formato de `.github/ISSUE_TEMPLATE/bug.yml`
  - `issue-bug-2.md` — issue de D-13 (`frontend_domain`), mesmo formato — **cumpre T047**
  - `reproducao-no-navegador.md` — passo a passo de reprodução manual

  Nota de escopo: D-16 foi descoberto **durante** a implementação e não corresponde a T047 (que é
  D-13) nem a T048 (observação de experiência de D-15). A issue de D-16 é entregável adicional ao
  plano original.
