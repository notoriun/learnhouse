# Data Model — Federação de Identidade (007)

**Nenhuma mudança de schema.** A feature opera inteiramente sobre entidades existentes; esta
página documenta como cada uma é lida/escrita e as regras que a implementação deve respeitar.

## Entidades envolvidas

### User (existente — `apps/api/src/db/users.py`)

| Campo relevante | Uso nesta feature |
|---|---|
| `email` | Identificador único da conta no provedor (migração e vínculo). |
| `password` | Hash Argon2 (PHC) lido pela migração para importação; permanece intacto (login local segue até a org desligar o método — clarificação Q1). Contas com `password == ""` (OAuth/social) são **puladas** pela migração. |
| `email_verified` | Copiado para o provedor na migração (`emailVerified`). |
| `first_name`, `last_name`, `username` | Nome copiado ao provedor; `username` local permanece só como identidade de exibição (clarificação Q2) — **não** vira username do realm. |
| `signup_method` | Não é critério de federação (contas migradas nasceram como "email") — ver regra R3. |

**Escrita nesta feature**: nenhuma coluna nova, nenhum update de `user` pela migração.

### ExternalIdentity (existente — feature 002)

| Campo | Uso nesta feature |
|---|---|
| `user_id`, `organization_id` | Um vínculo por org de que o usuário é membro (migração itera memberships; respeita filtro `--org`). |
| `issuer` | Issuer global da plataforma (`get_keycloak_config().issuer`, normalizado sem `/` final). |
| `subject` | `id` do usuário criado/encontrado no provedor (UUID do Keycloak). |
| `provider` | `"keycloak"` (mesmo valor usado pelo login corporativo). |
| `email_at_link_time` | E-mail no momento da migração. |
| `last_login_at` | `NULL` na criação pela migração (preenchido no primeiro login real). |

**Unicidade**: `uq_externalidentity_issuer_subject` (existente) garante idempotência do
vínculo; a migração usa upsert tolerante a conflito (conta reprocessada → "pulada").

### Relatório de migração (efêmero — stdout/arquivo, não persistido)

| Campo | Descrição |
|---|---|
| `criados` | Contas criadas no provedor (com credencial importada ou required action no modo contingência). |
| `vinculados` | Contas que já existiam no provedor (e-mail encontrado) — apenas vínculo gravado. |
| `pulados` | Sem senha local (social), já migrados (vínculo existente), fora do filtro de org. |
| `falhas` | Por conta: e-mail + motivo; falha não interrompe as demais (FR-006). |

## Regras de negócio (validadas por teste)

- **R1 — Fonte da federação**: conta é "federada" ⇔ existe `ExternalIdentity` do usuário com
  `issuer` == issuer da plataforma. IdP de terceiros (feature 004) nunca satisfaz a regra
  (FR-010).
- **R2 — Bloqueios**: conta federada ⇒ `update_user_password` e mudança de `email` em
  `update_user` retornam erro estruturado `CONTA_FEDERADA` com `account_console_url`;
  demais campos de perfil seguem editáveis. Conta não federada ⇒ comportamento atual
  intocado (FR-008, SC-006).
- **R3 — Elegibilidade de migração**: `password != ""` e usuário membro de ao menos uma org
  do filtro. `signup_method` não entra na regra.
- **R4 — Idempotência**: reexecução não cria usuário nem vínculo duplicado (busca por e-mail
  no provedor + constraint de unicidade do vínculo) — SC-005.
- **R5 — Sem escrita runtime**: nenhum caminho web escreve no provedor; a única escrita é o
  script offline (FR-009). O registro federado cria a conta **no provedor**, e o LearnHouse
  só a materializa via admissão/JIT existente no callback (FR-002).

## Transições de estado

```text
Conta local (senha)  --migração-->  Federada (vínculo plataforma; senha local congelada)
Conta inexistente    --registro no provedor + callback/JIT-->  Federada (provisionada)
Federada             --login corporativo-->  Federada (last_login_at, e-mail sincronizado)
Federada             --org desliga método "password"-->  Federada SSO-only (estado final)
```
