# Módulo de validação: login corporativo (Keycloak)

Valida as jornadas de identidade corporativa contra um **Keycloak real**. Nenhuma jornada
declarada como validada usa provedor simulado.

## Executar

```bash
# na raiz do repositório
cp .env.local.example .env          # troque os segredos marcados
docker compose -f docker-compose.local.yml up -d --build
until curl -sf http://localhost/api/v1/health >/dev/null; do sleep 5; done

# aqui
cd apps/e2e
bun install && bunx playwright install chromium
E2E_BASE_URL=http://localhost \
E2E_ADMIN_EMAIL=admin@e2e-tests.com E2E_ADMIN_PASSWORD='<a senha do seu .env>' \
  bun run test:keycloak
```

Preparo completo do ambiente, com as lacunas da documentação oficial:
[`specs/008-testes-keycloak-local/quickstart.md`](../../../../specs/008-testes-keycloak-local/quickstart.md).

## Como ler o resultado

A execução tem duas fases. A primeira são **7 pré-condições de ambiente**; nenhuma jornada roda
se alguma reprovar. Toda reprovação é classificada:

| Categoria | Significado | O que fazer |
|---|---|---|
| `INDISPONIBILIDADE DE SERVIÇO` | Plataforma ou provedor não respondem | Subir/conferir os contêineres |
| `PREPARAÇÃO DE AMBIENTE` | Serviços de pé, mas o ambiente não está montado | Seguir a instrução de correção que a própria falha imprime |
| `DEFEITO DE PRODUTO` | Ambiente OK, jornada falhou | É bug: registrar, **não** ajustar o teste |

Essa distinção é o ponto do módulo. Sem ela, uma suíte vermelha não diz se o produto quebrou ou
se o ambiente não subiu.

## Repetibilidade

Duas execuções consecutivas sobre o mesmo ambiente devem dar veredito idêntico por jornada, sem
recriar dados. Para conferir:

```bash
for i in 1 2 3; do
  E2E_BASE_URL=http://localhost E2E_ADMIN_EMAIL=admin@e2e-tests.com \
  E2E_ADMIN_PASSWORD='<senha>' bun run test:keycloak 2>&1 | tail -3
done
```

As três saídas devem ter a mesma contagem de aprovadas, reprovadas e puladas. O isolamento vem do
sufixo único por execução (`fixtures.ts`): jornadas de primeiro acesso criam identidade nova no
provedor em vez de reutilizar a credencial fixa — que, depois da primeira execução, já não estaria
no primeiro acesso.

## Conferir a classificação de causa (sabotagem deliberada)

O módulo só vale se classificar corretamente. Cada linha abaixo deve produzir a categoria
indicada:

| Sabotagem | Categoria esperada |
|---|---|
| `docker compose -f docker-compose.local.yml stop keycloak` | `INDISPONIBILIDADE DE SERVIÇO` na pré-condição `provider-discovery` |
| `docker compose -f docker-compose.local.yml stop mailpit` | `PREPARAÇÃO DE AMBIENTE` na pré-condição `mailbox-reachable` |
| `docker rm -f learnhouse-keycloak-fwd-local` | `PREPARAÇÃO DE AMBIENTE` na pré-condição `internal-forwarding` — e **não** indisponibilidade, que é o disfarce clássico desse defeito |
| Desligar `LEARNHOUSE_KEYCLOAK_ENABLED` e recriar o app | `PREPARAÇÃO DE AMBIENTE` na pré-condição `sso-enabled` |

Restaure com `docker compose -f docker-compose.local.yml up -d` depois de cada uma.

## Veredito automático

O processo encerra com código de saída **0** para aprovado e **diferente de 0** para reprovado —
é o que permite encadear em automação. O workflow
[`keycloak-validation.yaml`](../../../../.github/workflows/keycloak-validation.yaml) usa
exatamente isso, sob demanda e semanalmente, sem ser portão de pull request.

## Estrutura

| Arquivo | Papel |
|---|---|
| `config.ts` | Origem única de credenciais, endereços e nomes de client |
| `provider.ts` | Interface administrativa do realm — **prepara e confere**, nunca executa a etapa que a jornada comprova |
| `pages/provider.ts` | Telas do provedor, dirigidas pelo navegador — é aqui que a autenticação real acontece |
| `mailbox.ts` | Leitura do coletor SMTP, para a verificação de e-mail |
| `api.ts` / `session-request.ts` | Leitura de estado pela API; a segunda usa os cookies do navegador |
| `preconditions.ts` | As 7 pré-condições e a classificação de causa |
| `coverage.ts` | Matriz requisito → jornada, e as lacunas declaradas |
| `reporter.ts` | Relatório com veredito e saneamento de segredos |
| `verify.ts` | Asserções compartilhadas de estado de sessão |

## Lacunas declaradas

Aparecem na saída da execução com `[LACUNA DECLARADA]` e como testes pulados com a razão no
título. São cobertura que **não existe**, dita em voz alta em vez de omitida:

- **`us1-token-validation`** (FR-005 de 001) — exige divergência de relógio entre plataforma e
  provedor.
- **`us2-register-provisionamento`** — provisionar conta nova exige `auto_provision`, que exige
  configuração OIDC por organização, que a proteção anti-SSRF recusa para issuer em loopback.
- **`us2-register-not-platform-idp-terceiro`** — exige provedor por organização que não seja o da
  plataforma; mesmo bloqueio.
- **`us2-identity-conflict-outra-org`** — exige duas organizações; o ambiente local sobe com uma.

## Defeitos de produto conhecidos e abertos

A suíte fica **vermelha de propósito** enquanto existirem. Ajustá-la para aceitá-los violaria
FR-015 da especificação.

- **`us2-unverified`** — a recusa no login corporativo redireciona para `/auth/login`, que
  responde 404, e a pessoa nunca vê o motivo. O caminho servido é `/login`.
