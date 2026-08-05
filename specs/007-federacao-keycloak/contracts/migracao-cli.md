# Contrato — Script de Migração `migrate_users_to_keycloak.py` (007)

## Invocação

```bash
cd apps/api
uv run python scripts/migrate_users_to_keycloak.py [FLAGS]
```

| Flag | Default | Efeito |
|---|---|---|
| *(nenhuma)* | — | **Simulação** (`--dry-run` implícito): relatório do que aconteceria, zero escrita (FR-006). |
| `--execute` | off | Executa de verdade (cria usuários/vínculos). |
| `--org <slug>` | todas | Filtro por organização; repetível (`--org a --org b`) — clarificação Q4. |
| `--reset-passwords` | off | Modo contingência (FR-007): cria sem credencial + required action UPDATE_PASSWORD + e-mail de redefinição. |

## Ambiente exigido (só na execução)

| Variável | Uso |
|---|---|
| `LEARNHOUSE_KEYCLOAK_ISSUER` | Issuer do realm da plataforma (já existente na config). |
| `LEARNHOUSE_KC_MIGRATION_CLIENT_ID` / `_SECRET` | Client dedicado com service account + `manage-users` (research §3). Nunca configurado no runtime web. |

## Comportamento por conta elegível (R3 do data-model)

1. Busca no provedor por e-mail (identificador único — clarificação Q2).
2. **Não existe** → cria usuário (`email`, `emailVerified`, nome) com credencial Argon2
   importada (research §2) — ou required action no modo `--reset-passwords` → **criado**.
3. **Já existe** (criado pelo outro sistema) → não cria, não altera credencial → **vinculado**.
4. Grava `ExternalIdentity` (issuer plataforma + subject) para cada org do usuário dentro do
   filtro; conflito de unicidade → já migrado → **pulado**.
5. Erro de rede/API na conta → registra em **falhas** (e-mail + motivo) e **continua** (FR-006).

## Saída e códigos de retorno

- Relatório final em stdout (pt-BR): totais de `criados`, `vinculados`, `pulados`, `falhas` +
  lista de falhas com motivo (formato do data-model).
- Exit `0`: execução completa sem falhas; Exit `1`: completou com falhas por conta (relatório
  indica quais); Exit `2`: erro fatal antes de iniciar (credencial/conexão/flags inválidas).

## Garantias

- **Idempotência** (SC-005): reexecução → zero duplicatas, zero alterações em contas já
  migradas (busca por e-mail + constraint `uq_externalidentity_issuer_subject`).
- **Interrupção no meio**: reexecutar completa o restante (estado por conta, sem lote
  transacional global).
- Senhas: hash nunca logado; nenhum valor de credencial aparece no relatório.
