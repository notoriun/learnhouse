"""Testes dos endpoints /api/v1/auth/keycloak/* (contracts/api-oidc.md).

Keycloak não sobe em teste: discovery/token_endpoint são monkeypatch das funções
do serviço; Redis é um fake em memória via patch de ``_redis`` (padrão dos
testes de magic link). Fluxo feliz aqui (T009); negativos na US3 (T024) e
asserções de vazamento na US2 (T019).
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.users import User
from src.routers.keycloak_auth import router as keycloak_router
from src.services.auth import keycloak_oidc

ISSUER = "https://kc.test/realms/plataforma"
CLIENT_ID = "learnhouse-web"

DISCOVERY_DOC = {
    "issuer": ISSUER,
    "authorization_endpoint": f"{ISSUER}/protocol/openid-connect/auth",
    "token_endpoint": f"{ISSUER}/protocol/openid-connect/token",
    "jwks_uri": f"{ISSUER}/protocol/openid-connect/certs",
}


class FakeRedis:
    """Fake mínimo em memória: apenas o que o serviço usa (set EX / getdel)."""

    def __init__(self):
        self.store: dict[str, str] = {}

    def set(self, key, value, ex=None, nx=False):
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True

    def getdel(self, key):
        return self.store.pop(key, None)


@pytest.fixture
def fake_redis(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(keycloak_oidc, "_redis", lambda: fake)
    return fake


@pytest.fixture
def keycloak_enabled(monkeypatch):
    config = SimpleNamespace(
        enabled=True,
        issuer=ISSUER,
        client_id=CLIENT_ID,
        client_secret="segredo-de-teste",
        clock_skew=30,
    )
    monkeypatch.setattr(keycloak_oidc, "get_keycloak_config", lambda: config)
    monkeypatch.setattr(keycloak_oidc, "get_discovery", lambda issuer: DISCOVERY_DOC)
    monkeypatch.setattr(
        keycloak_oidc,
        "get_callback_redirect_uri",
        lambda: "http://localhost:3000/api/auth/keycloak/callback",
    )
    return config


@pytest.fixture
def audit_mock(monkeypatch):
    mock = AsyncMock()
    monkeypatch.setattr("src.routers.keycloak_auth.record_audit_event", mock)
    return mock


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(keycloak_router, prefix="/api/v1/auth/keycloak")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
async def sso_user(db):
    """Usuário local pré-existente com e-mail igual ao do provedor (research §6)."""
    user = User(
        id=42,
        username="aluno",
        first_name="Aluno",
        last_name="Teste",
        email="aluno@acme.dev",
        password="hash-irrelevante",
        user_uuid="user_sso",
        email_verified=True,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


PROVIDER_CLAIMS = {
    "sub": "f0e1d2c3-usuario",
    "email": "aluno@acme.dev",
    "email_verified": True,
}


async def _start_flow(client, fake_redis, org_slug="test-org", redirect_to="/dash/cursos"):
    """Executa o authorize e devolve (state, resposta)."""
    response = await client.post(
        "/api/v1/auth/keycloak/authorize",
        json={"org_slug": org_slug, "redirect_to": redirect_to},
    )
    assert response.status_code == 200, response.text
    return response.json()["state"], response.json()


class TestStatus:
    async def test_status_enabled_para_org_com_provedor(
        self, client, org, keycloak_enabled
    ):
        response = await client.get("/api/v1/auth/keycloak/status?org=test-org")

        assert response.status_code == 200
        assert response.json() == {"enabled": True}

    async def test_status_disabled_quando_config_desligada(
        self, client, org, monkeypatch
    ):
        monkeypatch.setattr(
            keycloak_oidc,
            "get_keycloak_config",
            lambda: SimpleNamespace(
                enabled=False, issuer="", client_id="", client_secret="", clock_skew=30
            ),
        )

        response = await client.get("/api/v1/auth/keycloak/status?org=test-org")

        assert response.status_code == 200
        assert response.json() == {"enabled": False}

    async def test_status_org_desconhecida_e_disabled_sem_erro(
        self, client, keycloak_enabled
    ):
        response = await client.get("/api/v1/auth/keycloak/status?org=nao-existe")

        assert response.status_code == 200
        assert response.json() == {"enabled": False}


class TestAuthorize:
    async def test_authorize_monta_url_e_grava_fluxo(
        self, client, org, keycloak_enabled, fake_redis
    ):
        state, body = await _start_flow(client, fake_redis)

        url = body["authorization_url"]
        assert url.startswith(DISCOVERY_DOC["authorization_endpoint"])
        assert "response_type=code" in url
        assert "code_challenge_method=S256" in url
        assert "code_challenge=" in url
        assert f"state={state}" in url
        assert "nonce=" in url
        assert "scope=openid+email+profile" in url
        assert f"client_id={CLIENT_ID}" in url
        # Fluxo persistido com uso único pendente
        assert f"oidc_flow:{state}" in fake_redis.store


class TestCallbackFluxoFeliz:
    async def test_callback_emite_sessao_interna_e_consome_state(
        self, client, org, sso_user, keycloak_enabled, fake_redis, audit_mock, monkeypatch
    ):
        monkeypatch.setattr(
            keycloak_oidc, "exchange_code", lambda code, verifier: {"id_token": "opaco"}
        )
        monkeypatch.setattr(
            keycloak_oidc, "validate_id_token", lambda id_token, nonce: dict(PROVIDER_CLAIMS)
        )

        state, _ = await _start_flow(client, fake_redis)

        response = await client.post(
            "/api/v1/auth/keycloak/callback",
            json={"code": "codigo-do-provedor", "state": state},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["user"]["email"] == "aluno@acme.dev"
        assert body["tokens"]["access_token"]
        assert body["tokens"]["refresh_token"]
        assert body["redirect_to"] == "/dash/cursos"
        # State consumido — uso único
        assert f"oidc_flow:{state}" not in fake_redis.store
        # Auditoria de login com método sso, sem tokens
        audit_mock.assert_awaited()
        kwargs = audit_mock.await_args.kwargs
        assert kwargs["metadata"]["method"] == "sso"
        assert kwargs["metadata"]["provider"] == "keycloak"
