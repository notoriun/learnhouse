"""Serviço da configuração OIDC por organização (feature 004).

Contrato intra-API: ``get_active_oidc_config(db, org_id)`` é a interface
consumida pelas features 001 (login/validação de tokens) e 002
(admissão/provisionamento — ``auto_provision_users``, ``allowed_email_domains``,
``default_role_id``, ``required_acr``, ``clock_skew_seconds``).

O segredo do cliente entra cifrado (Fernet, chave fora do banco) e só é
decifrado no backend, na troca de código; nenhuma função de leitura o expõe.
"""

import logging
import re
from typing import List, Optional

import httpx
from fastapi import HTTPException, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from config.config import KeycloakConfig

from src.db.oidc_provider_config import (
    OIDCConnectionTestResult,
    OIDCProviderConfig,
    OIDCProviderConfigRead,
    OIDCProviderConfigWrite,
)
from src.db.user_audit_events import UserAuditEventType
from src.db.users import PublicUser
from src.services.audit.audit import record_audit_event
from src.services.security.url_validation import validate_external_https_url
from src.services.webhooks.crypto import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

HTTP_TIMEOUT_SECONDS = 5.0
REQUIRED_DISCOVERY_FIELDS = (
    "issuer",
    "authorization_endpoint",
    "token_endpoint",
    "jwks_uri",
)

MSG_INACESSIVEL_CONEXAO = (
    "Não foi possível conectar ao provedor. Verifique o endereço e se o serviço "
    "está no ar."
)
MSG_INACESSIVEL_ERRO = (
    "O provedor respondeu com erro temporário. Tente novamente em instantes."
)
MSG_INVALIDA_REDIRECT = (
    "O endereço de discovery respondeu com redirecionamento, o que não é aceito."
)
MSG_INVALIDA_DOCUMENTO = (
    "O endereço não expõe um documento de discovery OIDC válido."
)
MSG_INVALIDA_ISSUER = (
    "O issuer declarado pelo provedor não coincide com o endereço configurado."
)
MSG_OK = "Conexão validada: discovery OIDC íntegro e coerente."


def _to_read(row: OIDCProviderConfig) -> OIDCProviderConfigRead:
    return OIDCProviderConfigRead(
        id=row.id,
        org_id=row.org_id,
        issuer_url=row.issuer_url,
        client_id=row.client_id,
        secret_configured=bool(row.client_secret_encrypted),
        scopes=row.scopes,
        enabled=row.enabled,
        allowed_email_domains=list(row.allowed_email_domains or []),
        auto_provision_users=row.auto_provision_users,
        default_role_id=row.default_role_id,
        required_acr=row.required_acr,
        clock_skew_seconds=row.clock_skew_seconds,
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def run_discovery_check(issuer_url: str) -> OIDCConnectionTestResult:
    """Valida o discovery do issuer — a mesma rotina roda no salvar e no
    endpoint de teste de conexão (FR-006).

    Classificação: ``inacessivel`` (timeout/conexão/5xx — transitório),
    ``invalida`` (4xx, redirect, corpo ilegível, campos ausentes, issuer
    divergente — configuração errada), ``ok``.
    """
    issuer = (issuer_url or "").rstrip("/")
    url = f"{issuer}/.well-known/openid-configuration"
    try:
        response = httpx.get(url, timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False)
    except Exception:
        return OIDCConnectionTestResult(
            status="inacessivel", detail=MSG_INACESSIVEL_CONEXAO
        )
    if response.status_code >= 500:
        return OIDCConnectionTestResult(status="inacessivel", detail=MSG_INACESSIVEL_ERRO)
    if 300 <= response.status_code < 400:
        return OIDCConnectionTestResult(status="invalida", detail=MSG_INVALIDA_REDIRECT)
    if response.status_code != 200:
        return OIDCConnectionTestResult(status="invalida", detail=MSG_INVALIDA_DOCUMENTO)
    try:
        document = response.json()
    except ValueError:
        return OIDCConnectionTestResult(status="invalida", detail=MSG_INVALIDA_DOCUMENTO)
    if not isinstance(document, dict) or not all(
        campo in document for campo in REQUIRED_DISCOVERY_FIELDS
    ):
        return OIDCConnectionTestResult(status="invalida", detail=MSG_INVALIDA_DOCUMENTO)
    if str(document.get("issuer", "")).rstrip("/") != issuer:
        return OIDCConnectionTestResult(status="invalida", detail=MSG_INVALIDA_ISSUER)
    return OIDCConnectionTestResult(
        status="ok",
        detail=MSG_OK,
        discovered_endpoints={
            "authorization_endpoint": document["authorization_endpoint"],
            "token_endpoint": document["token_endpoint"],
            "jwks_uri": document["jwks_uri"],
        },
    )


_DOMAIN_RE = re.compile(
    r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
)


def _normalize_email_domains(domains: List[str]) -> List[str]:
    """Minúsculas, sem ``@``, sem duplicatas, formato de domínio válido."""
    vistos: set[str] = set()
    resultado: List[str] = []
    for bruto in domains:
        dominio = (bruto or "").strip().lower().lstrip("@")
        if not _DOMAIN_RE.match(dominio):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "DOMINIO_INVALIDO",
                    "message": "A lista de domínios contém um valor inválido.",
                },
            )
        if dominio not in vistos:
            vistos.add(dominio)
            resultado.append(dominio)
    return resultado


