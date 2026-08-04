"""Cliente OIDC do Keycloak — login corporativo (Authorization Code + PKCE S256).

Implementado somente com dependências já instaladas (httpx, PyJWT[crypto], redis
— Princípio V da constituição). O estado do fluxo (state/nonce/code_verifier) é
efêmero no Redis, com uso único atômico via GETDEL e fail-closed sem Redis,
espelhando o padrão de ``magic_login._burn_jti``. Nenhum log deste módulo pode
conter authorization code, tokens do provedor, code_verifier ou client_secret.
"""

import base64
import hashlib
import json
import logging
import secrets
import threading
import time
from typing import Any, Optional

import httpx
import jwt
from jwt import PyJWKClient

from config.config import get_learnhouse_config

logger = logging.getLogger(__name__)

# TTL do fluxo: cobre autenticação + MFA no Keycloak e mantém a janela de replay
# curta (FR-003, research.md §2).
FLOW_TTL_SECONDS = 600
FLOW_KEY_PREFIX = "oidc_flow:"
DISCOVERY_TTL_SECONDS = 3600
HTTP_TIMEOUT_SECONDS = 5.0
OIDC_SCOPES = "openid email profile"

# Categorias de falha de validação — vão para auditoria/log; nunca o valor do claim.
FAILURE_SIGNATURE = "signature"
FAILURE_UNKNOWN_KID = "unknown_kid"
FAILURE_ISSUER = "issuer"
FAILURE_AUDIENCE = "audience"
FAILURE_AZP = "azp"
FAILURE_EXPIRED = "expired"
FAILURE_NOT_YET_VALID = "not_yet_valid"
FAILURE_NONCE = "nonce"
FAILURE_MALFORMED = "malformed"


class OIDCError(Exception):
    """Base dos erros OIDC. ``category`` é um rótulo seguro para auditoria."""

    def __init__(self, category: str, message: str = ""):
        self.category = category
        super().__init__(message or category)


class ProviderUnavailableError(OIDCError):
    """Discovery/token endpoint/Redis indisponível — falha transitória (503)."""

    def __init__(self, category: str = "provider_unavailable"):
        super().__init__(category)


class CodeExchangeError(OIDCError):
    """O token_endpoint recusou o código/verifier (401 CODIGO_RECUSADO)."""

    def __init__(self, category: str = "code_rejected"):
        super().__init__(category)


class TokenValidationError(OIDCError):
    """Qualquer falha de validação do ID token (401 TOKEN_INVALIDO)."""


# Caches em memória de processo (research.md §3): dados públicos e pequenos;
# um provedor estático por deployment nesta fase.
_discovery_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_jwks_clients: dict[str, PyJWKClient] = {}
_cache_lock = threading.Lock()


def reset_caches() -> None:
    """Limpa os caches de discovery/JWKS (usado em testes)."""
    with _cache_lock:
        _discovery_cache.clear()
        _jwks_clients.clear()


def _redis():  # pragma: no cover - shim fino; substituído nos testes
    try:
        from src.core.redis import get_redis_client

        return get_redis_client()
    except Exception:
        return None


def get_keycloak_config():
    return get_learnhouse_config().keycloak_config


def get_discovery(issuer: str) -> dict[str, Any]:
    """Busca (com cache de 1 h) o documento de discovery do issuer.

    Indisponibilidade ou resposta inválida → ``ProviderUnavailableError``
    (fail closed — nunca degrada a validação).
    """
    now = time.monotonic()
    with _cache_lock:
        cached = _discovery_cache.get(issuer)
        if cached and now - cached[0] < DISCOVERY_TTL_SECONDS:
            return cached[1]
    url = f"{issuer.rstrip('/')}/.well-known/openid-configuration"
    try:
        response = httpx.get(url, timeout=HTTP_TIMEOUT_SECONDS)
        response.raise_for_status()
        document = response.json()
    except Exception:
        logger.warning("Keycloak: discovery indisponível para o issuer configurado")
        raise ProviderUnavailableError("discovery_unavailable")
    required = ("authorization_endpoint", "token_endpoint", "jwks_uri", "issuer")
    if not all(key in document for key in required):
        logger.warning("Keycloak: documento de discovery incompleto")
        raise ProviderUnavailableError("discovery_invalid")
    with _cache_lock:
        _discovery_cache[issuer] = (now, document)
    return document


