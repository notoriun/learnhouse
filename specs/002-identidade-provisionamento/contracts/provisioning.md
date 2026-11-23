# Contrato Interno: Serviço de Provisionamento e Linking

**Feature**: `002-identidade-provisionamento` | **Date**: 2026-08-03

Contrato **interno à API** (não é endpoint HTTP — Princípio I não é afetado: nenhum canal
novo entre apps). Consumidor: o callback OIDC server-side da feature
`001-fundacao-oidc-keycloak`, após validação criptográfica completa do ID token.
Implementação: `apps/api/src/services/auth/provisioning.py`.

## Entrada

```python
async def provision_federated_login(
    db_session: AsyncSession,
    request: Request,                 # só para contexto de auditoria (ip/user-agent)
    claims: FederatedClaims,          # claims JÁ VALIDADOS pela feature 001
    org: Organization,                # organização do fluxo (resolvida pelo callback)
) -> ProvisioningResult
```

```python
@dataclass(frozen=True)
class FederatedClaims:
    issuer: str                       # iss, já normalizado e conferido com a config
    subject: str                      # sub
    email: Optional[str]
    email_verified: bool              # ausente no token → False (nunca inferir True)
    given_name: Optional[str] = None
    family_name: Optional[str] = None
    preferred_username: Optional[str] = None
    provider: str = "keycloak"        # "keycloak" | "oidc"
```

Pré-condições (responsabilidade do chamador — feature 001):
- Assinatura, `iss`, `aud`/`azp`, `exp`/`nbf`/`iat` e `nonce` validados.
- `org` ativa e com login federado habilitado.
- NENHUM token upstream é passado a este serviço — ele não precisa e não deve vê-los.

## Saídas (`ProvisioningResult` — união fechada de três resultados)

### 1. Sessão criada — `ProvisioningSuccess`

```python
@dataclass(frozen=True)
class ProvisioningSuccess:
    user: User                        # conta local (existente, vinculada ou criada)
    external_identity: ExternalIdentity
    outcome: Literal["login", "provisioned", "linked"]
```

O chamador então emite a sessão pelo chokepoint existente:

```python
result = await issue_session_or_challenge(   # apps/api/src/services/auth/session.py
    db_session, success.user,
    amr=AUTH_METHOD_SSO,                     # "sso" — src/security/session_context.py
    org_id=org.id,
)
```

— o que dá de graça: gate de MFA local por construção, claims `amr`/`sorg` na sessão,
cookies `LH_access`/`LH_refresh` httpOnly via `set_auth_cookies`
(`apps/api/src/routers/auth.py`), rotação de refresh com jti e janela de graça (FR-009,
FR-010). Nota: MFA para SSO é governado pelo Keycloak (documento-base §17, "Duplo MFA") — a
decisão de pular o desafio local para `amr="sso"` pertence ao callback da feature 001, não a
este serviço.

### 2. Negado — `ProvisioningDenied`

```python
@dataclass(frozen=True)
class ProvisioningDenied:
    reason: Literal[
        "email_nao_verificado",       # FR-004 / US1-cenário 2
        "dominio_nao_permitido",      # US1-cenário 4
        "auto_provision_desativado",  # US1-cenário 3
        "usuario_desativado",         # edge case: conta local desativada/bloqueada
        "organizacao_inativa",        # edge case: org removida/desativada entre logins
    ]
    message_pt: str                   # orientação clara ao usuário, em português
```

Garantias: nenhuma conta criada, nenhum vínculo escrito, nenhuma sessão emitida.

### 3. Conflito para revisão administrativa — `ProvisioningConflict`

```python
@dataclass(frozen=True)
class ProvisioningConflict:
    reason: Literal[
        "email_em_outra_organizacao",     # e-mail coincide com conta fora da org do fluxo
        "email_conflito_politica",        # conta com o e-mail existe, política não permite vínculo
        "identidade_conflitante",         # usuário já tem identidade do mesmo issuer com outro subject
        "dados_inconsistentes",           # qualquer ambiguidade restante (FR-005: fail-closed)
    ]
    message_pt: str                   # "procure a administração" — sem vazar detalhe da conta alheia
```

Garantias: fluxo interrompido sem vínculo (FR-005); evento durável registrado para a revisão
administrativa (SC-004 — a tela é a feature 004; o registro nasce aqui). A mensagem ao
usuário NUNCA revela dados da conta conflitante (anti-enumeração, mesmo espírito de
`create_user`).

## Eventos de auditoria emitidos

Canal durável: `record_audit_event` (`apps/api/src/services/audit/audit.py`) →
tabela `user_audit_event` (`apps/api/src/db/user_audit_events.py`), com os novos tipos em
`UserAuditEventType`. Escrita em transação isolada, nunca quebra o fluxo do usuário.
**Proibido em qualquer campo: tokens, códigos de autorização, segredos** (FR-011; edge case
da spec). `user_id` é anulável para eventos anteriores à existência de conta.

| event_type | Quando | user_id | org_id | Campos em `audit_metadata` |
|------------|--------|---------|--------|----------------------------|
| `sso_provisioned` | Conta criada por provisionamento | novo usuário | org do fluxo | `issuer`, `subject`, `provider`, `email`, `role_id` |
| `sso_linked` | Identidade vinculada a conta pré-existente | usuário vinculado | org do fluxo | `issuer`, `subject`, `provider`, `email_at_link_time` |
| `sso_login_denied` | Qualquer `ProvisioningDenied` | NULL (ou usuário, se existir — ex.: `usuario_desativado`) | org do fluxo | `issuer`, `subject`, `reason`, `email_domain` (só o domínio, nas negações por domínio) |
| `sso_conflict` | Qualquer `ProvisioningConflict` | NULL (nunca atribuído à conta alheia) | org do fluxo | `issuer`, `subject`, `reason`, `email` (para a revisão administrativa localizar o caso) |
| `login` (existente) | Login federado bem-sucedido em identidade já vinculada | usuário | org do fluxo | `method: "sso"`, `issuer` — mesmo padrão do caminho Google (`utils.py:283-289`) |
| `login` + metadata `{"email_changed": true}` | E-mail mudou no provedor, mesma conta (FR-007) | usuário | org do fluxo | `issuer`, `subject` — registra o fato sem alterar a conta |

Eventos de **renovação** (FR-010/FR-011): permanecem no log estruturado já existente do
endpoint `/auth/refresh` (`auth.refresh outcome=ok|grace_reused|replay_detected|...`,
`apps/api/src/routers/auth.py:240-276`), que já registra replay negado em WARNING com
`user_id` e idade do token, sem nunca logar o token em si. Nenhum evento novo é necessário.

Campos de contexto (`ip`, `user_agent`) preenchidos via `extract_request_context(request)`
(`audit.py:24-41`), como nos eventos existentes.

## Invariantes do contrato

1. Idempotência de corrida: dois chamadores concorrentes com os mesmos claims terminam ambos
   em `ProvisioningSuccess` para a MESMA conta (a unique constraint resolve; o perdedor
   re-seleciona — `research.md` §3).
2. `ProvisioningDenied`/`ProvisioningConflict` nunca deixam escrita de vínculo parcial.
3. O serviço nunca recebe, armazena ou loga tokens do provedor.
4. Autorização de cursos/admin não é lida nem escrita aqui além do `role_id` de membership
   (FR-008).
