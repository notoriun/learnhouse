"""Provisionamento e vínculo de identidades federadas (feature 002).

Contrato interno (contracts/provisioning.md): consumido pelo callback OIDC
server-side da feature 001, com claims JÁ validados criptograficamente. Nenhum
token do provedor entra aqui. A identidade é chaveada por ``(issuer, subject)``,
nunca por e-mail.
"""

import hashlib
import logging
from dataclasses import dataclass, field
from typing import List, Literal, Optional, Union

from fastapi import Request
from sqlalchemy.exc import IntegrityError
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.external_identities import ExternalIdentity, _utcnow
from src.db.organizations import Organization
from src.db.user_audit_events import UserAuditEventType
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS
from src.services.audit.audit import extract_request_context, record_audit_event

logger = logging.getLogger(__name__)

# Papel padrão de menor privilégio quando a política não especifica (member).
DEFAULT_MEMBER_ROLE_ID = 4


@dataclass(frozen=True)
class FederatedClaims:
    issuer: str
    subject: str
    email: Optional[str] = None
    email_verified: bool = False
    given_name: Optional[str] = None
    family_name: Optional[str] = None
    preferred_username: Optional[str] = None
    provider: str = "keycloak"


@dataclass(frozen=True)
class ProvisioningPolicy:
    """Política de admissão da org. Defaults RESTRITIVOS (fail-closed): sem
    configuração, nada é criado nem vinculado automaticamente."""

    auto_provision: bool = False
    allow_link_by_email: bool = False
    allowed_email_domains: List[str] = field(default_factory=list)
    default_role_id: Optional[int] = None
    required_acr: Optional[str] = None


@dataclass(frozen=True)
class ProvisioningSuccess:
    user: User
    external_identity: ExternalIdentity
    outcome: Literal["login", "provisioned", "linked"]


@dataclass(frozen=True)
class ProvisioningDenied:
    reason: Literal[
        "email_nao_verificado",
        "dominio_nao_permitido",
        "auto_provision_desativado",
        "usuario_desativado",
        "organizacao_inativa",
    ]
    message_pt: str


@dataclass(frozen=True)
class ProvisioningConflict:
    reason: Literal[
        "email_em_outra_organizacao",
        "email_conflito_politica",
        "identidade_conflitante",
        "dados_inconsistentes",
    ]
    message_pt: str


ProvisioningResult = Union[ProvisioningSuccess, ProvisioningDenied, ProvisioningConflict]


async def get_provisioning_policy(
    db_session: AsyncSession, org_id: int
) -> ProvisioningPolicy:
    """Lê a política de provisionamento da org pela config OIDC (feature 004).

    Fail-closed: ausência de config ou erro de leitura → política restritiva.
    O ``default_role_id`` é ignorado (cai para o de menor privilégio) se
    referenciar papel privilegiado — defesa em profundidade sobre a validação
    já feita na feature 004.
    """
    try:
        from src.services.auth.oidc_config import get_active_oidc_config

        config = await get_active_oidc_config(db_session, org_id)
    except Exception:
        logger.warning("Provisionamento: leitura de política falhou; usando defaults restritivos")
        return ProvisioningPolicy()
    if config is None:
        return ProvisioningPolicy()

    role_id = config.default_role_id
    if role_id in ADMIN_OR_MAINTAINER_ROLE_IDS:
        role_id = None
    return ProvisioningPolicy(
        auto_provision=config.auto_provision_users,
        allow_link_by_email=config.auto_provision_users,
        allowed_email_domains=list(config.allowed_email_domains or []),
        default_role_id=role_id,
        required_acr=config.required_acr,
    )


def _domain_of(email: Optional[str]) -> Optional[str]:
    if not email or "@" not in email:
        return None
    return email.rsplit("@", 1)[1].strip().lower()


async def _audit(request, event_type, *, user_id=None, org_id=None, metadata=None):
    ip, ua = extract_request_context(request)
    await record_audit_event(
        event_type=event_type,
        user_id=user_id,
        org_id=org_id,
        ip=ip,
        user_agent=ua,
        metadata=metadata or {},
    )


async def _find_identity(db_session, issuer, subject):
    return (
        (
            await db_session.execute(
                select(ExternalIdentity).where(
                    ExternalIdentity.issuer == issuer,
                    ExternalIdentity.subject == subject,
                )
            )
        )
        .scalars()
        .first()
    )


