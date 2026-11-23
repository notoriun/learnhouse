"""Durable audit-event write path.

Unlike ``services/analytics/analytics.track`` — which fires-and-forgets to Tinybird
and swallows every error — this records a legal-grade row in Postgres and commits it.
It writes in its **own** isolated session (from the app session factory) so the audit
row is a self-contained transaction that neither depends on nor interferes with the
caller's unit of work. Callers emit an audit event AFTER the authoritative action has
been committed (mirroring where ``track()`` is already called), so an isolated commit
here can never record an action that later rolls back.

Failures are logged loudly (this is legal data, so a lost write matters) but never
raised: an audit-log hiccup must not break the student's actual action.
"""
import logging
from typing import Optional

from fastapi import Request

from src.db.user_audit_events import UserAuditEvent, UserAuditEventType

logger = logging.getLogger(__name__)


def extract_request_context(request: Optional[Request]) -> tuple[Optional[str], Optional[str]]:
    """Return ``(ip, user_agent)`` from a request, best-effort. Never raises."""
    if request is None:
        return None, None
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    try:
        # Local import avoids a heavier import chain at module load.
        from src.services.security.rate_limiting import get_client_ip

        ip = get_client_ip(request)
    except Exception:
        ip = request.client.host if request.client else None
    try:
        user_agent = request.headers.get("user-agent")
    except Exception:
        user_agent = None
    return ip, user_agent


# Eventos federados (feature 002) que podem ocorrer ANTES de existir conta —
# negação/conflito no primeiro acesso não têm usuário local. Para esses tipos,
# ``user_id`` nulo é registrado (a coluna é anulável), em vez de descartado.
_USER_OPTIONAL_EVENT_TYPES = frozenset(
    {
        UserAuditEventType.SSO_LOGIN_DENIED,
        UserAuditEventType.SSO_CONFLICT,
        # Back-channel por sid pode afetar múltiplos usuários — evento agregado
        # sem user_id específico (feature 003).
        UserAuditEventType.SESSION_REVOKED,
    }
)


async def record_audit_event(
    *,
    event_type: str,
    user_id: Optional[int] = None,
    org_id: Optional[int] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    target_uuid: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    """Append one durable audit row in an isolated, immediately-committed transaction.

    Emit this only for STUDENT learning actions (see ``UserAuditEventType``). Do not
    call from authoring/admin paths — that data is intentionally out of scope.

    Exceção deliberada: os eventos ``oidc_config_*`` (feature 004) registram a
    trilha administrativa da configuração do provedor de identidade, e os
    ``sso_*`` (feature 002) registram provisionamento/vínculo/negação/conflito —
    ver a nota de escopo em ``UserAuditEventType``. Os tipos em
    ``_USER_OPTIONAL_EVENT_TYPES`` são gravados mesmo sem ``user_id``.
    """
    # Anonymous / system actors (user_id 0/None) have nothing to audit —
    # exceto os eventos federados que precedem a existência da conta.
    if not user_id and event_type not in _USER_OPTIONAL_EVENT_TYPES:
        return

    try:
        # Imported lazily so this module is importable without booting the engine
        # (e.g. during unit tests that patch the factory).
        from src.core.events.database import _async_session_factory

        async with _async_session_factory() as session:
            session.add(
                UserAuditEvent(
                    event_type=event_type,
                    user_id=user_id,
                    org_id=org_id,
                    ip=ip,
                    user_agent=user_agent,
                    target_uuid=target_uuid,
                    audit_metadata=metadata or {},
                )
            )
            await session.commit()
    except Exception:
        logger.error(
            "Failed to record audit event %s for user %s (org %s) — audit data lost",
            event_type,
            user_id,
            org_id,
            exc_info=True,
        )
