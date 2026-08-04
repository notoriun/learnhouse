"""Testes anti-SSRF do issuer OIDC (SC-003 — feature 004).

O validador compartilhado (`src/services/security/url_validation.py`) deve
rejeitar issuers em redes privadas/internas ANTES de qualquer requisição de
discovery alcançar o destino.
"""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from src.services.security.url_validation import validate_external_https_url


def _rejeita(url: str):
    with pytest.raises(HTTPException) as exc:
        validate_external_https_url(url)
    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "URL_INVALIDA"
    return exc.value


class TestValidadorAntiSSRF:
    @pytest.mark.parametrize(
        "url",
        [
            "https://192.168.1.10/realms/x",       # faixa privada
            "https://10.0.0.5/realms/x",            # faixa privada
            "https://172.16.0.1/realms/x",          # faixa privada
            "https://localhost/realms/x",           # loopback
            "https://127.0.0.1/realms/x",           # loopback
            "https://169.254.169.254/latest/meta-data",  # link-local / metadata de nuvem
            "https://0.0.0.0/realms/x",             # não especificada
            "https://240.0.0.1/realms/x",           # reservada
            "https://224.0.0.1/realms/x",           # multicast
        ],
    )
    def test_faixas_internas_sao_rejeitadas(self, url):
        _rejeita(url)

    def test_http_rejeitado_fora_de_development_mode(self, monkeypatch):
        monkeypatch.setattr(
            "src.services.security.url_validation.get_learnhouse_config",
            lambda: SimpleNamespace(
                general_config=SimpleNamespace(development_mode=False)
            ),
        )
        _rejeita("http://exemplo-externo.test/realms/x")

    def test_http_aceito_em_development_mode_para_host_externo(self, monkeypatch):
        monkeypatch.setattr(
            "src.services.security.url_validation.get_learnhouse_config",
            lambda: SimpleNamespace(
                general_config=SimpleNamespace(development_mode=True)
            ),
        )
        # Host externo público (resolução mockada para IP público).
        monkeypatch.setattr(
            "src.services.security.url_validation.socket.getaddrinfo",
            lambda host, port, proto=None: [(2, 1, 6, "", ("93.184.216.34", 0))],
        )
        validate_external_https_url("http://kc.exemplo-dev.test/realms/x")

    def test_hostname_que_resolve_para_ip_privado_e_rejeitado(self, monkeypatch):
        # Ex.: metadata.google.internal ou DNS rebinding — o nome é público,
        # mas resolve para dentro.
        monkeypatch.setattr(
            "src.services.security.url_validation.socket.getaddrinfo",
            lambda host, port, proto=None: [(2, 1, 6, "", ("169.254.169.254", 0))],
        )
        erro = _rejeita("https://metadata.google.internal/computeMetadata")
        # A mensagem não pode ecoar o endereço interno resolvido.
        assert "169.254" not in str(erro.detail)

    def test_url_sem_host_e_esquema_invalido(self):
        _rejeita("https://")
        _rejeita("javascript:alert(1)")
        _rejeita("")


class TestSSRFNoServico:
    """O PUT de configuração valida o issuer ANTES de persistir e ANTES de
    qualquer discovery — nenhuma requisição sai para destino interno."""

    async def test_issuer_privado_rejeitado_sem_discovery_nem_persistencia(
        self, db, org, admin_user, monkeypatch
    ):
        from src.db.oidc_provider_config import OIDCProviderConfigWrite
        from src.services.auth import oidc_config as svc

        guarda_http = Mock(
            side_effect=AssertionError("discovery alcançou o destino em caso SSRF")
        )
        monkeypatch.setattr(svc.httpx, "get", guarda_http)

        with pytest.raises(HTTPException) as exc:
            await svc.upsert_oidc_config(
                db,
                org.id,
                OIDCProviderConfigWrite(
                    issuer_url="https://192.168.1.10/realms/interno",
                    client_id="c",
                    client_secret="s",
                ),
                admin_user,
            )

        assert exc.value.status_code == 400
        guarda_http.assert_not_called()
        assert await svc.read_oidc_config(db, org.id) is None
