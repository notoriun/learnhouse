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


#: Faixas que a válvula de desenvolvimento libera — e **somente** estas.
#:
#: Não use ``ip.is_private`` para isso: em Python essa propriedade é abrangente e
#: inclui link-local (169.254.0.0/16, onde vivem os metadados de nuvem),
#: 0.0.0.0/8 e faixas reservadas. Liberar por ``is_private`` transformaria
#: qualquer instância com ``development_mode`` num oráculo de credencial de
#: nuvem — foi exatamente o que a primeira versão desta válvula fez, e o teste
#: negativo pegou.
_FAIXAS_DEV = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),  # ULA — equivalente IPv6 da RFC 1918
)


def _liberado_em_desenvolvimento(ip) -> bool:
    """True para loopback e faixas privadas de verdade, em ``development_mode``.

    Link-local, reservadas, multicast e não-especificadas seguem bloqueadas em
    qualquer modo.
    """
    # Loopback primeiro, e de propósito: em Python ``IPv6Address("::1").is_reserved``
    # é **True**, porque ``::1`` cai dentro de ``::/8``. Checar "reservado" antes
    # rejeitaria o loopback IPv6 — e ``localhost`` resolve para ``127.0.0.1`` E
    # ``::1``, então bastava um deles ser recusado para a URL inteira cair.
    if ip.is_loopback:
        return True
    if ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
        return False
    return any(ip in faixa for faixa in _FAIXAS_DEV)


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

    # Em ``development_mode`` o provedor de identidade vive no próprio compose
    # (``localhost:8080``, ou o nome do serviço numa rede 172.x), então a recusa
    # de rede interna tornava impossível exercitar localmente três coisas:
    # auto-provisionamento, o caminho feliz do registro federado e a
    # administração da configuração OIDC por organização. Mesma válvula que já
    # existe para o esquema ``http`` acima — e pela mesma razão.
    #
    # A proteção continua integral fora de desenvolvimento: é ela que impede um
    # administrador de transformar a plataforma em sonda de rede interna.
    for _, _, _, _, sockaddr in resolved:
        ip = ipaddress.ip_address(sockaddr[0])
        if development_mode and _liberado_em_desenvolvimento(ip):
            continue
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
