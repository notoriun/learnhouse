"""Serviço da sessão upstream (feature 003): criar, consultar e revogar o
vínculo entre a sessão local e a sessão do provedor.

Invariante de escrita: toda transição para fora de ``active`` grava, na mesma
operação, a chave Redis ``upstream_revoked:{session_uuid}`` (enforcement no hot
path), preenche ``revoked_at``/``revocation_reason`` e anula os segredos
cifrados (refresh upstream e ID token). Consultas sempre filtradas por
``issuer``+``sid`` ou por ``user_id`` (Princípio IV).
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.upstream_sessions import (
    STATUS_ACTIVE,
    STATUS_EXPIRED,
    STATUS_REVOKED,
    UpstreamSession,
)
from src.services.webhooks.crypto import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

REVOKED_KEY_PREFIX = "upstream_revoked:"
# TTL da chave de revogação: cobre a vida do refresh token (30 dias).
_REVOKED_TTL_SECONDS = 30 * 24 * 60 * 60


def new_session_uuid() -> str:
    return f"upsession_{uuid.uuid4().hex}"


def _redis():  # pragma: no cover - shim; substituído em testes
    try:
        from src.core.redis import get_redis_client

        return get_redis_client()
    except Exception:
        return None


def encrypt(value: Optional[str]) -> Optional[str]:
    return encrypt_secret(value) if value else None


def decrypt(value: Optional[str]) -> Optional[str]:
    return decrypt_secret(value) if value else None


def mark_revoked_in_redis(session_uuid: str) -> None:
    """Enforcement no hot path — get_current_user e /auth/refresh rejeitam
    tokens com ``usid`` presente aqui."""
    r = _redis()
    if r is None:
        # Fail-safe: sem Redis, a revogação durável na linha ainda vale no
        # próximo refresh (que relê a linha). Loga para operação.
        logger.warning("upstream_session: Redis indisponível ao marcar revogação")
        return
    try:
        r.set(f"{REVOKED_KEY_PREFIX}{session_uuid}", "1", ex=_REVOKED_TTL_SECONDS)
    except Exception:
        logger.exception("upstream_session: erro ao gravar chave de revogação")


def is_revoked_in_redis(session_uuid: str) -> bool:
    r = _redis()
    if r is None:
        return False
    try:
        return bool(r.get(f"{REVOKED_KEY_PREFIX}{session_uuid}"))
    except Exception:
        logger.exception("upstream_session: erro ao ler chave de revogação")
        return False


async def create_upstream_session(
    db_session: AsyncSession,
    *,
    session_uuid: str,
    user_id: int,
    issuer: str,
    sid: Optional[str],
    org_id: Optional[int] = None,
    external_identity_id: Optional[int] = None,
    upstream_refresh_token: Optional[str] = None,
    id_token: Optional[str] = None,
) -> UpstreamSession:
    row = UpstreamSession(
        session_uuid=session_uuid,
        user_id=user_id,
        issuer=issuer,
        sid=sid,
        org_id=org_id,
        external_identity_id=external_identity_id,
        upstream_refresh_encrypted=encrypt(upstream_refresh_token),
        id_token_encrypted=encrypt(id_token),
        status=STATUS_ACTIVE,
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return row


async def get_by_uuid(
    db_session: AsyncSession, session_uuid: str
) -> Optional[UpstreamSession]:
    return (
        (
            await db_session.execute(
                select(UpstreamSession).where(
                    UpstreamSession.session_uuid == session_uuid
                )
            )
        )
        .scalars()
        .first()
    )


async def _terminate(
    db_session: AsyncSession,
    row: UpstreamSession,
    *,
    status: str,
    reason: str,
) -> None:
    """Transição terminal: grava Redis, preenche motivo/momento e anula
    segredos — tudo na mesma operação (invariante de escrita)."""
    if row.status != STATUS_ACTIVE:
        return  # terminal é idempotente
    row.status = status
    row.revocation_reason = reason
    row.revoked_at = datetime.now(timezone.utc)
    row.upstream_refresh_encrypted = None
    row.id_token_encrypted = None
    db_session.add(row)
    await db_session.commit()
    mark_revoked_in_redis(row.session_uuid)


async def revoke(
    db_session: AsyncSession, row: UpstreamSession, reason: str
) -> None:
    await _terminate(db_session, row, status=STATUS_REVOKED, reason=reason)


async def expire(
    db_session: AsyncSession, row: UpstreamSession, reason: str
) -> None:
    await _terminate(db_session, row, status=STATUS_EXPIRED, reason=reason)


async def revoke_by_issuer_sid(
    db_session: AsyncSession, issuer: str, sid: str, reason: str
) -> int:
    """Back-channel por ``sid``: revoga todas as sessões ativas daquele issuer+sid.
    Idempotente — sessões já terminais são ignoradas. Retorna quantas revogou."""
    rows = (
        (
            await db_session.execute(
                select(UpstreamSession).where(
                    UpstreamSession.issuer == issuer,
                    UpstreamSession.sid == sid,
                    UpstreamSession.status == STATUS_ACTIVE,
                )
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        await _terminate(db_session, row, status=STATUS_REVOKED, reason=reason)
    return len(rows)


async def revoke_by_issuer_subject(
    db_session: AsyncSession, issuer: str, user_ids: List[int], reason: str
) -> int:
    """Back-channel por ``sub`` (sem ``sid``): revoga sessões ativas do issuer
    para os usuários resolvidos a partir do subject (via identidade externa)."""
    if not user_ids:
        return 0
    rows = (
        (
            await db_session.execute(
                select(UpstreamSession).where(
                    UpstreamSession.issuer == issuer,
                    UpstreamSession.user_id.in_(user_ids),
                    UpstreamSession.status == STATUS_ACTIVE,
                )
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        await _terminate(db_session, row, status=STATUS_REVOKED, reason=reason)
    return len(rows)


async def update_upstream_refresh(
    db_session: AsyncSession, row: UpstreamSession, new_refresh_token: str
) -> None:
    """Persiste o refresh upstream rotacionado (cifrado) + last_refreshed_at."""
    row.upstream_refresh_encrypted = encrypt(new_refresh_token)
    row.last_refreshed_at = datetime.now(timezone.utc)
    db_session.add(row)
    await db_session.commit()