async def _validate_default_role(
    db_session: AsyncSession, org_id: int, role_id: int
) -> None:
    """Papel padrão de MENOR privilégio: existe, pertence à org (ou é global)
    e nunca é admin/maintainer — mesma regra do provisionamento administrativo."""
    from src.db.roles import Role, RoleTypeEnum
    from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS

    erro = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={
            "code": "PAPEL_INVALIDO",
            "message": (
                "O papel padrão deve existir, pertencer à organização e ser um "
                "papel de menor privilégio (não administrativo)."
            ),
        },
    )
    if role_id in ADMIN_OR_MAINTAINER_ROLE_IDS:
        raise erro
    role = (
        (await db_session.execute(select(Role).where(Role.id == role_id)))
        .scalars()
        .first()
    )
    if role is None:
        raise erro
    if role.role_type != RoleTypeEnum.TYPE_GLOBAL and role.org_id != org_id:
        raise erro


async def _get_row(
    db_session: AsyncSession, org_id: int
) -> Optional[OIDCProviderConfig]:
    return (
        (
            await db_session.execute(
                select(OIDCProviderConfig).where(OIDCProviderConfig.org_id == org_id)
            )
        )
        .scalars()
        .first()
    )


async def read_oidc_config(
    db_session: AsyncSession, org_id: int
) -> Optional[OIDCProviderConfigRead]:
    row = await _get_row(db_session, org_id)
    return _to_read(row) if row else None


async def get_active_oidc_config(
    db_session: AsyncSession, org_id: int
) -> Optional[OIDCProviderConfig]:
    """Config da org com ``enabled=true``, ou ``None``.

    Contrato intra-API consumido pelas features 001 (fluxo de login) e 002
    (política de provisionamento). O chamador NUNCA serializa o campo
    ``client_secret_encrypted`` — use :func:`get_decrypted_client_secret`
    apenas no backend, na troca de código.
    """
    return (
        (
            await db_session.execute(
                select(OIDCProviderConfig).where(
                    OIDCProviderConfig.org_id == org_id,
                    OIDCProviderConfig.enabled == True,  # noqa: E712
                )
            )
        )
        .scalars()
        .first()
    )


def get_decrypted_client_secret(row: OIDCProviderConfig) -> str:
    """Decifra o segredo para uso exclusivo no backend (troca de código)."""
    if not row.client_secret_encrypted:
        return ""
    return decrypt_secret(row.client_secret_encrypted)


