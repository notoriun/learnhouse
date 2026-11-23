# Data Model: Identidade Externa, Linking e Provisionamento

**Feature**: `002-identidade-provisionamento` | **Date**: 2026-08-03

## 1. ExternalIdentity (nova tabela — `apps/api/src/db/external_identities.py`)

Convenções seguidas do repo: um arquivo por entidade em `apps/api/src/db/`; FKs com
`ondelete` explícito via `sa_column` (padrão de `user_organizations.py`); timestamps
`timestamptz` reais com `_utcnow()` (padrão de `user_audit_events.py`, deliberadamente NÃO o
padrão legado `str(datetime.now())` de `users.py`).

### Campos

| Campo | Tipo (SQLModel/PG) | Constraints | Regra |
|-------|--------------------|-------------|-------|
| `id` | `int` / serial | PK | Chave primária. |
| `user_id` | `int` | FK `user.id`, `ondelete="CASCADE"`, `nullable=False`, index | Usuário local dono da identidade. CASCADE: excluir o usuário remove seus vínculos (mesmo padrão de `UserOrganization.user_id`). |
| `organization_id` | `Optional[int]` | FK `organization.id`, `ondelete="SET NULL"`, `nullable=True`, index | Organização do fluxo de primeiro acesso, quando houve. SET NULL (não CASCADE): a identidade pertence à pessoa; org removida não pode apagar o vínculo (edge case da spec: org desativada → login negado, sem exclusão de dados). |
| `issuer` | `str` / `text` | `nullable=False` | Issuer normalizado (HTTPS, host minúsculo, sem barra final — ver `research.md` §2). |
| `subject` | `str` / `text` | `nullable=False` | Claim `sub`, imutável no issuer. |
| `provider` | `str` / `text` | `nullable=False`, default `"keycloak"` | `"keycloak"` ou `"oidc"` (documento-base §7.1). |
| `email_at_link_time` | `Optional[str]` / `text` | `nullable=True` | E-mail no momento do vínculo. **Somente auditoria** — nunca usado como chave, nunca atualizado depois (FR-002, FR-007). |
| `created_at` | `datetime` / `timestamptz` | `nullable=False`, default `_utcnow()` | Criação do vínculo. |
| `last_login_at` | `Optional[datetime]` / `timestamptz` | `nullable=True` | Último login por esta identidade; atualizado a cada acesso. |

### Constraints e índices (na migração Alembic, mesmo PR — Princípio III)

```python
__table_args__ = (
    UniqueConstraint("issuer", "subject", name="uq_externalidentity_issuer_subject"),
    Index("ix_externalidentity_user_id", "user_id"),
    Index("ix_externalidentity_organization_id", "organization_id"),
)
```

- **`uq_externalidentity_issuer_subject`**: a restrição obrigatória do documento-base §7.1 e
  FR-001. No banco, não em código — corrida entre logins concorrentes resolvida por
  `IntegrityError` (ver `research.md` §1 e §3).
- Índice em `user_id`: consulta "quais métodos de acesso este usuário tem" (tela de perfil /
  revisão administrativa futura).
- Índice em `organization_id`: consultas escopadas por org (Princípio IV).
- Sem índice adicional em `(issuer, subject)`: a unique constraint já cria o índice usado
  pelo lookup do passo 1 do fluxo.

### O que a migração altera além da tabela nova

- `user_audit_event.user_id` → `nullable=True` (eventos de negação/conflito ocorrem antes de
  existir usuário local — ver `research.md` §8). Nenhuma outra coluna muda; `downgrade`
  restaura `nullable=False` e dropa a tabela.

## 2. Política de Provisionamento (interface — armazenamento na config OIDC)

A política **vive na configuração OIDC por organização** (documento-base §7.2:
`allowed_email_domains`, `auto_provision_users`, `default_role_id`), cuja superfície
administrativa é a feature `004-admin-config-oidc`. Esta feature define e consome a
interface; o armazenamento é o registro de configuração OIDC criado pelas features 001/004.
Nota: a tabela órfã `ssoconnection` (migração `a1b2c3d4e5f6_add_sso_connection.py`, sem
modelo nem serviço) já tem colunas equivalentes e é a candidata a backing store — mas seu
`server_default` de `auto_provision_users` é TRUE e precisa ser invertido se reaproveitada
(`research.md` §4).

### Interface esperada (`apps/api/src/services/auth/provisioning.py`)

```python
@dataclass(frozen=True)
class ProvisioningPolicy:
    auto_provision: bool = False          # padrão restritivo (Assumptions da spec)
    allow_link_by_email: bool = False     # associação automática por e-mail: opt-in
    allowed_email_domains: list[str] = field(default_factory=list)  # vazia = sem restrição
    default_role_id: Optional[int] = None # None → papel padrão de menor privilégio
                                          # (role_id=4, o default atual de create_user;
                                          # NUNCA ADMIN_ROLE_ID=1 / MAINTAINER_ROLE_ID=2 —
                                          # ver src/security/rbac/constants.py e FR-006)

async def get_provisioning_policy(db_session, org_id: int) -> ProvisioningPolicy:
    """Lê a política da configuração OIDC da org; ausência de configuração
    retorna os defaults restritivos acima. Erro de leitura → defaults (nega
    provisionamento; fail-closed, ao contrário do fail-open de auth_policy.py,
    porque aqui a política cria contas, não restringe acesso já autorizado)."""
```

