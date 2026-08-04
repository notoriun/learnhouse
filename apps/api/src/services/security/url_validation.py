"""Validação anti-SSRF de URLs externas configuradas por administradores.

Extraído do padrão de ``_validate_webhook_url``
(``src/services/webhooks/webhooks.py``) e endurecido para a configuração OIDC
(feature 004): HTTPS obrigatório fora de ``development_mode`` e bloqueio das
faixas multicast e não especificada, além das privadas/loopback/link-local/
reservadas. Mensagens em pt-BR; endereços internos resolvidos NUNCA são
ecoados nas mensagens de erro.
"""

import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import HTTPException, status

from config.config import get_learnhouse_config


def validate_external_https_url(url: str) -> None:
    """Rejeita (400) URLs que não sejam destinos externos legítimos.

    Regras: esquema HTTPS (HTTP aceito apenas em ``development_mode``),
    hostname presente e resolvível, e nenhum endereço resolvido em faixa
    privada, loopback, link-local, reservada, multicast ou não especificada —
    o que bloqueia ``localhost``, redes internas e endpoints de metadados de
    nuvem (ex.: 169.254.169.254).
    """
    parsed = urlparse(url or "")

    development_mode = bool(
        get_learnhouse_config().general_config.development_mode
    )
    allowed_schemes = ("https", "http") if development_mode else ("https",)
    if parsed.scheme not in allowed_schemes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "URL_INVALIDA",
                "message": "O endereço deve usar HTTPS.",
            },
        )

    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "URL_INVALIDA",
                "message": "O endereço não possui um host válido.",
            },
        )

    try:
        resolved = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "URL_INVALIDA",
                "message": "Não foi possível resolver o host informado.",
            },
        )

    for _, _, _, _, sockaddr in resolved:
        ip = ipaddress.ip_address(sockaddr[0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            # ponytail: mensagem genérica de propósito — o IP interno resolvido
            # não é ecoado para não virar oráculo de rede.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "URL_INVALIDA",
                    "message": (
                        "O endereço aponta para uma rede privada ou interna e "
                        "não pode ser utilizado."
                    ),
                },
            )
