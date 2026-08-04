"""Testes do serviço de configuração OIDC (feature 004).

Discovery via httpx é sempre mockado — nenhum provedor sobe em teste.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from src.db.oidc_provider_config import OIDCProviderConfigWrite
from src.services.auth import oidc_config as svc

ISSUER = "https://kc.exemplo.test/realms/plataforma"

DISCOVERY_OK = {
    "issuer": ISSUER,
    "authorization_endpoint": f"{ISSUER}/protocol/openid-connect/auth",
    "token_endpoint": f"{ISSUER}/protocol/openid-connect/token",
    "jwks_uri": f"{ISSUER}/protocol/openid-connect/certs",
}


def _resp(status_code=200, json_data=None, raise_json=False):
    def _json():
        if raise_json:
            raise ValueError("corpo não-JSON")
        return json_data

    return SimpleNamespace(status_code=status_code, json=_json)


@pytest.fixture(autouse=True)
def ssrf_liberado(monkeypatch):
    """O anti-SSRF tem suíte própria (test_oidc_issuer_ssrf); aqui os hosts de
    teste não resolvem DNS real — resolução mockada para IP público."""
    monkeypatch.setattr(
        "src.services.security.url_validation.socket.getaddrinfo",
        lambda host, port, proto=None: [(2, 1, 6, "", ("93.184.216.34", 0))],
    )


@pytest.fixture
def discovery_ok(monkeypatch):
    mock = Mock(return_value=_resp(200, dict(DISCOVERY_OK)))
    monkeypatch.setattr(svc.httpx, "get", mock)
    return mock


async def _config_valida(db, org, admin_user, **overrides):
    payload = dict(
        issuer_url=ISSUER, client_id="learnhouse-web", client_secret="segredo-canario"
    )
    payload.update(overrides)
    return await svc.upsert_oidc_config(
        db, org.id, OIDCProviderConfigWrite(**payload), admin_user
    )


class TestUpsert:
    async def test_upsert_cria_e_retorna_forma_do_contrato(
        self, db, org, admin_user, discovery_ok
    ):
        lida = await _config_valida(db, org, admin_user)

        assert lida.org_id == org.id
        assert lida.issuer_url == ISSUER
        assert lida.secret_configured is True
        assert lida.enabled is False  # padrão restritivo
        assert lida.auto_provision_users is False

    async def test_upsert_parcial_mantem_campos_ausentes(
        self, db, org, admin_user, discovery_ok
    ):
        await _config_valida(db, org, admin_user)

        atualizada = await svc.upsert_oidc_config(
            db, org.id, OIDCProviderConfigWrite(client_id="novo-client"), admin_user
        )

        assert atualizada.client_id == "novo-client"
        assert atualizada.issuer_url == ISSUER
        assert atualizada.secret_configured is True

    async def test_issuer_normalizado_sem_barra_final(
        self, db, org, admin_user, discovery_ok
    ):
        lida = await _config_valida(db, org, admin_user, issuer_url=ISSUER + "/")

        assert lida.issuer_url == ISSUER


class TestTesteDeConexao:
    def test_timeout_e_erro_de_conexao_sao_inacessivel(self, monkeypatch):
        import httpx as httpx_real

        for exc in (httpx_real.ConnectTimeout("t"), httpx_real.ConnectError("e")):
            monkeypatch.setattr(svc.httpx, "get", Mock(side_effect=exc))
            resultado = svc.run_discovery_check(ISSUER)
            assert resultado.status == "inacessivel"
            assert resultado.detail  # mensagem pt-BR presente

    def test_5xx_e_inacessivel(self, monkeypatch):
        monkeypatch.setattr(svc.httpx, "get", Mock(return_value=_resp(503)))
        assert svc.run_discovery_check(ISSUER).status == "inacessivel"

    def test_4xx_corpo_invalido_e_redirect_sao_invalida(self, monkeypatch):
        monkeypatch.setattr(svc.httpx, "get", Mock(return_value=_resp(404)))
        assert svc.run_discovery_check(ISSUER).status == "invalida"

        monkeypatch.setattr(
            svc.httpx, "get", Mock(return_value=_resp(200, raise_json=True))
        )
        assert svc.run_discovery_check(ISSUER).status == "invalida"

        # Redirect 3xx com follow_redirects=False → invalida (SSRF via redirect)
        monkeypatch.setattr(svc.httpx, "get", Mock(return_value=_resp(302)))
        assert svc.run_discovery_check(ISSUER).status == "invalida"

    def test_campos_obrigatorios_ausentes_e_invalida(self, monkeypatch):
        incompleto = {"issuer": ISSUER, "token_endpoint": "x"}
        monkeypatch.setattr(svc.httpx, "get", Mock(return_value=_resp(200, incompleto)))
        assert svc.run_discovery_check(ISSUER).status == "invalida"

    def test_issuer_divergente_e_invalida(self, monkeypatch):
        divergente = dict(DISCOVERY_OK, issuer="https://outro.test/realms/x")
        monkeypatch.setattr(svc.httpx, "get", Mock(return_value=_resp(200, divergente)))
        assert svc.run_discovery_check(ISSUER).status == "invalida"

    def test_discovery_coerente_e_ok_com_endpoints(self, monkeypatch):
        monkeypatch.setattr(svc.httpx, "get", Mock(return_value=_resp(200, dict(DISCOVERY_OK))))

        resultado = svc.run_discovery_check(ISSUER)

        assert resultado.status == "ok"
        assert resultado.discovered_endpoints["token_endpoint"] == DISCOVERY_OK["token_endpoint"]

    def test_mensagens_distinguem_inacessivel_de_invalida(self, monkeypatch):
        import httpx as httpx_real

        monkeypatch.setattr(svc.httpx, "get", Mock(side_effect=httpx_real.ConnectError("e")))
        inacessivel = svc.run_discovery_check(ISSUER).detail
        monkeypatch.setattr(svc.httpx, "get", Mock(return_value=_resp(404)))
        invalida = svc.run_discovery_check(ISSUER).detail

        assert inacessivel != invalida


class TestCifragemERotacao:
    """US2 (T014) — Fernet no banco, rotação write-only, logs sem o canário."""

    CANARIO = "segredo-canario"

    async def test_valor_no_banco_e_ciphertext_fernet(
        self, db, org, admin_user, discovery_ok
    ):
        await _config_valida(db, org, admin_user)

        row = await svc._get_row(db, org.id)

        assert row.client_secret_encrypted.startswith("gAAAA")
        assert self.CANARIO not in row.client_secret_encrypted
        # Roundtrip: decifra só no backend
        assert svc.get_decrypted_client_secret(row) == self.CANARIO

    async def test_put_sem_client_secret_mantem_o_atual(
        self, db, org, admin_user, discovery_ok
    ):
        await _config_valida(db, org, admin_user)
        antes = (await svc._get_row(db, org.id)).client_secret_encrypted

        await svc.upsert_oidc_config(
            db, org.id, OIDCProviderConfigWrite(client_id="outro"), admin_user
        )

        depois = (await svc._get_row(db, org.id)).client_secret_encrypted
        assert depois == antes
        assert svc.get_decrypted_client_secret(await svc._get_row(db, org.id)) == self.CANARIO

    async def test_string_nao_vazia_substitui_o_segredo(
        self, db, org, admin_user, discovery_ok
    ):
        await _config_valida(db, org, admin_user)

        await svc.upsert_oidc_config(
            db,
            org.id,
            OIDCProviderConfigWrite(client_secret="segredo-rotacionado"),
            admin_user,
        )

        row = await svc._get_row(db, org.id)
        assert svc.get_decrypted_client_secret(row) == "segredo-rotacionado"

    async def test_string_vazia_e_rejeitada_pelo_schema(self):
        with pytest.raises(Exception):
            OIDCProviderConfigWrite(client_secret="")

    async def test_logs_sem_o_canario(
        self, db, org, admin_user, discovery_ok, caplog
    ):
        import logging

        caplog.set_level(logging.DEBUG)
        await _config_valida(db, org, admin_user)
        await svc.upsert_oidc_config(
            db, org.id, OIDCProviderConfigWrite(enabled=True), admin_user
        )

        assert self.CANARIO not in caplog.text


class TestPoliticasDeProvisionamento:
    """US3 (T017) — validações da política consumida pela feature 002."""

    async def test_default_role_id_inexistente_e_400(
        self, db, org, admin_user, discovery_ok
    ):
        with pytest.raises(HTTPException) as exc:
            await _config_valida(db, org, admin_user, default_role_id=9999)
        assert exc.value.status_code == 400

    async def test_default_role_de_outra_org_e_400(
        self, db, org, other_org, admin_user, discovery_ok
    ):
        from src.db.roles import Role, RoleTypeEnum

        db.add(
            Role(
                id=88,
                name="Papel Outra Org",
                org_id=other_org.id,
                role_type=RoleTypeEnum.TYPE_ORGANIZATION,
                role_uuid="role_outra",
                rights={},
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db.commit()

        with pytest.raises(HTTPException) as exc:
            await _config_valida(db, org, admin_user, default_role_id=88)
        assert exc.value.status_code == 400

    async def test_default_role_admin_ou_maintainer_e_400(
        self, db, org, admin_user, admin_role, discovery_ok
    ):
        # Menor privilégio: papel administrativo nunca é papel padrão.
        with pytest.raises(HTTPException) as exc:
            await _config_valida(db, org, admin_user, default_role_id=admin_role.id)
        assert exc.value.status_code == 400

    async def test_auto_provision_exige_default_role(
        self, db, org, admin_user, discovery_ok
    ):
        with pytest.raises(HTTPException) as exc:
            await _config_valida(db, org, admin_user, auto_provision_users=True)
        assert exc.value.status_code == 400

    async def test_auto_provision_com_papel_de_menor_privilegio_ok(
        self, db, org, admin_user, user_role, discovery_ok
    ):
        lida = await _config_valida(
            db,
            org,
            admin_user,
            auto_provision_users=True,
            default_role_id=user_role.id,
        )

        assert lida.auto_provision_users is True
        assert lida.default_role_id == user_role.id

    async def test_dominios_normalizados(self, db, org, admin_user, discovery_ok):
        lida = await _config_valida(
            db,
            org,
            admin_user,
            allowed_email_domains=["  ACME.dev ", "@acme.dev", "Outra.COM", "acme.dev"],
        )

        assert lida.allowed_email_domains == ["acme.dev", "outra.com"]

    async def test_dominio_com_formato_invalido_e_400(
        self, db, org, admin_user, discovery_ok
    ):
        with pytest.raises(HTTPException) as exc:
            await _config_valida(
                db, org, admin_user, allowed_email_domains=["nao é dominio!"]
            )
        assert exc.value.status_code == 400

    async def test_clock_skew_fora_da_faixa_e_rejeitado_pelo_schema(self):
        with pytest.raises(Exception):
            OIDCProviderConfigWrite(clock_skew_seconds=301)
        with pytest.raises(Exception):
            OIDCProviderConfigWrite(clock_skew_seconds=-1)

    async def test_get_active_entrega_politica_completa(
        self, db, org, admin_user, user_role, discovery_ok
    ):
        await _config_valida(
            db,
            org,
            admin_user,
            enabled=True,
            auto_provision_users=True,
            default_role_id=user_role.id,
            allowed_email_domains=["acme.dev"],
            required_acr="urn:acr:mfa",
            clock_skew_seconds=45,
        )

        ativa = await svc.get_active_oidc_config(db, org.id)

        assert ativa.auto_provision_users is True
        assert ativa.default_role_id == user_role.id
        assert ativa.allowed_email_domains == ["acme.dev"]
        assert ativa.required_acr == "urn:acr:mfa"
        assert ativa.clock_skew_seconds == 45


class TestConfigAtiva:
    """A parte de FR-007/SC-005 que esta feature controla: `enabled` persiste
    e é refletido pela camada de serviço (contrato com as features 001/002)."""

    async def test_get_active_retorna_config_com_enabled_true(
        self, db, org, admin_user, discovery_ok
    ):
        await _config_valida(db, org, admin_user, enabled=True)

        ativa = await svc.get_active_oidc_config(db, org.id)

        assert ativa is not None
        assert ativa.issuer_url == ISSUER

    async def test_get_active_retorna_none_com_enabled_false(
        self, db, org, admin_user, discovery_ok
    ):
        await _config_valida(db, org, admin_user, enabled=False)

        assert await svc.get_active_oidc_config(db, org.id) is None

    async def test_alternar_enabled_via_upsert_persiste(
        self, db, org, admin_user, discovery_ok
    ):
        await _config_valida(db, org, admin_user, enabled=True)
        assert await svc.get_active_oidc_config(db, org.id) is not None

        await svc.upsert_oidc_config(
            db, org.id, OIDCProviderConfigWrite(enabled=False), admin_user
        )

        assert await svc.get_active_oidc_config(db, org.id) is None