def to_client_config(row: OIDCProviderConfig) -> KeycloakConfig:
    """Config efetiva do fluxo OIDC (feature 001) a partir da config da org.

    Reusa o mesmo shape da config global (``KeycloakConfig``) para que as
    funções de ``keycloak_oidc`` sirvam às duas fontes sem duplicação.
    """
    return KeycloakConfig(
        enabled=row.enabled,
        issuer=row.issuer_url.rstrip("/"),
        client_id=row.client_id,
        client_secret=get_decrypted_client_secret(row),
        clock_skew=row.clock_skew_seconds,
    )


async def get_effective_client_config(db_session: AsyncSession, org_id: Optional[int]):
    """Config efetiva do fluxo de login da org: a configurada pela org
    (``enabled=true``, feature 004) quando existe; senão a global de
    env/config.yaml. Retorna ``(row, config)`` — ``row`` é ``None`` no
    fallback global."""
    from src.services.auth.keycloak_oidc import get_keycloak_config

    row = await get_active_oidc_config(db_session, org_id) if org_id else None
    if row is not None:
        return row, to_client_config(row)
    return None, get_keycloak_config()


async def config_for_upstream_session(db_session: AsyncSession, row) -> KeycloakConfig:
    """Config cujo issuer corresponde ao da sessão upstream (logout/refresh).

    A sessão pertence ao issuer que a emitiu: usa a config da org somente se o
    issuer bater; senão a global. Evita renovar/encerrar uma sessão contra o
    endpoint de outro provedor após troca de configuração."""
    from src.services.auth.keycloak_oidc import get_keycloak_config

    issuer = (row.issuer or "").rstrip("/")
    if row.org_id:
        config_row = await get_active_oidc_config(db_session, row.org_id)
        if config_row is not None:
            candidate = to_client_config(config_row)
            if candidate.issuer == issuer:
                return candidate
    return get_keycloak_config()


