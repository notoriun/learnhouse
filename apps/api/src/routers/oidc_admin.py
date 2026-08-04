"""Endpoints administrativos da configuração OIDC por organização (feature 004).

Contrato em ``specs/004-admin-config-oidc/contracts/admin-oidc-api.md``:
GET/PUT/DELETE ``/orgs/{org_id}/oidc-config`` + POST
``/orgs/{org_id}/oidc-config/test``. Todo endpoint exige admin/mantenedor da
org (Princípio IV); respostas com ``Cache-Control: no-store``; o segredo do
cliente jamais aparece em resposta, log ou erro.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.oidc_provider_config import (
    OIDCConnectionTestResult,
    OIDCProviderConfigRead,
    OIDCProviderConfigWrite,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.security.org_auth import require_org_admin
from src.services.auth.oidc_config import (
    delete_oidc_config,
    read_oidc_config,
    test_oidc_connection,
    upsert_oidc_config,
)
from src.services.security.rate_limiting import check_oidc_config_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter()


class OIDCConnectionTestRequest(BaseModel):
    issuer_url: Optional[str] = None


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def _enforce_rate_limit(org_id: int, action: str) -> None:
    is_allowed, retry_after = check_oidc_config_rate_limit(org_id, action)
    if not is_allowed:
        minutos = max(1, retry_after // 60)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Muitas operações de configuração OIDC. Tente novamente em "
                f"cerca de {minutos} minuto{'s' if minutos != 1 else ''}."
            ),
            headers={"Retry-After": str(retry_after)},
        )


@router.get(
    "/{org_id}/oidc-config",
    response_model=OIDCProviderConfigRead,
    summary="Lê a configuração OIDC da organização",
    description=(
        "Retorna a configuração do provedor OIDC da organização. O segredo do "
        "cliente nunca é retornado — apenas `secret_configured`."
    ),
)
async def api_get_oidc_config(
    org_id: int,
    response: Response,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> OIDCProviderConfigRead:
    await require_org_admin(current_user.id, org_id, db_session)
    _no_store(response)
    config = await read_oidc_config(db_session, org_id)
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "OIDC_NAO_CONFIGURADO",
                "message": "Não há configuração OIDC para esta organização.",
            },
        )
    return config


@router.put(
    "/{org_id}/oidc-config",
    response_model=OIDCProviderConfigRead,
    summary="Cria ou atualiza a configuração OIDC (upsert parcial)",
    description=(
        "Upsert da configuração. Mudança de issuer passa por validação "
        "anti-SSRF e discovery antes de persistir. `client_secret` é "
        "write-only: ausente mantém o atual; não vazio substitui."
    ),
)
async def api_put_oidc_config(
    org_id: int,
    body: OIDCProviderConfigWrite,
    response: Response,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> OIDCProviderConfigRead:
    await require_org_admin(current_user.id, org_id, db_session)
    _enforce_rate_limit(org_id, "write")
    _no_store(response)
    return await upsert_oidc_config(db_session, org_id, body, current_user)


@router.delete(
    "/{org_id}/oidc-config",
    summary="Exclui a configuração OIDC da organização",
    description=(
        "Exige `confirm=true`. Remove apenas a configuração — contas, vínculos "
        "e identidades externas são preservados para eventual reativação."
    ),
)
async def api_delete_oidc_config(
    org_id: int,
    response: Response,
    confirm: bool = Query(False),
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await require_org_admin(current_user.id, org_id, db_session)
    _enforce_rate_limit(org_id, "delete")
    _no_store(response)
    if not confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "CONFIRMACAO_NECESSARIA",
                "message": (
                    "A exclusão da configuração exige confirmação explícita "
                    "(confirm=true). Contas e vínculos são preservados."
                ),
            },
        )
    removida = await delete_oidc_config(db_session, org_id, current_user)
    if not removida:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "OIDC_NAO_CONFIGURADO",
                "message": "Não há configuração OIDC para esta organização.",
            },
        )
    return {"deleted": True}


@router.post(
    "/{org_id}/oidc-config/test",
    response_model=OIDCConnectionTestResult,
    summary="Testa a conexão com o provedor OIDC",
    description=(
        "Executa o discovery contra o issuer informado (sem salvar) ou contra "
        "o issuer da configuração salva. Distingue provedor inacessível de "
        "configuração inválida."
    ),
)
async def api_test_oidc_connection(
    org_id: int,
    body: OIDCConnectionTestRequest,
    response: Response,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> OIDCConnectionTestResult:
    await require_org_admin(current_user.id, org_id, db_session)
    _enforce_rate_limit(org_id, "test")
    _no_store(response)
    return await test_oidc_connection(db_session, org_id, body.issuer_url)
