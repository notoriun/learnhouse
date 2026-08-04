"""Sessão upstream — vínculo entre a cadeia de sessão local (claim ``usid``) e
a sessão no provedor de identidade (``issuer`` + ``sid``). Feature 003.

Segredos (refresh upstream, ID token) vivem cifrados (Fernet, chave fora do
banco) e são anulados na transição terminal — não reter segredos mortos.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# Estados
STATUS_ACTIVE = "active"
STATUS_REVOKED = "revoked"
STATUS_EXPIRED = "expired"

# Motivos de saída de active
REASON_USER_LOGOUT = "user_logout"
REASON_BACKCHANNEL = "backchannel"
REASON_UPSTREAM_DENIED = "upstream_denied"
REASON_POLICY_TTL = "policy_ttl"
REASON_ADMIN = "admin"


class UpstreamSession(SQLModel, table=True):
    __tablename__ = "upstream_session"
    __table_args__ = (
        Index("uq_upstream_session_uuid", "session_uuid", unique=True),
        Index("ix_upstream_session_issuer_sid", "issuer", "sid"),
        Index("ix_upstream_session_user_status", "user_id", "status"),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    # Valor do claim usid nos JWTs locais da cadeia.
    session_uuid: str = Field(sa_column=Column(String(64), nullable=False))
    user_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
        )
    )
    external_identity_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("externalidentity.id", ondelete="SET NULL"), nullable=True
        ),
    )
    org_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=True
        ),
    )
    issuer: str = Field(sa_column=Column(Text, nullable=False))
    sid: Optional[str] = Field(default=None, sa_column=Column(String(255), nullable=True))
    upstream_refresh_encrypted: Optional[str] = Field(
        default=None, sa_column=Column(Text, nullable=True)
    )
    id_token_encrypted: Optional[str] = Field(
        default=None, sa_column=Column(Text, nullable=True)
    )
    status: str = Field(
        default=STATUS_ACTIVE,
        sa_column=Column(String(16), nullable=False, server_default=STATUS_ACTIVE),
    )
    revocation_reason: Optional[str] = Field(
        default=None, sa_column=Column(String(32), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_refreshed_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    revoked_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