def _get_jwks_client(jwks_uri: str) -> PyJWKClient:
    """Singleton por jwks_uri; ``cache_keys=True`` faz o PyJWKClient rebuscar o
    JWKS automaticamente quando encontra ``kid`` desconhecido (rotação de
    chaves — FR-006)."""
    with _cache_lock:
        client = _jwks_clients.get(jwks_uri)
        if client is None:
            client = PyJWKClient(jwks_uri, cache_keys=True, timeout=HTTP_TIMEOUT_SECONDS)
            _jwks_clients[jwks_uri] = client
        return client


def sanitize_redirect(path: Optional[str]) -> str:
    """Aceita somente caminho relativo interno; qualquer outro valor vira ``/``.

    Rejeita ``//host`` (protocol-relative), esquemas (``https:``,
    ``javascript:`` etc.) e controle de host — FR-008 / edge case open redirect.
    Valor inválido não é erro: o destino é sempre substituído por ``/``.
    """
    if not path or not isinstance(path, str):
        return "/"
    if not path.startswith("/") or path.startswith("//"):
        return "/"
    # Um ":" antes do primeiro "/" (depois do inicial) indicaria esquema; com o
    # prefixo "/" garantido, basta vetar retornos com backslash e caracteres de
    # controle que alguns navegadores normalizam para "//".
    if "\\" in path or any(ord(c) < 0x20 for c in path):
        return "/"
    return path


def create_flow(org_slug: str, redirect_to: Optional[str]) -> dict[str, str]:
    """Cria o fluxo de login: state/nonce/code_verifier de uso único no Redis.

    Sem Redis → ``ProviderUnavailableError`` (fail closed: um fluxo que não
    pode garantir uso único não pode existir).
    """
    r = _redis()
    if r is None:
        logger.error("Keycloak: Redis indisponível, recusando iniciar fluxo (fail closed)")
        raise ProviderUnavailableError("redis_unavailable")

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    # RFC 7636: verifier de 43–128 chars; token_urlsafe(64) ≈ 86 chars.
    code_verifier = secrets.token_urlsafe(64)
    code_challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode("ascii")).digest())
        .rstrip(b"=")
        .decode("ascii")
    )
    payload = json.dumps(
        {
            "nonce": nonce,
            "code_verifier": code_verifier,
            "org_slug": org_slug,
            "redirect_to": sanitize_redirect(redirect_to),
            "created_at": int(time.time()),
        }
    )
    try:
        r.set(f"{FLOW_KEY_PREFIX}{state}", payload, ex=FLOW_TTL_SECONDS)
    except Exception:
        logger.exception("Keycloak: erro do Redis ao gravar fluxo")
        raise ProviderUnavailableError("redis_unavailable")
    return {"state": state, "nonce": nonce, "code_challenge": code_challenge}


def consume_flow(state: str) -> Optional[dict[str, Any]]:
    """Consome o fluxo atomicamente (GETDEL): a primeira apresentação do state
    recupera e destrói o registro; replay encontra chave ausente → ``None``.

    Redis indisponível → ``ProviderUnavailableError`` (fail closed), distinto de
    state inválido.
    """
    r = _redis()
    if r is None:
        logger.error("Keycloak: Redis indisponível, recusando callback (fail closed)")
        raise ProviderUnavailableError("redis_unavailable")
    try:
        raw = r.getdel(f"{FLOW_KEY_PREFIX}{state}")
    except Exception:
        logger.exception("Keycloak: erro do Redis ao consumir fluxo")
        raise ProviderUnavailableError("redis_unavailable")
    if raw is None:
        return None
    try:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        flow = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        logger.warning("Keycloak: registro de fluxo ilegível ao consumir state")
        return None
    # Re-sanitização no consumo (defesa em profundidade — contrato §2).
    flow["redirect_to"] = sanitize_redirect(flow.get("redirect_to"))
    return flow


def get_callback_redirect_uri() -> str:
    """Redirect URI exata cadastrada no client Keycloak (rota BFF do Next.js)."""
    hosting = get_learnhouse_config().hosting_config
    scheme = "https" if hosting.ssl else "http"
    return f"{scheme}://{hosting.frontend_domain}/api/auth/keycloak/callback"


