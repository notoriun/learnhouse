"""Identidade externa federada (feature 002).

Uma identidade é única por ``(issuer, subject)`` — NUNCA por e-mail (ADR-05 do
plano). A unicidade é uma constraint de banco (Princípio V da constituição:
constraint de BD antes de lógica de aplicação), o que também resolve a corrida
de provisionamento concorrente via ``IntegrityError``.
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
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ExternalIdentity(SQLModel, table=True):
    __tablename__ = "externalidentity"
    __table_args__ = (
        UniqueConstraint(
            "issuer", "subject", name="uq_externalidentity_issuer_subject"
        ),
        Index("ix_externalidentity_user_id", "user_id"),
        Index("ix_externalidentity_organization_id", "organization_id"),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
        )
    )
    # Organização do fluxo no momento do vínculo; anulável apenas por remoção
    # posterior da organização (SET NULL).
    organization_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("organization.id", ondelete="SET NULL"), nullable=True
        ),
    )
    issuer: str = Field(sa_column=Column(String(2048), nullable=False))
    subject: str = Field(sa_column=Column(String(255), nullable=False))
    provider: str = Field(
        default="keycloak", sa_column=Column(String(50), nullable=False, server_default="keycloak")
    )
    # Somente auditoria — NUNCA é a chave da identidade.
    email_at_link_time: Optional[str] = Field(
        default=None, sa_column=Column(String(320), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_login_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
