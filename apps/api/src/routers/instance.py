from fastapi import APIRouter, Depends
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from src.db.organizations import Organization
from src.core.events.database import get_db_session
from src.core.ee_hooks import is_multi_org_allowed
from src.core.deployment_mode import get_deployment_mode
from src.services.orgs.cache import get_cached_instance_info, set_cached_instance_info
from config.config import get_learnhouse_config

router = APIRouter()


def _get_app_version() -> str:
    """Versão da API em execução (feature 006/FR-005). Lida dos metadados do
    pacote instalado; fallback para app.py se o pacote não estiver instalado
    (ex.: execução direta a partir do checkout). É a mesma string da tag de
    release, usada para correlacionar a instância com a fonte AGPL publicada."""
    try:
        from importlib.metadata import version

        return version("learnhouse-api")
    except Exception:
        try:
            from app import app as _app  # type: ignore

            return _app.version
        except Exception:
            return "unknown"


def _account_console_url(config) -> str | None:
    """``<issuer>/account`` quando o Keycloak da plataforma está ativo."""
    kc = getattr(config, "keycloak_config", None)
    if kc and kc.enabled and kc.issuer:
        return f"{kc.issuer.rstrip('/')}/account"
    return None


def _strip_port(domain: str) -> str:
    """Strip port from a domain string (e.g. 'localhost:3000' -> 'localhost')."""
    return domain.split(":")[0] if ":" in domain else domain


@router.get(
    "/info",
    summary="Get instance info",
    description=(
        "Public endpoint returning instance configuration (deployment mode, default org slug, "
        "frontend domain, and multi-org flag). Result is cached for performance."
    ),
    responses={
        200: {"description": "Instance configuration for the current deployment."},
    },
)
async def get_instance_info(db_session: AsyncSession = Depends(get_db_session)):
    """Public endpoint returning instance configuration."""
    cached = get_cached_instance_info()
    if cached is not None:
        return cached

    default_org_slug = "default"
    try:
        statement = select(Organization).where(Organization.slug == "default")
        default_org = (await db_session.execute(statement)).scalars().first()
        if not default_org:
            statement = select(Organization).order_by(Organization.id).limit(1)
            default_org = (await db_session.execute(statement)).scalars().first()
        if default_org:
            default_org_slug = default_org.slug
    except Exception:
        pass

    config = get_learnhouse_config()
    frontend_domain = config.hosting_config.frontend_domain
    top_domain = _strip_port(frontend_domain)
    tenancy = config.hosting_config.tenancy

    result = {
        "mode": get_deployment_mode(),
        "tenancy": tenancy,
        # Deprecated: prefer `tenancy`. Will be removed in a future release.
        "multi_org_enabled": tenancy == "multi" and is_multi_org_allowed(),
        "default_org_slug": default_org_slug,
        "frontend_domain": frontend_domain,
        "top_domain": top_domain,
        # Versão em execução (feature 006/FR-005): correlaciona a instância com
        # a fonte AGPL publicada para a mesma tag de release.
        "version": _get_app_version(),
        # Central de conta do provedor da plataforma (feature 007): contas
        # federadas gerenciam senha/e-mail lá. Público — o issuer já aparece
        # em todo redirect de login corporativo.
        "account_console_url": _account_console_url(config),
    }

    set_cached_instance_info(result)
    return result
