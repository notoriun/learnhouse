# Modelo de dados — criação automática de conta via Keycloak

**Feature**: `009-auto-provisionamento-keycloak` | **Data**: 2026-08-07

**Nenhuma entidade nova. Nenhuma coluna nova. Nenhuma migração Alembic.** Esta
feature altera política, contrato e derivação de valores sobre o modelo que a
feature 002 já entregou. Este documento existe para registrar quais estruturas são
tocadas, com que regra, e qual é a máquina de estados do primeiro acesso depois da
mudança.

## 1. Entidades reusadas

### `ExternalIdentity` — `apps/api/src/db/external_identities.py`

O vínculo durável entre a identidade do provedor e a conta local. Usada como está.

| Campo | Papel nesta feature |
|-------|--------------------|
| `issuer` + `subject` | **A chave da identidade.** `UniqueConstraint(issuer, subject)` é o que garante FR-003, FR-004 e FR-011 — inclusive a corrida, via `IntegrityError`. Nunca é e-mail. |
| `user_id` | Conta de destino. FK com `ON DELETE CASCADE`. |
| `organization_id` | Organização do fluxo no momento do vínculo. `ON DELETE SET NULL`. |
| `provider` | `"keycloak"` neste fluxo. |
| `email_at_link_time` | Somente auditoria. É o campo comparado para detectar troca de e-mail no provedor (FR-004) — nunca usado para localizar a identidade. |
| `last_login_at` | Atualizado em todo acesso reconhecido. |

Invariante que a feature depende: **uma identidade só é localizada por
`(issuer, subject)`**. Mudança de e-mail, nome ou nome de usuário no provedor não
afeta a localização.

### `User` — `apps/api/src/db/users.py`

A conta criada. Criada via `create_user(..., is_oauth=True, signup_provider="sso",
role_id=...)`, sem senha utilizável.

| Campo | Regra de derivação no provisionamento |
|-------|--------------------------------------|
| `username` | Base = parte antes do `@` de `preferred_username`, senão do `email`, senão o `subject`. **Novo**: verificado como livre antes da criação; em colisão, sufixo determinístico `-1`…`-5` e, esgotados, sufixo curto derivado do `subject`. Nunca o e-mail cru (a guarda anti-URL de `create_user` o rejeita). |
| `email` | `claims.email`. Pré-condição: verificado no provedor (FR-008). |
| `first_name` / `last_name` | `given_name` / `family_name`, quando presentes. Em acessos seguintes só preenchem campos **vazios** — edição feita pela própria pessoa nunca é sobrescrita. |
| senha | Vazia; a conta não nasce com credencial local utilizável. |

### `UserOrganization`

Membresia criada por `create_user` com `role_id` da política. Nesta feature o valor
efetivo é sempre `DEFAULT_MEMBER_ROLE_ID = 4` no caminho do provedor da plataforma
(`default_role_id=None` na política), e o papel configurado pela organização quando
há config de org — com a guarda já existente que ignora papéis administrativos.
É esta linha que amarra a conta à organização e sustenta FR-009 e SC-006.

### `OIDCProviderConfig`

Lida, nunca escrita por esta feature. `auto_provision_users` e
`allowed_email_domains` continuam sendo a fonte da política **quando a linha
existe**. O default `False` da coluna permanece — é justamente o que mantém IdP de
terceiro fail-closed (SC-008).

### `UpstreamSession`

Inalterada. Criada após o provisionamento, como hoje, e é o que sustenta o logout
coordenado da feature 003. Vale para conta recém-criada igualmente.

## 2. `ProvisioningPolicy` — valor derivado, não persistido

Dataclass congelada em `provisioning.py`. O que muda é **como ela é montada** no
router, não sua forma:

| Origem | `auto_provision` | `allow_link_by_email` | `allowed_email_domains` | `default_role_id` |
|--------|------------------|----------------------|------------------------|-------------------|
| Sem linha de config de org (provedor da plataforma) — **antes** | `False` | `True` | `[]` | `None` |
| Sem linha de config de org (provedor da plataforma) — **agora** | **`True`** | `True` | `[]` | `None` |
| Com linha de config de org — antes e agora | `auto_provision_users` | `auto_provision_users` | da organização | da organização, ignorado se administrativo |