async def upsert_oidc_config(
    db_session: AsyncSession,
    org_id: int,
    data: OIDCProviderConfigWrite,
    current_user: PublicUser,
) -> OIDCProviderConfigRead:
    """Upsert singleton por org (upsert parcial: campos ausentes são mantidos).

    Mudança de issuer exige anti-SSRF + discovery válido ANTES de persistir
    (FR-003). Semântica do segredo (write-only): ausente/None mantém; string
    não vazia substitui; vazia é 422 pelo schema.
    """
    row = await _get_row(db_session, org_id)
    criada = row is None
    enabled_antes = row.enabled if row else False

    novo_issuer = data.issuer_url.rstrip("/") if data.issuer_url else None
    issuer_mudou = novo_issuer is not None and (
        row is None or novo_issuer != row.issuer_url
    )
    if issuer_mudou:
        validate_external_https_url(novo_issuer)
        resultado = run_discovery_check(novo_issuer)
        if resultado.status != "ok":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "ISSUER_INVALIDO", "message": resultado.detail},
            )

    # Políticas de provisionamento (US3) — validadas sobre o estado FINAL,
    # antes de qualquer mutação do objeto na sessão.
    if data.allowed_email_domains is not None:
        data.allowed_email_domains = _normalize_email_domains(
            data.allowed_email_domains
        )
    role_final = (
        data.default_role_id
        if data.default_role_id is not None
        else (row.default_role_id if row else None)
    )
    auto_final = (
        data.auto_provision_users
        if data.auto_provision_users is not None
        else (row.auto_provision_users if row else False)
    )
    if data.default_role_id is not None:
        await _validate_default_role(db_session, org_id, data.default_role_id)
    if auto_final and not role_final:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "PAPEL_OBRIGATORIO",
                "message": (
                    "Defina o papel padrão de menor privilégio antes de ativar "
                    "o auto-provisionamento."
                ),
            },
        )

    # Barreira de ativação (US2) — avaliada sobre o estado FINAL, antes de
    # qualquer mutação do objeto na sessão: ligar sem segredo configurado
    # quebraria o fluxo de login de forma silenciosa.
    enabled_final = (
        data.enabled if data.enabled is not None else (row.enabled if row else False)
    )
    segredo_final = (
        data.client_secret
        if data.client_secret is not None
        else (row.client_secret_encrypted if row else "")
    )
    if enabled_final and not segredo_final:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "SEGREDO_NAO_CONFIGURADO",
                "message": (
                    "Configure o segredo do cliente antes de ativar o login "
                    "corporativo."
                ),
            },
        )

    if row is None:
        if not novo_issuer or not data.client_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "CONFIG_INCOMPLETA",
                    "message": (
                        "Para criar a configuração informe o endereço do emissor "
                        "(issuer) e o identificador do cliente."
                    ),
                },
            )
        row = OIDCProviderConfig(
            org_id=org_id,
            issuer_url=novo_issuer,
            client_id=data.client_id,
            created_by_user_id=current_user.id,
        )

    if novo_issuer is not None:
        row.issuer_url = novo_issuer
    for campo in (
        "client_id",
        "scopes",
        "enabled",
        "allowed_email_domains",
        "auto_provision_users",
        "default_role_id",
        "required_acr",
        "clock_skew_seconds",
    ):
        valor = getattr(data, campo)
        if valor is not None:
            setattr(row, campo, valor)

    if data.client_secret is not None:
        # Única operação sobre segredo existente: substituição (FR-005).
        row.client_secret_encrypted = encrypt_secret(data.client_secret)

    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)

    # Trilha administrativa (FR-008): exatamente um evento por operação, com
    # os NOMES dos campos alterados — nunca valores nem segredos.
    campos_alterados = [
        nome
        for nome in (
            "issuer_url",
            "client_id",
            "client_secret",
            "scopes",
            "enabled",
            "allowed_email_domains",
            "auto_provision_users",
            "default_role_id",
            "required_acr",
            "clock_skew_seconds",
        )
        if getattr(data, nome) is not None
    ]
    if criada:
        evento = UserAuditEventType.OIDC_CONFIG_CREATED
    elif data.enabled is True and not enabled_antes:
        evento = UserAuditEventType.OIDC_CONFIG_ACTIVATED
    elif data.enabled is False and enabled_antes:
        evento = UserAuditEventType.OIDC_CONFIG_DEACTIVATED
    elif data.client_secret is not None:
        evento = UserAuditEventType.OIDC_CONFIG_SECRET_ROTATED
    else:
        evento = UserAuditEventType.OIDC_CONFIG_UPDATED
    await record_audit_event(
        event_type=evento,
        user_id=current_user.id,
        org_id=org_id,
        metadata={"fields": campos_alterados},
    )
    return _to_read(row)


async def delete_oidc_config(
    db_session: AsyncSession, org_id: int, current_user: PublicUser
) -> bool:
    """Exclui apenas a configuração — contas, vínculos e identidades externas
    são preservados (edge case da spec: reativação religa os mesmos vínculos)."""
    row = await _get_row(db_session, org_id)
    if row is None:
        return False
    await db_session.delete(row)
    await db_session.commit()
    await record_audit_event(
        event_type=UserAuditEventType.OIDC_CONFIG_DELETED,
        user_id=current_user.id,
        org_id=org_id,
        metadata={},
    )
    return True


async def test_oidc_connection(
    db_session: AsyncSession, org_id: int, issuer_url: Optional[str]
) -> OIDCConnectionTestResult:
    """Teste de conexão: usa o issuer informado (não salvo) ou o da config."""
    issuer = (issuer_url or "").rstrip("/")
    if not issuer:
        row = await _get_row(db_session, org_id)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "OIDC_NAO_CONFIGURADO",
                    "message": "Não há configuração OIDC para esta organização.",
                },
            )
        issuer = row.issuer_url
    else:
        validate_external_https_url(issuer)
    return run_discovery_check(issuer)