async def provision_federated_login(
    db_session: AsyncSession,
    request: Optional[Request],
    claims: FederatedClaims,
    org: Organization,
    policy: Optional[ProvisioningPolicy] = None,
) -> ProvisioningResult:
    """Fluxograma de primeiro acesso (data-model.md §5): localizar → verificar
    → provisionar / vincular / negar / conflitar. Nenhum resultado negativo ou
    de conflito deixa escrita de vínculo parcial (invariante 2 do contrato)."""
    from src.services.security.account_lockout import check_account_locked

    if policy is None:
        policy = await get_provisioning_policy(db_session, org.id)

    org_meta = {"issuer": claims.issuer, "subject": claims.subject}

    # 1. LOCALIZAR pela identidade estável (issuer + subject) — nunca por e-mail.
    identity = await _find_identity(db_session, claims.issuer, claims.subject)
    if identity is not None:
        user = (
            await db_session.execute(select(User).where(User.id == identity.user_id))
        ).scalars().first()
        if user is None:
            return ProvisioningConflict(
                reason="dados_inconsistentes",
                message_pt="Não foi possível concluir o acesso. Contate a administração.",
            )
        locked, _ = check_account_locked(user)
        if locked:
            await _audit(
                request, UserAuditEventType.SSO_LOGIN_DENIED, user_id=user.id,
                org_id=org.id, metadata={**org_meta, "reason": "usuario_desativado"},
            )
            return ProvisioningDenied(
                reason="usuario_desativado",
                message_pt="Sua conta está bloqueada. Contate a administração da organização.",
            )
        # Reconhecida: login. Troca de e-mail no provedor NÃO altera a conta (FR-007).
        email_changed = bool(
            claims.email and identity.email_at_link_time
            and claims.email.lower() != (identity.email_at_link_time or "").lower()
        )
        identity.last_login_at = _utcnow()
        _backfill_profile(user, claims)
        db_session.add(identity)
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(identity)
        await db_session.refresh(user)
        meta = {"method": "sso", "issuer": claims.issuer}
        if email_changed:
            meta["email_changed"] = True
        await _audit(request, UserAuditEventType.LOGIN, user_id=user.id, org_id=org.id, metadata=meta)
        return ProvisioningSuccess(user=user, external_identity=identity, outcome="login")

    # 2. E-mail verificado é pré-condição para qualquer criação/vínculo (FR-004).
    if not claims.email_verified:
        await _audit(
            request, UserAuditEventType.SSO_LOGIN_DENIED, org_id=org.id,
            metadata={**org_meta, "reason": "email_nao_verificado"},
        )
        return ProvisioningDenied(
            reason="email_nao_verificado",
            message_pt="Seu e-mail não está verificado no provedor corporativo. "
                       "Verifique-o e tente novamente.",
        )

    # 3. Domínio permitido? Lista vazia = sem restrição de domínio.
    domain = _domain_of(claims.email)
    if policy.allowed_email_domains and domain not in [
        d.lower() for d in policy.allowed_email_domains
    ]:
        await _audit(
            request, UserAuditEventType.SSO_LOGIN_DENIED, org_id=org.id,
            metadata={**org_meta, "reason": "dominio_nao_permitido", "email_domain": domain},
        )
        return ProvisioningDenied(
            reason="dominio_nao_permitido",
            message_pt="Seu domínio de e-mail não é permitido nesta organização.",
        )

    # 4. Conta local com esse e-mail (verificado)? → vínculo ou conflito (US3).
    if claims.email:
        existing = (
            await db_session.execute(
                select(User).where(func.lower(User.email) == claims.email.lower())
            )
        ).scalars().first()
        if existing is not None:
            return await _link_or_conflict(
                db_session, request, claims, org, policy, existing, org_meta
            )

    # 5. Não existe conta → auto-provisionamento ligado? Não → negar.
    if not policy.auto_provision:
        await _audit(
            request, UserAuditEventType.SSO_LOGIN_DENIED, org_id=org.id,
            metadata={**org_meta, "reason": "auto_provision_desativado"},
        )
        return ProvisioningDenied(
            reason="auto_provision_desativado",
            message_pt="Sua conta ainda não existe nesta plataforma. "
                       "Contate a administração da sua organização.",
        )

    return await _create_and_link(db_session, request, claims, org, policy, org_meta)