Essa única célula é a mudança de política inteira. Os defaults da dataclass
continuam restritivos: quem instancia `ProvisioningPolicy()` sem argumentos segue
sem criar nem vincular nada.

## 3. Máquina de estados do primeiro acesso

Fluxo de `provision_federated_login` depois da mudança. Os passos são os mesmos da
feature 002; o que muda é que o passo 5 agora tem um caminho de saída viável no
provedor da plataforma, e que o passo 6 não falha mais por colisão de username.

```text
retorno do provedor, claims já validados criptograficamente
  │
  ├─1. localizar identidade por (issuer, subject)
  │     encontrada ──> conta bloqueada? ──sim──> DENIED usuario_desativado
  │                    └──não──> atualiza last_login_at, backfill de campos vazios
  │                              ──> SUCCESS outcome=login          [FR-004]
  │
  ├─2. e-mail verificado no provedor? ──não──> DENIED email_nao_verificado   [FR-008]
  │
  ├─3. domínio na lista permitida (lista vazia = sem restrição)?
  │     ──não──> DENIED dominio_nao_permitido                        [FR-008]
  │
  ├─4. existe conta local com esse e-mail?
  │     sim ──> mesma org do fluxo? ──não──> CONFLICT email_em_outra_organizacao
  │              └──sim──> allow_link_by_email? ──não──> CONFLICT email_conflito_politica
  │                          └──sim──> cria vínculo ──> SUCCESS outcome=linked   [FR-010]
  │
  ├─5. auto_provision ligado?
  │     não ──> DENIED auto_provision_desativado      [IdP de terceiro: SC-008]
  │     sim ──> segue                            [provedor da plataforma: FR-001/FR-002]
  │
  └─6. criar conta + vínculo
        │  username livre? senão sufixo -1..-5, senão sufixo do subject   [D3]
        │  papel = default da política ou 4 (menor privilégio)            [FR-009]
        ├─ IntegrityError (corrida perdida na constraint issuer+subject)
        │     ──> re-seleciona a identidade vencedora
        │         ──> SUCCESS outcome=login                               [FR-011]
        └─ ok ──> SUCCESS outcome=provisioned                             [FR-001]
```

Depois de qualquer `SUCCESS`, o router aplica a verificação de bloqueio de conta no
chokepoint (cobre os três desfechos), cria a sessão upstream e emite a sessão
interna — inalterado.

## 4. Regras de integridade que a feature preserva

1. **Nenhuma escrita parcial** (FR-012): recusa e conflito não gravam conta,
   vínculo nem membresia. `_conflict` registra auditoria com `user_id` nulo — um
   conflito nunca é atribuído à conta alheia.
2. **Uma conta por identidade** (FR-003, FR-004, SC-004): garantido pela constraint
   de banco, não por lógica de aplicação.
3. **Exatamente uma conta sob concorrência** (FR-011, SC-005): garantido pelo
   mesmo caminho de `IntegrityError`, que passa a ser exercitado de verdade agora
   que a criação está ligada.
4. **E-mail nunca é chave** (FR-004): a troca de e-mail no provedor é detectada e
   auditada (`email_changed`), mas não move a conta nem cria outra.
5. **Papel mínimo** (FR-009, SC-006): papéis administrativos são descartados na
   leitura da política; o caminho da plataforma sempre cai no papel 4.

## 5. Eventos de auditoria (`UserAuditEventType`)

Nenhum tipo novo. Os existentes passam a cobrir os desfechos desta feature, e são
o que os testes de FR-013/SC-007 verificam:

| Evento | Quando | Metadata relevante |
|--------|--------|--------------------|
| `SSO_PROVISIONED` | conta criada automaticamente | `issuer`, `subject`, `provider`, `email`, `role_id` |
| `SSO_LINKED` | identidade vinculada a conta existente | `issuer`, `subject`, `provider`, `email_at_link_time` |
| `LOGIN` | identidade já conhecida entrou | `method=sso`, `issuer`, `email_changed` quando aplicável |
| `SSO_LOGIN_DENIED` | recusa de admissão | `reason`, `issuer`, `subject`, `email_domain` quando aplicável |
| `SSO_CONFLICT` | conflito de identidade | `reason`, `issuer`, `subject`, `email` — `user_id` sempre nulo |