Regras de avaliação:

- Domínio: comparação case-insensitive do sufixo após `@`; lista vazia não restringe
  (restrição é opt-in; com `auto_provision=False` por padrão, nada é criado até configuração
  explícita).
- `default_role_id` deve referenciar `Role` da própria org
  (`Role.org_id == org_id`, `apps/api/src/db/roles.py`) e nunca um papel com privilégios
  elevados — validação na escrita (feature 004) E na leitura (aqui, defesa em profundidade).

## 3. Relacionamentos com os modelos existentes

```text
User (apps/api/src/db/users.py — inalterado)
 ├── 1:N ExternalIdentity.user_id          (novo)
 └── 1:N UserOrganization.user_id          (existente)

Organization (apps/api/src/db/organizations.py — inalterado)
 ├── 1:N ExternalIdentity.organization_id  (novo, nullable)
 ├── 1:N UserOrganization.org_id           (existente)
 └── 1:1 configuração OIDC / política      (features 001/004)

Role (apps/api/src/db/roles.py — inalterado)
 └── referenciado por ProvisioningPolicy.default_role_id
     e aplicado via UserOrganization.role_id (apps/api/src/db/user_organizations.py)
```

- A **Conta Local** (`User`) não muda de estrutura (Key Entity da spec): campos relevantes já
  existentes — `email_verified`, `signup_method` (recebe `"sso"`), `last_login_at`. Um
  usuário pode ter senha local vazia (`password: str = ""`, padrão OAuth já suportado).
- O vínculo org↔usuário continua sendo exclusivamente `UserOrganization` — a
  `ExternalIdentity` NÃO substitui membership; ela registra *como* a pessoa entra, não *onde*
  ela participa.
- Autorização permanece 100% em `UserOrganization.role_id` + RBAC interno (FR-008); nenhum
  campo desta feature alimenta permissões.

## 4. Regras de validação

1. `issuer + subject` únicos na plataforma (constraint de BD). E-mail NUNCA é chave (FR-001).
2. `ExternalIdentity` só é criada com claims validados criptograficamente (entrada do
   contrato — feature 001 já validou assinatura/iss/aud/nonce).
3. Vínculo por e-mail exige `email_verified == true` E `allow_link_by_email == true` (FR-004)
   E correspondência case-insensitive única de e-mail.
4. Papel atribuído no provisionamento = `default_role_id` da política ou o papel padrão de
   menor privilégio; jamais derivado de claims/grupos do provedor (FR-006; mapeamento de
   grupos está fora do escopo).
5. `email_at_link_time` é escrito uma única vez, na criação do vínculo; nunca atualizado.
6. Nenhum campo desta feature armazena tokens, códigos ou segredos.

## 5. Transições de estado — fluxo de primeiro acesso (FR-003)

Fluxograma textual (entrada: claims validados + organização do fluxo):

```text
[claims validados + org]
        │
        ▼
(1) LOCALIZAR: ExternalIdentity WHERE issuer+subject?
        │
        ├─ ENCONTRADA ──► usuário ativo?
        │       ├─ sim ──► ACESSO: last_login_at atualizado; backfill de perfil
        │       │          apenas em campos vazios; e-mail mudou no provedor?
        │       │          → só evento de auditoria, conta inalterada (FR-007)
        │       │          → sessão interna (amr="sso", sorg=org)
        │       └─ não ──► NEGADO (usuario_desativado) — sem recriar conta
        │
        └─ AUSENTE
                │
                ▼
(2) VERIFICAR: email_verified == true?
        ├─ não ──► NEGADO (email_nao_verificado) — nenhuma escrita
        └─ sim
                ▼
(3) VERIFICAR: domínio permitido pela política?
        ├─ não ──► NEGADO (dominio_nao_permitido) + auditoria
        └─ sim
                ▼
(4) Conta local com o mesmo e-mail (lower(email))?
        ├─ existe + allow_link_by_email + sem ambiguidade
        │        ──► VINCULAR: criar ExternalIdentity + garantir membership
        │            (idempotente, padrão signWithGoogle) → sessão
        ├─ existe + (política nega | outra org | identidade concorrente)
        │        ──► CONFLITO: interromper sem vínculo + auditoria
        │            para revisão administrativa (FR-005)
        └─ não existe
                ▼
(5) auto_provision ligado?
        ├─ não ──► NEGADO (auto_provision_desativado) — contas já criadas
        │          continuam entrando pelo ramo (1) (edge case da spec)
        └─ sim ──► PROVISIONAR: create_user(is_oauth=True, signup_provider="sso",
                   role_id=política) + criar ExternalIdentity
                   (IntegrityError na unique → corrida: re-selecionar e ir ao ramo (1))
                   → sessão + auditoria (sso_provisioned)
```

Estados terminais: **ACESSO** (sessão emitida), **NEGADO** (com motivo, sem sessão, sem
escrita de vínculo), **CONFLITO** (sem sessão, sem vínculo, registro durável para revisão).
Todos os terminais emitem auditoria conforme `contracts/provisioning.md`; nenhum contém
tokens.