def exchange_code(code: str, code_verifier: str) -> dict[str, Any]:
    """Troca o authorization code por tokens no token_endpoint (client
    confidencial + PKCE). O corpo da resposta (tokens do provedor) nunca é
    logado.

    Recusa do provedor (``invalid_grant`` etc.) → ``CodeExchangeError`` (401);
    indisponibilidade → ``ProviderUnavailableError`` (503).
    """
    config = get_keycloak_config()
    discovery = get_discovery(config.issuer)
    try:
        response = httpx.post(
            discovery["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": get_callback_redirect_uri(),
                "client_id": config.client_id,
                "client_secret": config.client_secret,
                "code_verifier": code_verifier,
            },
            timeout=HTTP_TIMEOUT_SECONDS,
        )
    except Exception:
        logger.warning("Keycloak: token_endpoint indisponível")
        raise ProviderUnavailableError("token_endpoint_unavailable")
    if response.status_code >= 500:
        logger.warning("Keycloak: token_endpoint respondeu %s", response.status_code)
        raise ProviderUnavailableError("token_endpoint_error")
    if response.status_code != 200:
        # 400/401: código expirado/reutilizado, verifier incorreto, client inválido.
        logger.info("Keycloak: token_endpoint recusou o código (status %s)", response.status_code)
        raise CodeExchangeError()
    try:
        tokens = response.json()
    except ValueError:
        raise ProviderUnavailableError("token_endpoint_invalid")
    if "id_token" not in tokens:
        raise CodeExchangeError("id_token_missing")
    return tokens


def validate_id_token(id_token: str, nonce: str) -> dict[str, Any]:
    """Validação integral do ID token (FR-005): assinatura via JWKS, iss,
    aud/azp, exp/nbf/iat com leeway configurado e nonce do fluxo.

    Qualquer falha → ``TokenValidationError`` com a categoria (nunca o valor do
    claim). JWKS inacessível → ``ProviderUnavailableError``.
    """
    config = get_keycloak_config()
    discovery = get_discovery(config.issuer)
    try:
        signing_key = _get_jwks_client(discovery["jwks_uri"]).get_signing_key_from_jwt(
            id_token
        )
    except jwt.exceptions.PyJWKClientConnectionError:
        logger.warning("Keycloak: JWKS indisponível")
        raise ProviderUnavailableError("jwks_unavailable")
    except jwt.exceptions.PyJWKClientError:
        # kid desconhecido mesmo após a rebusca automática do PyJWKClient.
        raise TokenValidationError(FAILURE_UNKNOWN_KID)
    except jwt.exceptions.InvalidTokenError:
        raise TokenValidationError(FAILURE_MALFORMED)

    try:
        claims = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=config.client_id,
            issuer=config.issuer,
            leeway=config.clock_skew,
            options={"require": ["exp", "iat"], "verify_nbf": True},
        )
    except jwt.ExpiredSignatureError:
        raise TokenValidationError(FAILURE_EXPIRED)
    except jwt.ImmatureSignatureError:
        raise TokenValidationError(FAILURE_NOT_YET_VALID)
    except jwt.InvalidIssuerError:
        raise TokenValidationError(FAILURE_ISSUER)
    except jwt.InvalidAudienceError:
        raise TokenValidationError(FAILURE_AUDIENCE)
    except jwt.InvalidSignatureError:
        raise TokenValidationError(FAILURE_SIGNATURE)
    except jwt.InvalidTokenError:
        raise TokenValidationError(FAILURE_MALFORMED)

    # azp: obrigatório e igual ao client quando há múltiplas audiences; quando
    # presente em audience única, também deve ser o client (OIDC Core §3.1.3.7).
    aud = claims.get("aud")
    azp = claims.get("azp")
    if isinstance(aud, (list, tuple)) and len(aud) > 1:
        if azp != config.client_id:
            raise TokenValidationError(FAILURE_AZP)
    elif azp is not None and azp != config.client_id:
        raise TokenValidationError(FAILURE_AZP)

    if not nonce or claims.get("nonce") != nonce:
        raise TokenValidationError(FAILURE_NONCE)

    return claims


BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout"


