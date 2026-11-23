"""Configuração do provedor OIDC por organização (feature 004).

O segredo do cliente vive apenas em ``client_secret_encrypted`` (Fernet, chave
fora do banco) e NÃO existe em nenhum schema de leitura — vazamento por
serialização é estruturalmente impossível (SC-002).
"""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field as PydanticField
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlmodel import Field, SQLModel

DEFAULT_SCOPES = "openid email profile"


class OIDCProviderConfig(SQLModel, table=True):
    """No máximo uma configuração (logo, um provedor) por organização no
    primeiro release — UNIQUE em ``org_id``."""

    __tablename__ = "oidc_provider_config"
    __table_args__ = ({"extend_existing": True},)

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("organization.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        )
    )
    issuer_url: str = Field(sa_column=Column(String(2048), nullable=False))
    client_id: str = Field(sa_column=Column(String(255), nullable=False))
    # Cifrado com Fernet (chave derivada de env, fora do banco). "" = ainda
    # não configurado. Nunca serializado em schema de leitura.
    client_secret_encrypted: str = Field(
        default="", sa_column=Column(Text, nullable=False)
    )
    scopes: str = Field(
        default=DEFAULT_SCOPES,
        sa_column=Column(String(500), nullable=False, server_default=DEFAULT_SCOPES),
    )
    enabled: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    allowed_email_domains: List[str] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )
    auto_provision_users: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    default_role_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("role.id", ondelete="SET NULL"), nullable=True
        ),
    )
    required_acr: Optional[str] = Field(
        default=None, sa_column=Column(String(255), nullable=True)
    )
    clock_skew_seconds: int = Field(
        default=60, sa_column=Column(Integer, nullable=False, server_default="60")
    )
    created_by_user_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
        )
    )
    created_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(
            DateTime(timezone=True), nullable=False, server_default=func.now()
        ),
    )
    updated_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            onupdate=func.now(),
        ),
    )


# ---------------------------------------------------------------------------
# Schemas Pydantic
# ---------------------------------------------------------------------------


class OIDCProviderConfigRead(BaseModel):
    """Leitura administrativa — o campo do segredo NÃO existe aqui."""

    id: int
    org_id: int
    issuer_url: str
    client_id: str
    secret_configured: bool
    scopes: str
    enabled: bool
    allowed_email_domains: List[str]
    auto_provision_users: bool
    default_role_id: Optional[int] = None
    required_acr: Optional[str] = None
    clock_skew_seconds: int
    created_by_user_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class OIDCProviderConfigWrite(BaseModel):
    """Payload do PUT (upsert parcial). ``client_secret`` é write-only:
    ausente/None mantém o atual; string não vazia substitui; vazia → 422."""

    issuer_url: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = PydanticField(default=None, min_length=1)
    scopes: Optional[str] = None
    enabled: Optional[bool] = None
    allowed_email_domains: Optional[List[str]] = None
    auto_provision_users: Optional[bool] = None
    default_role_id: Optional[int] = None
    required_acr: Optional[str] = None
    clock_skew_seconds: Optional[int] = PydanticField(default=None, ge=0, le=300)


class OIDCConnectionTestResult(BaseModel):
    status: Literal["ok", "inacessivel", "invalida"]
    detail: str
    discovered_endpoints: Optional[dict] = None
