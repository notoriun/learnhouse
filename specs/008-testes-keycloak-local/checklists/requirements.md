# Checklist de Qualidade da Especificação: Validação Ponta a Ponta do Login Corporativo (Keycloak)

**Purpose**: Validar completude e qualidade da especificação antes de seguir para o planejamento
**Created**: 2026-08-06
**Feature**: [spec.md](../spec.md)

## Qualidade do Conteúdo

- [x] Sem detalhes de implementação (linguagens, frameworks, APIs)
- [x] Focado em valor de usuário e necessidade de negócio
- [x] Escrito para partes interessadas não técnicas
- [x] Todas as seções obrigatórias completas

## Completude dos Requisitos

- [x] Nenhum marcador [NEEDS CLARIFICATION] permanece
- [x] Requisitos são testáveis e não ambíguos
- [x] Critérios de sucesso são mensuráveis
- [x] Critérios de sucesso são agnósticos de tecnologia
- [x] Todos os cenários de aceitação estão definidos
- [x] Casos de borda identificados
- [x] Escopo claramente delimitado
- [x] Dependências e premissas identificadas

## Prontidão da Feature

- [x] Todos os requisitos funcionais têm critério de aceitação claro
- [x] Cenários de usuário cobrem os fluxos primários
- [x] A feature atende aos resultados mensuráveis definidos em Critérios de Sucesso
- [x] Nenhum detalhe de implementação vaza para a especificação

## Notas

Duas decisões foram resolvidas por padrão informado a partir do contexto do repositório e
aguardam confirmação do solicitante — ambas afetam escopo, não a validade da especificação:

1. **FR-016 — amplitude da entrega**: resolvido como User Stories 1 a 4 (entrada, registro,
   encerramento de sessão, guardas de conta federada). US5 (administração da configuração) e US6
   (migração de contas) permanecem especificadas, mas fora desta entrega. Alterar esta decisão
   muda o tamanho da entrega, não os requisitos já escritos.
2. **FR-017 — onde executa**: resolvido como sob demanda no ambiente local *e* de forma agendada
   na automação do repositório, sem ser portão por pull request — seguindo o precedente da suíte
   de aceitação existente. A parte de automação carrega um risco técnico conhecido: o mecanismo de
   aceitação atual valida a imagem publicada e não conhece o provedor de identidade, o que precisa
   ser resolvido no planejamento.

Terceiro ponto de atenção para o planejamento, sem impacto na especificação: no ambiente local o
provedor de identidade ocupa a porta 8080, a mesma porta usada por padrão pela suíte de aceitação
existente para a aplicação. É conflito de configuração a tratar no plano.

---

## Atualização após a Fase 0 (2026-08-06)

O plano foi elaborado **executando** o ambiente. Os dois riscos técnicos acima **não se
confirmaram** e foram encerrados:

- *Harness incompatível* — resolvido por D-01: `E2E_BASE_URL`/`E2E_SKIP_BOOT` já fazem a suíte
  rodar contra instância que ela não subiu.
- *Conflito de porta 8080* — resolvido por D-02: `E2E_PORT` só compõe a URL quando a suíte boota a
  própria instância.

FR-016 e FR-017 foram mantidos como resolvidos, agora com razão técnica em vez de só priorização:
US5 está fora por bloqueio real (D-05, proteção anti-SSRF recusa `localhost`), não por escolha.

Achados novos que a Fase 0 trouxe e que **não** invalidam a especificação:

- **D-13** — defeito de produto real: a `redirect_uri` do login corporativo ignora o domínio
  configurado e sai como `localhost:3000`. Alcança também self-hosts da edição community.
- **D-14** — no ambiente local, US1 só fecha por vínculo por e-mail sobre conta local
  preexistente; é consequência correta de duas decisões de segurança, e é pré-condição não
  documentada.
- **D-06** — o caminho feliz de US2 precisa de coletor SMTP no compose, pois o realm não define
  `smtpServer`.