def validate_logout_token(logout_token: str) -> dict[str, Any]:
    """Valida o logout token do back-channel (research R3). Caminho de
    segurança — nenhum atalho de dev/teste desabilita a validação.

    Exige: assinatura via JWKS, ``iss`` esperado, ``aud`` contém o client,
    ``iat`` recente, claim ``events`` com o evento de back-channel logout, ao
    menos um entre ``sid``/``sub``, e ``nonce`` AUSENTE (presença é rejeição).
    """
    config = get_keycloak_config()
    discovery = get_discovery(config.issuer)
    try:
        signing_key = _get_jwks_client(discovery["jwks_uri"]).get_signing_key_from_jwt(
            logout_token
        )
    except jwt.exceptions.PyJWKClientConnectionError:
        raise ProviderUnavailableError("jwks_unavailable")
    except jwt.exceptions.PyJWKClientError:
        raise TokenValidationError(FAILURE_UNKNOWN_KID)
    except jwt.exceptions.InvalidTokenError:
        raise TokenValidationError(FAILURE_MALFORMED)

    try:
        claims = jwt.decode(
            logout_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=config.client_id,
            issuer=config.issuer,
            leeway=config.clock_skew,
            options={"require": ["iat"], "verify_exp": False},
        )
    except jwt.InvalidIssuerError:
        raise TokenValidationError(FAILURE_ISSUER)
    except jwt.InvalidAudienceError:
        raise TokenValidationError(FAILURE_AUDIENCE)
    except jwt.InvalidSignatureError:
        raise TokenValidationError(FAILURE_SIGNATURE)
    except jwt.InvalidTokenError:
        raise TokenValidationError(FAILURE_MALFORMED)

    # Um logout token NUNCA carrega nonce (OIDC Back-Channel Logout §2.4).
    if "nonce" in claims:
        raise TokenValidationError(FAILURE_NONCE)
    events = claims.get("events")
    if not isinstance(events, dict) or BACKCHANNEL_LOGOUT_EVENT not in events:
        raise TokenValidationError("events_missing")
    if not claims.get("sid") and not claims.get("sub"):
        raise TokenValidationError("no_sid_or_sub")
    return claims


def refresh_upstream(refresh_token: str) -> dict[str, Any]:
    """Renova a sessão no provedor (``grant_type=refresh_token``).

    Classificação da falha (research R5): ``invalid_grant`` = rejeição
    DEFINITIVA (``CodeExchangeError``); timeout/conexão/5xx/429/``invalid_client``/
    200 malformada = TRANSITÓRIA (``ProviderUnavailableError``). Definitiva
    NUNCA é reclassificada como transitória (Princípio IV).
    """
    config = get_keycloak_config()
    discovery = get_discovery(config.issuer)
    try:
        response = httpx.post(
            discovery["token_endpoint"],
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": config.client_id,
                "client_secret": config.client_secret,
            },
            timeout=HTTP_TIMEOUT_SECONDS,
        )
    except Exception:
        raise ProviderUnavailableError("upstream_refresh_unreachable")
    if response.status_code == 200:
        try:
            tokens = response.json()
        except ValueError:
            raise ProviderUnavailableError("upstream_refresh_malformed")
        if "access_token" not in tokens:
            raise ProviderUnavailableError("upstream_refresh_malformed")
        return tokens
    # Distinção definitiva vs transitória pelo corpo de erro OAuth.
    error = ""
    try:
        error = (response.json() or {}).get("error", "")
    except ValueError:
        error = ""
    if error == "invalid_grant":
        raise CodeExchangeError("invalid_grant")  # DEFINITIVA
    # invalid_client, 5xx, 429 e demais → transitória (não derruba o usuário).
    raise ProviderUnavailableError(f"upstream_refresh_error:{response.status_code}")


def build_end_session_url(
    id_token: Optional[str], post_logout_redirect_uri: str
) -> Optional[str]:
    """URL de RP-Initiated Logout. ``id_token_hint`` quando disponível; senão
    ``client_id`` como fallback."""
    config = get_keycloak_config()
    try:
        discovery = get_discovery(config.issuer)
    except ProviderUnavailableError:
        return None
    endpoint = discovery.get("end_session_endpoint")
    if not endpoint:
        return None
    params = {"post_logout_redirect_uri": post_logout_redirect_uri}
    if id_token:
        params["id_token_hint"] = id_token
    else:
        params["client_id"] = config.client_id
    return f"{endpoint}?{httpx.QueryParams(params)}"


def build_authorization_url(
    discovery: dict[str, Any], state: str, nonce: str, code_challenge: str
) -> str:
    config = get_keycloak_config()
    params = httpx.QueryParams(
        {
            "response_type": "code",
            "client_id": config.client_id,
            "redirect_uri": get_callback_redirect_uri(),
            "scope": OIDC_SCOPES,
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"{discovery['authorization_endpoint']}?{params}"
