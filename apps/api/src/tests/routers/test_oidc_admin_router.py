"""Testes dos endpoints administrativos /api/v1/orgs/{org_id}/oidc-config
(feature 004 — contracts/admin-oidc-api.md).

RBAC obrigatório em todo endpoint (Princípio IV): 401 anônimo, 403 não-admin,
403 admin de OUTRA org. Discovery sempre mockado.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, PublicUser, User
from src.routers.oidc_admin import router as oidc_admin_router
from src.security.auth import get_current_user
from src.services.auth import oidc_config as svc

ISSUER = "https://kc.exemplo.test/realms/plataforma"

DISCOVERY_OK = {
    "issuer": ISSUER,
    "authorization_endpoint": f"{ISSUER}/protocol/openid-connect/auth",
    "token_endpoint": f"{ISSUER}/protocol/openid-connect/token",
    "jwks_uri": f"{ISSUER}/protocol/openid-connect/certs",
}

PAYLOAD_VALIDO = {
    "issuer_url": ISSUER,
    "client_id": "learnhouse-web",
    "client_secret": "segredo-canario-004",
}


@pytest.fixture(autouse=True)
def rate_limit_liberado(monkeypatch):
    """Redis não sobe em teste — mesmo padrão dos testes de webhooks."""
    monkeypatch.setattr(
        "src.routers.oidc_admin.check_oidc_config_rate_limit",
        lambda org_id, action: (True, 0),
    )


@pytest.fixture(autouse=True)
def ssrf_liberado(monkeypatch):
    monkeypatch.setattr(
        "src.services.security.url_validation.socket.getaddrinfo",
        lambda host, port, proto=None: [(2, 1, 6, "", ("93.184.216.34", 0))],
    )


@pytest.fixture(autouse=True)
def discovery_ok(monkeypatch):
    mock = Mock(return_value=SimpleNamespace(status_code=200, json=lambda: dict(DISCOVERY_OK)))
    monkeypatch.setattr(svc.httpx, "get", mock)
    return mock


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(oidc_admin_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


def _como(app, user):
    app.dependency_overrides[get_current_user] = lambda: user


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def outro_org_admin(db, other_org):
    """Admin da OUTRA org — não pode tocar a config da org 1 (Princípio IV)."""
    role = Role(
        id=77,
        name="Admin Other",
        org_id=other_org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_admin_other",
        rights={},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(role)
    u = User(
        id=71,
        username="admin-outra",
        first_name="Admin",
        last_name="Outra",
        email="admin@outra-org.com",
        password="x",
        user_uuid="user_admin_outra",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    # role_id=1 (admin) na OUTRA org
    db.add(
        UserOrganization(
            user_id=u.id,
            org_id=other_org.id,
            role_id=1,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()
    return PublicUser(
        id=u.id,
        username=u.username,
        first_name=u.first_name,
        last_name=u.last_name,
        email=u.email,
        user_uuid=u.user_uuid,
    )


class TestRBAC:
    async def test_anonimo_nao_acessa(self, app, client, org):
        _como(app, AnonymousUser())

        r = await client.get(f"/api/v1/orgs/{org.id}/oidc-config")

        assert r.status_code in (401, 403)

    async def test_nao_admin_recebe_403(self, app, client, org, regular_user):
        _como(app, regular_user)

        r_get = await client.get(f"/api/v1/orgs/{org.id}/oidc-config")
        r_put = await client.put(
            f"/api/v1/orgs/{org.id}/oidc-config", json=PAYLOAD_VALIDO
        )
        r_del = await client.delete(f"/api/v1/orgs/{org.id}/oidc-config?confirm=true")
        r_test = await client.post(f"/api/v1/orgs/{org.id}/oidc-config/test", json={})

        assert (
            r_get.status_code
            == r_put.status_code
            == r_del.status_code
            == r_test.status_code
            == 403
        )

    async def test_admin_de_outra_org_recebe_403(
        self, app, client, org, admin_user, outro_org_admin
    ):
        _como(app, outro_org_admin)

        r = await client.put(f"/api/v1/orgs/{org.id}/oidc-config", json=PAYLOAD_VALIDO)

        assert r.status_code == 403


class TestSegredoProtegido:
    """US2 (T013) — SC-002: o segredo-canário não aparece em NENHUMA resposta;
    vazamento por serialização é estruturalmente impossível."""

    CANARIO = "segredo-canario-004"

    async def test_canario_ausente_de_todas_as_respostas(
        self, app, client, org, admin_user
    ):
        _como(app, admin_user)

        r_put = await client.put(
            f"/api/v1/orgs/{org.id}/oidc-config", json=PAYLOAD_VALIDO
        )
        r_get = await client.get(f"/api/v1/orgs/{org.id}/oidc-config")
        r_test = await client.post(
            f"/api/v1/orgs/{org.id}/oidc-config/test", json={"issuer_url": ISSUER}
        )
        r_400 = await client.delete(f"/api/v1/orgs/{org.id}/oidc-config")
        r_422 = await client.put(
            f"/api/v1/orgs/{org.id}/oidc-config",
            json={**PAYLOAD_VALIDO, "client_secret": ""},
        )

        assert r_put.status_code == 200 and r_get.status_code == 200
        assert r_422.status_code == 422  # string vazia não é rotação válida
        for resposta in (r_put, r_get, r_test, r_400, r_422):
            assert self.CANARIO not in resposta.text
        assert r_get.json()["secret_configured"] is True

    def test_schema_de_leitura_nao_possui_campo_de_segredo(self):
        from src.db.oidc_provider_config import OIDCProviderConfigRead

        campos = set(OIDCProviderConfigRead.model_fields)
        assert not any("secret" in c for c in campos - {"secret_configured"})
        assert "client_secret" not in campos
        assert "client_secret_encrypted" not in campos

    async def test_enabled_true_sem_segredo_configurado_e_400(
        self, app, client, org, admin_user
    ):
        _como(app, admin_user)
        # Cria SEM segredo (payload sem client_secret) e tenta ativar.
        sem_segredo = {k: v for k, v in PAYLOAD_VALIDO.items() if k != "client_secret"}
        r_criacao = await client.put(
            f"/api/v1/orgs/{org.id}/oidc-config", json=sem_segredo
        )
        assert r_criacao.status_code == 200
        assert r_criacao.json()["secret_configured"] is False

        r_ativa = await client.put(
            f"/api/v1/orgs/{org.id}/oidc-config", json={"enabled": True}
        )

        assert r_ativa.status_code == 400
        assert r_ativa.json()["detail"]["code"] == "SEGREDO_NAO_CONFIGURADO"


class TestCRUD:
    async def test_get_404_sem_config(self, app, client, org, admin_user):
        _como(app, admin_user)

        r = await client.get(f"/api/v1/orgs/{org.id}/oidc-config")

        assert r.status_code == 404

    async def test_put_upsert_200_com_forma_do_contrato(
        self, app, client, org, admin_user
    ):
        _como(app, admin_user)

        r = await client.put(f"/api/v1/orgs/{org.id}/oidc-config", json=PAYLOAD_VALIDO)

        assert r.status_code == 200, r.text
        body = r.json()
        assert body["issuer_url"] == ISSUER
        assert body["secret_configured"] is True
        assert body["enabled"] is False
        assert "client_secret" not in body
        assert "client_secret_encrypted" not in body
        assert r.headers.get("cache-control") == "no-store"

    async def test_delete_sem_confirm_400_e_com_confirm_200(
        self, app, client, org, admin_user
    ):
        _como(app, admin_user)
        await client.put(f"/api/v1/orgs/{org.id}/oidc-config", json=PAYLOAD_VALIDO)

        r_sem = await client.delete(f"/api/v1/orgs/{org.id}/oidc-config")
        r_com = await client.delete(f"/api/v1/orgs/{org.id}/oidc-config?confirm=true")

        assert r_sem.status_code == 400
        assert r_com.status_code == 200
        assert (
            await client.get(f"/api/v1/orgs/{org.id}/oidc-config")
        ).status_code == 404

    async def test_teste_de_conexao_ok(self, app, client, org, admin_user):
        _como(app, admin_user)

        r = await client.post(
            f"/api/v1/orgs/{org.id}/oidc-config/test", json={"issuer_url": ISSUER}
        )

        assert r.status_code == 200
        assert r.json()["status"] == "ok"
        assert r.headers.get("cache-control") == "no-store"

    async def test_respostas_get_com_no_store(self, app, client, org, admin_user):
        _como(app, admin_user)
        await client.put(f"/api/v1/orgs/{org.id}/oidc-config", json=PAYLOAD_VALIDO)

        r = await client.get(f"/api/v1/orgs/{org.id}/oidc-config")

        assert r.status_code == 200
        assert r.headers.get("cache-control") == "no-store"