def _backfill_profile(user: User, claims: FederatedClaims) -> None:
    """Preenche SOMENTE campos vazios do perfil — nunca sobrescreve edições
    do próprio usuário (research.md §7)."""
    if not user.first_name and claims.given_name:
        user.first_name = claims.given_name
    if not user.last_name and claims.family_name:
        user.last_name = claims.family_name


def _subject_suffix(subject: str) -> str:
    """Sufixo curto e ESTÁVEL para a mesma identidade.

    Determinístico de propósito: um sufixo aleatório tornaria o resultado
    irreprodutível em teste e mudaria o nome a cada tentativa de uma corrida.
    """
    return hashlib.sha256(subject.encode("utf-8")).hexdigest()[:8]


async def _username_disponivel(db_session, base: str, subject: str) -> str:
    """Primeiro nome de usuário livre a partir de ``base`` (feature 009).

    A consulta prévia é necessária porque ``create_user`` funde conflito de
    e-mail e de username num único 400 genérico — decisão deliberada de
    anti-enumeração num endpoint público — e o provisionamento não consegue
    distinguir os dois pela exceção. O caso de e-mail coincidente já foi
    resolvido antes, no passo de vínculo, então uma colisão aqui é de username.

    Sem isto, uma conta local homônima com OUTRO e-mail derrubava o acesso
    inteiro com ``dados_inconsistentes`` — erro interno, para o usuário final.
    """
    candidatos = [base]
    candidatos += [f"{base}-{i}" for i in range(1, 6)]
    candidatos.append(f"{base}-{_subject_suffix(subject)}")
    for candidato in candidatos:
        existe = (
            await db_session.execute(select(User).where(User.username == candidato))
        ).scalars().first()
        if existe is None:
            return candidato
    # Todos ocupados (inclusive o derivado do subject): devolve o último e deixa
    # o create_user decidir — o desfecho será conflito, como antes.
    return candidatos[-1]


async def _create_and_link(db_session, request, claims, org, policy, org_meta):
    from src.db.users import UserCreate
    from src.services.users.users import create_user

    role_id = policy.default_role_id or DEFAULT_MEMBER_ROLE_ID
    # Realm com e-mail-como-username (feature 007) manda o e-mail em
    # preferred_username; o username local é sempre a parte antes do "@" —
    # um e-mail cru seria rejeitado pelo guard anti-URL do create_user.
    base = (claims.preferred_username or claims.email or claims.subject).split("@")[0]
    if not base:
        base = f"sso-{_subject_suffix(claims.subject)}"
    username = await _username_disponivel(db_session, base, claims.subject)

    # org.id capturado ANTES de qualquer tentativa: o rollback do caminho de
    # nova tentativa expira os objetos da sessão, e ler ``org.id`` depois dispara
    # um lazy load fora do contexto async (MissingGreenlet).
    org_id = org.id

    async def _criar(nome: str):
        return await create_user(
            request,
            db_session,
            _AnonymousActor(),
            UserCreate(
                username=nome,
                first_name=claims.given_name or "",
                last_name=claims.family_name or "",
                email=claims.email,
                password="",
            ),
            org_id,
            is_oauth=True,
            signup_provider="sso",
            role_id=role_id,
        )

    try:
        user_read = await _criar(username)
    except Exception:
        # Uma corrida pode ter ocupado o nome entre a consulta e a inserção.
        # Uma única nova tentativa, com o sufixo estável do subject.
        alternativo = f"{base}-{_subject_suffix(claims.subject)}"
        if alternativo == username:
            logger.exception("Provisionamento: falha ao criar conta federada")
            return ProvisioningConflict(
                reason="dados_inconsistentes",
                message_pt="Não foi possível concluir o acesso. Contate a administração.",
            )
        try:
            await db_session.rollback()
            user_read = await _criar(alternativo)
        except Exception:
            logger.exception("Provisionamento: falha ao criar conta federada")
            return ProvisioningConflict(
                reason="dados_inconsistentes",
                message_pt="Não foi possível concluir o acesso. Contate a administração.",
            )
    user = (
        await db_session.execute(select(User).where(User.id == user_read.id))
    ).scalars().first()

    identity = ExternalIdentity(
        user_id=user.id,
        organization_id=org_id,
        issuer=claims.issuer,
        subject=claims.subject,
        provider=claims.provider,
        email_at_link_time=claims.email,
        last_login_at=_utcnow(),
    )
    db_session.add(identity)
    try:
        await db_session.commit()
    except IntegrityError:
        # Corrida perdida: outro request criou a mesma identidade. Re-seleciona
        # a vencedora e prossegue como login (invariante 1 do contrato).
        await db_session.rollback()
        identity = await _find_identity(db_session, claims.issuer, claims.subject)
        winner = (
            await db_session.execute(select(User).where(User.id == identity.user_id))
        ).scalars().first()
        return ProvisioningSuccess(user=winner, external_identity=identity, outcome="login")
    await db_session.refresh(identity)

    await _audit(
        request, UserAuditEventType.SSO_PROVISIONED, user_id=user.id, org_id=org_id,
        metadata={**org_meta, "provider": claims.provider, "email": claims.email, "role_id": role_id},
    )
    return ProvisioningSuccess(user=user, external_identity=identity, outcome="provisioned")


