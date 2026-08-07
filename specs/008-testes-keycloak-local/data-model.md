# Modelo de Dados (Fase 1): Validação Ponta a Ponta do Login Corporativo

**Feature**: `008-testes-keycloak-local` | **Data**: 2026-08-06

Nenhuma entidade persistida é criada. A feature não altera modelos SQLModel e não gera migração
Alembic — o Princípio III se aplica aqui apenas na exigência de testes, que é a própria entrega.

As entidades abaixo são estruturas **em memória, durante uma execução** da validação, derivadas
das Key Entities da especificação. Elas existem para dar forma ao relatório exigido por FR-005 a
FR-007 e à rastreabilidade de FR-014.

---

## PreCondicao

Fato que precisa ser verdadeiro antes de qualquer jornada rodar (FR-003, FR-004).

| Campo | Tipo | Regra |
|---|---|---|
| `id` | texto | Identificador estável, referenciado pelo relatório |
| `descricao` | texto | O que se verifica, em linguagem de quem opera |
| `categoriaDeFalha` | `indisponibilidade` \| `preparacao` | Fixa por pré-condição, conforme a tabela de D-08 |
| `instrucaoDeCorrecao` | texto | Obrigatória quando `categoriaDeFalha = preparacao` |
| `resultado` | `ok` \| `falhou` \| `nao_executada` | `nao_executada` quando uma anterior já barrou a execução |
| `observado` | texto | O que foi realmente encontrado; vazio quando `ok` |

**Regras de validação**:
- A fase de pré-condições é ordenada e para na primeira falha — as seguintes ficam
  `nao_executada`, e nenhuma jornada roda.
- Uma pré-condição com `categoriaDeFalha = preparacao` e `instrucaoDeCorrecao` vazia é erro de
  construção do módulo, não resultado de execução.

**Conjunto mínimo** (D-08): saúde da aplicação; documento de descoberta do realm; estado do login
corporativo reportado como ativo; encaminhamento interno alcança o provedor de dentro da
aplicação; realm contém clients e usuários de teste esperados; método SSO habilitado nos métodos
de entrada da organização.

---

## JornadaVerificada

Uma sequência de passos com desfecho esperado, ligada ao requisito que comprova.

| Campo | Tipo | Regra |
|---|---|---|
| `id` | texto | Único no módulo |
| `titulo` | texto | Deve conter o `requisitoDeOrigem` — é o que o relatório imprime (D-10) |
| `userStory` | `US1` \| `US2` \| `US3` \| `US4` | Amplitude de FR-016 |
| `requisitoDeOrigem` | lista de texto | Ao menos um, no formato `FR-00X (00Y-nome-da-feature)` |
| `usaProvedorReal` | booleano | DEVE ser verdadeiro em toda jornada declarada validada (FR-001) |
| `veredito` | `aprovado` \| `reprovado` \| `nao_executada` | — |
| `causa` | `defeito_produto` \| `preparacao` \| `indisponibilidade` \| nulo | Nulo quando `aprovado` |
| `etapaQueFalhou` | texto | Obrigatório quando `reprovado` (FR-006) |
| `esperado` / `observado` | texto | Ambos obrigatórios quando `reprovado` (FR-006) |

**Regras de validação**:
- `requisitoDeOrigem` vazio é jornada órfã e reprova SC-006 — verificável varrendo a matriz de
  cobertura contra os títulos.
- `usaProvedorReal = false` em jornada dentro da amplitude viola FR-001.
- `veredito = reprovado` com `etapaQueFalhou`, `esperado` ou `observado` vazio viola FR-006.

**Transições**: `nao_executada` → `aprovado` | `reprovado`. Não há reabertura dentro de uma
execução; repetição é execução nova.

---

## ExecucaoDeValidacao

Um disparo completo da validação.

| Campo | Tipo | Regra |
|---|---|---|
| `inicioEm` | instante | — |
| `ambienteAlvo` | texto | Endereço base da instância exercitada |
| `sufixoDaExecucao` | texto | Único por execução; prefixa todo dado criado (D-09) |
| `precondicoes` | lista de `PreCondicao` | — |
| `jornadas` | lista de `JornadaVerificada` | — |
| `vereditoAgregado` | `aprovado` \| `reprovado` | `aprovado` somente se toda pré-condição está `ok` e toda jornada está `aprovado` |

**Regras de validação**:
- `vereditoAgregado` DEVE se refletir em resultado distinguível automaticamente (FR-011).
- Nenhum campo pode conter senha, segredo de cliente, código de autorização ou token (FR-012).
- Duas execuções consecutivas sobre o mesmo ambiente DEVEM produzir o mesmo `veredito` por
  jornada (FR-009) — garantido por `sufixoDaExecucao` isolar os dados criados.

---

## CredencialDeTeste

Par identificador/segredo previsto pelo ambiente documentado.

| Campo | Tipo | Regra |
|---|---|---|
| `rotulo` | `verificado` \| `nao_verificado` | Situação que a credencial representa |
| `identificador` | texto | Origem única de configuração do módulo, nunca literal espalhado (D-07) |
| `segredo` | texto | Nunca aparece em relatório nem em registro de execução (FR-012) |
| `emailVerificado` | booleano | Deve casar com o realm; divergência é falha de pré-condição |

**Regra**: a credencial `nao_verificado` existe para comprovar recusa na admissão. Usá-la em
jornada que espera sucesso é erro de construção.

---

## IdentidadeEfemera

Usuário criado no provedor por uma execução, para jornadas que exigem "primeiro acesso" (D-09).

| Campo | Tipo | Regra |
|---|---|---|
| `email` | texto | Domínio de TLD comum — `.test`, `.example` e `.localhost` são rejeitados pelo validador da aplicação |
| `sufixo` | texto | Igual ao `sufixoDaExecucao` |
| `senha` | texto | Gerada na execução; nunca registrada |
| `criadaNoProvedor` | booleano | Falso até a criação ser confirmada pela interface do provedor |

**Regra**: nenhuma jornada de primeiro acesso reutiliza a credencial fixa `verificado`, porque
depois da primeira execução ela já não estaria no primeiro acesso — é a origem da
não-repetibilidade que FR-009 proíbe.

---

## DefeitoLevantado

Reprovação classificada como defeito de produto (FR-015, SC-007).

| Campo | Tipo | Regra |
|---|---|---|
| `jornadaId` | texto | Jornada que expôs |
| `requisitoViolado` | lista de texto | Herdado da jornada |
| `registroRastreavel` | texto | Referência da Issue; obrigatório (SC-007) |
| `situacao` | `aberto` \| `resolvido` | — |

**Regra**: um `DefeitoLevantado` sem `registroRastreavel` viola SC-007. A jornada
correspondente permanece reprovada até a correção — a validação não é ajustada para aceitar o
comportamento defeituoso (FR-015, D-11).
