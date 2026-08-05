"""Detecção de conta federada ao provedor da plataforma (feature 007).

Regra R1 do data-model: conta é federada ⇔ existe ``ExternalIdentity`` do
usuário cujo issuer é o issuer global da plataforma. IdP de terceiro
(feature 004) nunca satisfaz a regra — FR-010.
"""

from fastapi import HTTPException, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.external_identities import ExternalIdentity
from src.services.auth.keycloak_oidc import get_keycloak_config


def _platform_issuer() -> str:
    return (get_keycloak_config().issuer or "").rstrip("/")


def platform_account_console_url() -> str:
    """Central de conta do provedor da plataforma (``<issuer>/account``)."""
    return f"{_platform_issuer()}/account"


async def is_platform_federated(db_session: AsyncSession, user_id: int) -> bool:
    issuer = _platform_issuer()
    if not issuer:
        return False
    row = (
        (
            await db_session.execute(
                select(ExternalIdentity.id).where(
                    ExternalIdentity.user_id == user_id,
                    ExternalIdentity.issuer == issuer,
                )
            )
        )
        .scalars()
        .first()
    )
    return row is not None


async def ensure_not_platform_federated(
    db_session: AsyncSession, user_id: int
) -> None:
    """Guard de FR-008: senha e e-mail de conta federada mudam no provedor.

    Levanta 403 ``CONTA_FEDERADA`` com a URL da central de conta
    (contracts/registro-federado.md §3).
    """
    if await is_platform_federated(db_session, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "CONTA_FEDERADA",
                "message": (
                    "Sua conta é gerenciada pelo provedor de identidade "
                    "corporativo. Altere senha e e-mail na central de conta."
                ),
                "account_console_url": platform_account_console_url(),
            },
        )