async def _link_or_conflict(db_session, request, claims, org, policy, existing, org_meta):
    """Passo 4: vincula identidade a conta pré-existente quando seguro; qualquer
    ambiguidade vira conflito para revisão administrativa (FR-005)."""
    # Usuário já tem identidade do mesmo issuer com OUTRO subject? Conflito.
    same_issuer = (
        await db_session.execute(
            select(ExternalIdentity).where(
                ExternalIdentity.user_id == existing.id,
                ExternalIdentity.issuer == claims.issuer,
            )
        )
    ).scalars().first()
    if same_issuer is not None and same_issuer.subject != claims.subject:
        return await _conflict(
            db_session, request, claims, org, org_meta, "identidade_conflitante"
        )

    # Conta pertence à org do fluxo? (o vínculo entre org e usuário é o membership)
    membership = (
        await db_session.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == existing.id,
                UserOrganization.org_id == org.id,
            )
        )
    ).scalars().first()
    if membership is None:
        # E-mail coincide com conta de outra organização — nunca vincula.
        return await _conflict(
            db_session, request, claims, org, org_meta, "email_em_outra_organizacao"
        )

    if not policy.allow_link_by_email:
        return await _conflict(
            db_session, request, claims, org, org_meta, "email_conflito_politica"
        )

    identity = ExternalIdentity(
        user_id=existing.id,
        organization_id=org.id,
        issuer=claims.issuer,
        subject=claims.subject,
        provider=claims.provider,
        email_at_link_time=claims.email,
        last_login_at=_utcnow(),
    )
    db_session.add(identity)
    try:
        await db_session.commit()
    except IntegrityError:
        await db_session.rollback()
        identity = await _find_identity(db_session, claims.issuer, claims.subject)
        winner = (
            await db_session.execute(select(User).where(User.id == identity.user_id))
        ).scalars().first()
        return ProvisioningSuccess(user=winner, external_identity=identity, outcome="login")
    await db_session.refresh(identity)

    await _audit(
        request, UserAuditEventType.SSO_LINKED, user_id=existing.id, org_id=org.id,
        metadata={**org_meta, "provider": claims.provider, "email_at_link_time": claims.email},
    )
    return ProvisioningSuccess(user=existing, external_identity=identity, outcome="linked")


async def _conflict(db_session, request, claims, org, org_meta, reason):
    messages = {
        "email_em_outra_organizacao": "Há um conflito com sua identidade. "
                                      "Contate a administração da organização.",
        "email_conflito_politica": "Não foi possível vincular sua identidade automaticamente. "
                                   "Contate a administração da organização.",
        "identidade_conflitante": "Há um conflito com sua identidade corporativa. "
                                  "Contate a administração da organização.",
        "dados_inconsistentes": "Não foi possível concluir o acesso. Contate a administração.",
    }
    # user_id NULL — nunca atribuído à conta alheia; e-mail no metadata para a
    # revisão administrativa localizar o caso (a tela é a feature 004).
    await _audit(
        request, UserAuditEventType.SSO_CONFLICT, org_id=org.id,
        metadata={**org_meta, "reason": reason, "email": claims.email},
    )
    return ProvisioningConflict(reason=reason, message_pt=messages[reason])


class _AnonymousActor:
    """Ator sistêmico para create_user no provisionamento (sem usuário
    autenticado). O rbac_check é bypassado no caminho federado (research.md §5)."""

    id = 0
    user_uuid = "user_system_sso"
    username = "system_sso"
