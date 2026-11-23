# Quickstart — Validação da Federação de Identidade (007)

Valida as três user stories ponta a ponta no ambiente docker local já montado
(`docker-compose.local.yml`: app + Keycloak com realm `dev` importado + sidecar
`keycloak-fwd` que torna o issuer `http://localhost:8080/realms/dev` coerente para navegador
e API).

## Pré-requisitos

```bash
docker compose -f docker-compose.local.yml up -d
curl -sf http://localhost/api/v1/health   # 200
```

> Atenção: ao recriar só o `learnhouse-app`, recrie também o sidecar
> (`docker compose -f docker-compose.local.yml up -d --force-recreate keycloak-fwd`) —
> ele compartilha o namespace de rede do app e fica órfão no container antigo
> (sintoma: authorize/discovery com `sso_indisponivel`).

- Realm `dev` com `registrationAllowed: true` e `registrationEmailAsUsername: true`
  (`docker/keycloak/realm-dev.json` — ajustado por esta feature).
- Org `default` com login corporativo ativo (config OIDC da org ou envs globais, como no
  ambiente atual).
- Para a migração: client `learnhouse-migration` no realm com service account +
  `manage-users` (criar via console admin `http://localhost:8080`, admin/admin).

## 1. Registro pelo provedor (US1 — SC-001)

1. Abrir `http://localhost/login` → deve existir "Criar conta pela identidade corporativa".
2. Clicar → tela de **registro** do Keycloak (URL contém `/registrations`).
3. Registrar usuária inédita (ex.: `nova@example.com`) → **esperado**: volta autenticada em
   `/home`; `externalidentity` tem 1 linha nova (issuer da plataforma + subject); auditoria
   registra o provisionamento (fluxo da feature 002, sem regra nova).
4. Negativo: desligar `registrationAllowed` no realm → o caminho de registro mostra a
   mensagem do provedor e nenhuma conta é criada no sistema.
5. Negativo: derrubar o Keycloak (`docker stop learnhouse-keycloak-local`) → mensagem clara
   de indisponibilidade em pt-BR, sem estado parcial. Religar depois.

## 2. Migração preservando a senha (US2 — SC-002/003/005)

```bash
cd apps/api
# Simulação (default) — relatório sem escrita
LEARNHOUSE_KC_MIGRATION_CLIENT_ID=learnhouse-migration \
LEARNHOUSE_KC_MIGRATION_CLIENT_SECRET=<segredo> \
uv run python scripts/migrate_users_to_keycloak.py

# Execução real
... migrate_users_to_keycloak.py --execute
```

- **Esperado**: relatório com `criados` ≥ 1 (ex.: conta local `admin@example.com`),
  `pulados` para contas sociais/sem senha, zero falhas.
- **Teste crítico do hash Argon2** (research §2): logout e login corporativo com a conta
  migrada usando a **senha antiga** → deve entrar direto (vínculo já existe, sem etapa de
  link). Se o Keycloak recusar a senha, o rollout usa `--reset-passwords` (FR-007) — validar
  esse modo também: conta criada com required action + e-mail.
- **Idempotência**: rodar `--execute` de novo → tudo em `pulados`, zero duplicatas no realm e
  na `externalidentity`.
- **Filtro**: `--org default` migra só membros da org `default`.

## 3. Bloqueios de conta federada (US3 — SC-004/006)

1. Logada com conta federada (migrada ou registrada), abrir a tela de segurança do perfil →
   troca de senha indisponível, com aviso e link "central de conta" apontando
   `http://localhost:8080/realms/dev/account`.
2. Via API (autoridade — contrato §3): tentar `PATCH .../password` e `PUT` mudando e-mail →
   `403 CONTA_FEDERADA` com `account_console_url`.
3. Alterar o e-mail da conta na account console do Keycloak → login corporativo seguinte →
   e-mail atualizado no sistema (comportamento da feature 002 preservado).
4. **Controle** (SC-006): conta local não federada troca senha e e-mail normalmente.

## 4. Suíte automatizada

```bash
cd apps/api && uv run pytest src/tests/routers/test_keycloak_auth_router.py \
  src/tests/services/test_federated_guards.py src/tests/scripts/test_migrate_users.py -q
cd apps/web && bun run typecheck
```

Critério de saída: os 4 blocos acima verdes; SC-001…SC-006 verificados.
