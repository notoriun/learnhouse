"""Login corporativo via Keycloak (OIDC Authorization Code + PKCE S256).

Endpoints consumidos exclusivamente pelo BFF do Next.js, server-to-server
(contracts/api-oidc.md da feature 001). Nenhuma resposta ou log contém
authorization code, tokens do provedor, code_verifier ou client_secret — o
claim/passo que falhou vira uma *categoria* nos logs, nunca o valor.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.external_identities import ExternalIdentity
from src.db.organizations import Organization
from src.db.upstream_sessions import (
    REASON_BACKCHANNEL,
    REASON_USER_LOGOUT,
    STATUS_ACTIVE,
    UpstreamSession,
)
from src.db.user_audit_events import UserAuditEventType
from src.db.users import User, UserRead
from src.security.auth import (
    decode_jwt,
    extract_jwt_from_request,
    revoke_user_sessions_before,
)
from src.security.session_context import AUTH_METHOD_SSO, USID_CLAIM
from src.services.audit.audit import record_audit_event
from src.services.auth import keycloak_oidc as oidc
from src.services.auth import upstream_session as upstream
from src.services.auth.session import mint_session_tokens
from src.services.orgs.auth_policy import is_login_method_allowed
from src.services.users.users import security_get_user

backchannel_logger = logging.getLogger("learnhouse.auth.backchannel")

logger = logging.getLogger(__name__)

router = APIRouter()


class AuthorizeRequest(BaseModel):
    org_slug: str
    redirect_to: Optional[str] = None


class CallbackRequest(BaseModel):
    code: str
    state: str


def _erro(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"code": code, "message": message}
    )


def _log_outcome(stage: str, outcome: str, org_slug: Optional[str] = None) -> None:
    """Trilha operacional de auditoria do fluxo (FR-010) — somente categorias.

    Eventos duráveis (``user_audit_event``) exigem usuário conhecido; falhas
    pré-autenticação (state inválido, token rejeitado, conta inexistente) ficam
    neste log estruturado, sem code, tokens, verifier ou segredos.
    """
    logger.info(
        "keycloak_auth stage=%s outcome=%s org=%s", stage, outcome, org_slug or "-"
    )


ERRO_SSO_NAO_CONFIGURADO = (
    status.HTTP_404_NOT_FOUND,
    "SSO_NAO_CONFIGURADO",
    "O login corporativo não está disponível para esta organização.",
)
ERRO_SSO_INDISPONIVEL = (
    status.HTTP_503_SERVICE_UNAVAILABLE,
    "SSO_INDISPONIVEL",
    "O login corporativo está temporariamente indisponível. Tente novamente em instantes.",
)
ERRO_FLUXO_INVALIDO = (
    status.HTTP_410_GONE,
    "FLUXO_INVALIDO",
    "A sessão de login expirou ou já foi utilizada. Inicie o login novamente.",
)
ERRO_CODIGO_RECUSADO = (
    status.HTTP_401_UNAUTHORIZED,
    "CODIGO_RECUSADO",
    "Não foi possível concluir o login corporativo. Inicie o login novamente.",
)
ERRO_TOKEN_INVALIDO = (
    status.HTTP_401_UNAUTHORIZED,
    "TOKEN_INVALIDO",
    "Não foi possível validar sua identidade corporativa. Inicie o login novamente.",
)
ERRO_CONTA_NAO_ENCONTRADA = (
    status.HTTP_403_FORBIDDEN,
    "CONTA_NAO_ENCONTRADA",
    "Sua identidade corporativa foi validada, mas não há uma conta correspondente "
    "nesta plataforma. Contate a administração da sua organização.",
)
ERRO_METODO_NAO_PERMITIDO = (
    status.HTTP_403_FORBIDDEN,
    "METODO_NAO_PERMITIDO",
    "Esta organização não permite login com identidade corporativa.",
)


async def _resolve_org(db_session: AsyncSession, org_slug: str) -> Optional[Organization]:
    return (
        (
            await db_session.execute(
                select(Organization).where(Organization.slug == org_slug)
            )
        )
        .scalars()
        .first()
    )


def _config_ativa() -> bool:
    config = oidc.get_keycloak_config()
    return bool(config.enabled and config.issuer and config.client_id)


@router.get(
    "/status",
    summary="Disponibilidade do login corporativo para uma organização",
    description=(
        "Indica se o botão 'Entrar com identidade corporativa' deve aparecer na "
        "página de login da organização. Público; nunca enumera organizações."
    ),
)
async def keycloak_status(
    org: str,
    db_session: AsyncSession = Depends(get_db_session),
):
    if not _config_ativa():
        return {"enabled": False}
    organization = await _resolve_org(db_session, org)
    if organization is None:
        # Org desconhecida responde igual a org sem SSO — sem enumeração.
        return {"enabled": False}
    allowed = await is_login_method_allowed(
        db_session, organization.id, AUTH_METHOD_SSO
    )
    return {"enabled": bool(allowed)}


@router.post(
    "/authorize",
    summary="Cria o fluxo OIDC e monta a URL de autorização",
    description=(
        "Gera state/nonce/verifier de uso único (Redis, TTL curto) e devolve a "
        "authorization_url do Keycloak. Chamado apenas pelo BFF."
    ),
)
async def keycloak_authorize(
    body: AuthorizeRequest,
    db_session: AsyncSession = Depends(get_db_session),
):
    if not _config_ativa():
        _log_outcome("authorize", "not_configured", body.org_slug)
        raise _erro(*ERRO_SSO_NAO_CONFIGURADO)
    organization = await _resolve_org(db_session, body.org_slug)
    if organization is None:
        _log_outcome("authorize", "unknown_org")
        raise _erro(*ERRO_SSO_NAO_CONFIGURADO)
    if not await is_login_method_allowed(db_session, organization.id, AUTH_METHOD_SSO):
        _log_outcome("authorize", "method_not_allowed", body.org_slug)
        raise _erro(*ERRO_SSO_NAO_CONFIGURADO)

    config = oidc.get_keycloak_config()
    try:
        discovery = oidc.get_discovery(config.issuer)
        flow = oidc.create_flow(body.org_slug, body.redirect_to)
    except oidc.ProviderUnavailableError as exc:
        _log_outcome("authorize", f"unavailable:{exc.category}", body.org_slug)
        raise _erro(*ERRO_SSO_INDISPONIVEL)

    authorization_url = oidc.build_authorization_url(
        discovery, flow["state"], flow["nonce"], flow["code_challenge"]
    )
    _log_outcome("authorize", "flow_created", body.org_slug)
    return {"authorization_url": authorization_url, "state": flow["state"]}


@router.post(
    "/callback",
    summary="Consome o fluxo, valida o ID token e emite a sessão interna",
    description=(
        "Ordem obrigatória do contrato: state (uso único) → troca do código → "
        "validação integral do ID token → resolução do usuário → política da "
        "org → sessão interna. Tokens retornados são os internos da plataforma; "
        "tokens do provedor nunca aparecem na resposta."
    ),
)
async def keycloak_callback(
    body: CallbackRequest,
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
):
    # 1. Uso único do state (GETDEL) — replay/expirado/desconhecido → 410.
    try:
        flow = oidc.consume_flow(body.state)
    except oidc.ProviderUnavailableError as exc:
        _log_outcome("callback", f"unavailable:{exc.category}")
        raise _erro(*ERRO_SSO_INDISPONIVEL)
    if flow is None:
        _log_outcome("callback", "invalid_state")
        raise _erro(*ERRO_FLUXO_INVALIDO)
    org_slug = flow.get("org_slug")
    _log_outcome("callback", "received", org_slug)

    # 2. Troca do código (client confidencial + PKCE).
    try:
        provider_tokens = oidc.exchange_code(body.code, flow["code_verifier"])
    except oidc.CodeExchangeError:
        _log_outcome("callback", "code_rejected", org_slug)
        raise _erro(*ERRO_CODIGO_RECUSADO)
    except oidc.ProviderUnavailableError as exc:
        _log_outcome("callback", f"unavailable:{exc.category}", org_slug)
        raise _erro(*ERRO_SSO_INDISPONIVEL)

    # 3. Validação integral do ID token.
    try:
        claims = oidc.validate_id_token(provider_tokens["id_token"], flow["nonce"])
    except oidc.TokenValidationError as exc:
        _log_outcome("callback", f"token_invalid:{exc.category}", org_slug)
        raise _erro(*ERRO_TOKEN_INVALIDO)
    except oidc.ProviderUnavailableError as exc:
        _log_outcome("callback", f"unavailable:{exc.category}", org_slug)
        raise _erro(*ERRO_SSO_INDISPONIVEL)

    # 4. Resolução interina do usuário (research §6): e-mail verificado no
    # provedor → conta local existente; sem auto-provisionamento (feature 002).
    email = claims.get("email")
    if not email or claims.get("email_verified") is not True:
        _log_outcome("callback", "email_unverified", org_slug)
        raise _erro(*ERRO_CONTA_NAO_ENCONTRADA)
    user = (
        (await db_session.execute(select(User).where(User.email == email.lower())))
        .scalars()
        .first()
    )
    if user is None:
        _log_outcome("callback", "user_not_found", org_slug)
        raise _erro(*ERRO_CONTA_NAO_ENCONTRADA)

    # 5. Política de métodos da org (multi-tenant — Princípio IV).
    organization = await _resolve_org(db_session, org_slug or "")
    org_id = organization.id if organization else None
    if not await is_login_method_allowed(db_session, org_id, AUTH_METHOD_SSO):
        _log_outcome("callback", "method_not_allowed", org_slug)
        raise _erro(*ERRO_METODO_NAO_PERMITIDO)

    # 6. Vínculo com a sessão upstream (feature 003): cria a upstream_session
    # (issuer, sid do ID token, refresh upstream + ID token cifrados) e estampa
    # o claim usid nos tokens locais. Sessões sem usid seguem tratadas como
    # nativas — a fronteira 001/002 → 003.
    from src.services.auth import upstream_session as upstream

    session_uuid = upstream.new_session_uuid()
    try:
        await upstream.create_upstream_session(
            db_session,
            session_uuid=session_uuid,
            user_id=user.id,
            issuer=oidc.get_keycloak_config().issuer,
            sid=claims.get("sid"),
            org_id=org_id,
            upstream_refresh_token=provider_tokens.get("refresh_token"),
            id_token=provider_tokens.get("id_token"),
        )
    except Exception:
        # A sessão upstream é a base do logout coordenado; se falhar, o login
        # não deve prosseguir sem ela (fail closed para não deixar sessão órfã).
        logger.exception("Keycloak: falha ao criar upstream_session")
        raise _erro(*ERRO_SSO_INDISPONIVEL)

    # Sessão interna reusada (chokepoint mint_session_tokens) — sem desafio de
    # MFA local: MFA é responsabilidade do Keycloak (sem duplo MFA).
    issue = mint_session_tokens(
        user.email, amr=AUTH_METHOD_SSO, org_id=org_id, usid=session_uuid
    )

    _log_outcome("callback", "success", org_slug)
    await record_audit_event(
        event_type=UserAuditEventType.LOGIN,
        user_id=user.id,
        org_id=org_id,
        user_agent=request.headers.get("user-agent"),
        metadata={"method": "sso", "provider": "keycloak"},
    )

    from src.routers.auth import get_token_expiry_ms

    return {
        "user": UserRead.model_validate(user),
        "tokens": {
            "access_token": issue.access_token,
            "refresh_token": issue.refresh_token,
            "expiry": get_token_expiry_ms(),
        },
        "redirect_to": oidc.sanitize_redirect(flow.get("redirect_to")),
    }


def _post_logout_redirect_uri() -> str:
    """Destino de retorno pós-logout — cadastrado, nunca derivado de entrada
    do usuário (contracts/logout.md §2.1)."""
    from config.config import get_learnhouse_config

    hosting = get_learnhouse_config().hosting_config
    scheme = "https" if hosting.ssl else "http"
    return f"{scheme}://{hosting.frontend_domain}/"


@router.post(
    "/logout",
    summary="Logout coordenado (RP-Initiated) da sessão federada",
    description=(
        "Revoga a sessão local e a sessão upstream, e devolve a URL de "
        "encerramento de sessão do provedor. Logout sempre é concluível — "
        "responde 200 mesmo sem sessão válida."
    ),
)
async def keycloak_logout(
    request: Request,
    response: Response,
    db_session: AsyncSession = Depends(get_db_session),
):
    response.headers["Cache-Control"] = "no-store"
    token = extract_jwt_from_request(request)
    payload = decode_jwt(token) if token else None

    end_session_url = None
    session_uuid = None
    if payload and payload.get("sub"):
        # 1. Revogação ANTES de qualquer redirecionamento (FR-001).
        try:
            user = await security_get_user(request, db_session, email=payload["sub"])
        except Exception:
            user = None
        if user is not None and user.id is not None:
            revoke_user_sessions_before(user.id)  # blocklist por usuário

        session_uuid = payload.get(USID_CLAIM)
        if session_uuid:
            row = await upstream.get_by_uuid(db_session, session_uuid)
            if row is not None and row.status == STATUS_ACTIVE:
                id_token = upstream.decrypt(row.id_token_encrypted)
                await upstream.revoke(db_session, row, REASON_USER_LOGOUT)
                end_session_url = oidc.build_end_session_url(
                    id_token, _post_logout_redirect_uri()
                )
            elif row is not None:
                # Já terminal: ainda oferece o end_session (fallback client_id).
                end_session_url = oidc.build_end_session_url(
                    None, _post_logout_redirect_uri()
                )

        if user is not None and user.id is not None:
            await record_audit_event(
                event_type=UserAuditEventType.LOGOUT,
                user_id=user.id,
                user_agent=request.headers.get("user-agent"),
                metadata={
                    "method": "rp_initiated",
                    "sso_terminated": bool(end_session_url),
                },
            )

    return {"end_session_url": end_session_url}


@router.post(
    "/backchannel-logout",
    summary="Back-channel logout (notificação servidor-servidor do provedor)",
    description=(
        "Recebe e valida o logout token do provedor e revoga as sessões locais "
        "associadas. Idempotente. Corpo application/x-www-form-urlencoded."
    ),
)
async def keycloak_backchannel_logout(
    response: Response,
    logout_token: str = Form(...),
    db_session: AsyncSession = Depends(get_db_session),
):
    response.headers["Cache-Control"] = "no-store"
    # Validação criptográfica integral — caminho de segurança (Princípio IV).
    try:
        claims = oidc.validate_logout_token(logout_token)
    except oidc.TokenValidationError as exc:
        backchannel_logger.warning("backchannel outcome=rejected_claims cat=%s", exc.category)
        # Corpo vazio, sem detalhe — efeito zero sobre sessões (SC-005).
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="")
    except oidc.ProviderUnavailableError:
        backchannel_logger.warning("backchannel outcome=rejected_signature")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="")

    issuer = oidc.get_keycloak_config().issuer
    sid = claims.get("sid")
    subject = claims.get("sub")

    # Telemetria de replay (não bloqueia — idempotência já cobre o efeito).
    jti = claims.get("jti")
    if jti:
        r = upstream._redis()
        if r is not None:
            try:
                if not r.set(f"backchannel_jti:{jti}", "1", nx=True, ex=600):
                    backchannel_logger.info("backchannel outcome=replayed")
            except Exception:
                pass

    affected = 0
    if sid:
        affected = await upstream.revoke_by_issuer_sid(
            db_session, issuer, sid, REASON_BACKCHANNEL
        )
    if subject and affected == 0:
        # Sem sid (ou nenhuma sessão por sid): resolve usuários pela identidade
        # externa (issuer + subject) e revoga por usuário.
        user_ids = (
            (
                await db_session.execute(
                    select(ExternalIdentity.user_id).where(
                        ExternalIdentity.issuer == issuer,
                        ExternalIdentity.subject == subject,
                    )
                )
            )
            .scalars()
            .all()
        )
        affected = await upstream.revoke_by_issuer_subject(
            db_session, issuer, list(user_ids), REASON_BACKCHANNEL
        )

    if affected:
        backchannel_logger.info("backchannel outcome=accepted affected=%s", affected)
        # Auditoria durável por usuário afetado.
        await record_audit_event(
            event_type=UserAuditEventType.SESSION_REVOKED,
            user_id=None,
            metadata={"origin": "backchannel", "sessions_affected": affected},
        )
    else:
        backchannel_logger.info("backchannel outcome=unknown_session")
    return {"revoked": affected}
