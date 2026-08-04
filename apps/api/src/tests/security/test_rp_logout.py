"""Testes do RP-Initiated Logout e do back-channel logout (feature 003).

Keycloak não sobe em teste: discovery/JWKS via monkeypatch; Redis via fake.
"""

import time
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
import jwt
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.upstream_sessions import STATUS_ACTIVE, STATUS_REVOKED, UpstreamSession
from src.db.users import User
from src.routers.keycloak_auth import router as kc_router
from src.services.auth import keycloak_oidc as oidc
from src.services.auth import upstream_session as upstream

ISSUER = "https://kc.test/realms/plataforma"
CLIENT_ID = "learnhouse-web"
KID = "kid-logout"

DISCOVERY = {
    "issuer": ISSUER,
    "authorization_endpoint": f"{ISSUER}/auth",
    "token_endpoint": f"{ISSUER}/token",
    "jwks_uri": f"{ISSUER}/certs",
    "end_session_endpoint": f"{ISSUER}/logout",
}


class FakeRedis:
    def __init__(self):
        self.store = {}

    def set(self, k, v, ex=None, nx=False):
        if nx and k in self.store:
            return None
        self.store[k] = v
        return True

    def get(self, k):
        return self.store.get(k)

    def getdel(self, k):
        return self.store.pop(k, None)

    def setex(self, k, ttl, v):
        self.store[k] = v
        return True


@pytest.fixture(scope="module")
def rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def fake_redis(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(upstream, "_redis", lambda: fake)
    return fake


@pytest.fixture(autouse=True)
def kc_config(monkeypatch, rsa_key):
    config = SimpleNamespace(
        enabled=True, issuer=ISSUER, client_id=CLIENT_ID,
        client_secret="segredo", clock_skew=30,
    )
    monkeypatch.setattr(oidc, "get_keycloak_config", lambda: config)
    monkeypatch.setattr(oidc, "get_discovery", lambda issuer: dict(DISCOVERY))
    fake_jwks = SimpleNamespace(
        get_signing_key_from_jwt=lambda t: SimpleNamespace(key=rsa_key.public_key())
    )
    monkeypatch.setattr(oidc, "_get_jwks_client", lambda uri: fake_jwks)


@pytest.fixture
def audit_mock(monkeypatch):
    mock = AsyncMock()
    monkeypatch.setattr("src.routers.keycloak_auth.record_audit_event", mock)
    return mock


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(kc_router, prefix="/api/v1/auth/keycloak")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def sso_user(db):
    u = User(
        id=500, username="ssouser", first_name="Sso", last_name="User",
        email="sso@acme.dev", password="h", user_uuid="user_sso500",
        email_verified=True, creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def _seed_session(db, user, session_uuid="upsession_abc", sid="sid-1"):
    row = UpstreamSession(
        session_uuid=session_uuid, user_id=user.id, issuer=ISSUER, sid=sid,
        upstream_refresh_encrypted=upstream.encrypt("upstream-refresh"),
        id_token_encrypted=upstream.encrypt("id-token-hint"),
        status=STATUS_ACTIVE,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


def _session_token(session_uuid="upsession_abc", email="sso@acme.dev"):
    from src.security.auth import create_access_token
    from src.security.session_context import AUTH_METHOD_SSO, session_claims

    return create_access_token(
        data={"sub": email, "purpose": "session",
              **session_claims(AUTH_METHOD_SSO, 1, usid=session_uuid)}
    )


def _logout_token(rsa_key, **over):
    now = int(time.time())
    claims = {
        "iss": ISSUER, "aud": CLIENT_ID, "iat": now, "jti": f"jti-{now}",
        "sid": "sid-1",
        "events": {oidc.BACKCHANNEL_LOGOUT_EVENT: {}},
    }
    claims.update(over)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, rsa_key, algorithm="RS256", headers={"kid": KID})


class TestRPLogout:
    async def test_logout_revoga_local_e_upstream_e_devolve_end_session(
        self, client, db, sso_user, fake_redis, audit_mock, monkeypatch
    ):
        row = await _seed_session(db, sso_user)
        monkeypatch.setattr(
            "src.routers.keycloak_auth.security_get_user", AsyncMock(return_value=sso_user)
        )
        monkeypatch.setattr("src.routers.keycloak_auth.revoke_user_sessions_before", Mock())

        token = _session_token()
        r = await client.post(
            "/api/v1/auth/keycloak/logout", headers={"Authorization": f"Bearer {token}"}
        )

        assert r.status_code == 200
        assert r.headers.get("cache-control") == "no-store"
        url = r.json()["end_session_url"]
        assert url.startswith(DISCOVERY["end_session_endpoint"])
        assert "id_token_hint=" in url
        assert "post_logout_redirect_uri=" in url
        # upstream_session revogada + chave Redis + segredos anulados
        await db.refresh(row)
        assert row.status == STATUS_REVOKED
        assert row.revocation_reason == "user_logout"
        assert row.upstream_refresh_encrypted is None
        assert f"upstream_revoked:{row.session_uuid}" in fake_redis.store

    async def test_logout_sem_sessao_valida_responde_200_sem_url(
        self, client, fake_redis
    ):
        r = await client.post("/api/v1/auth/keycloak/logout")

        assert r.status_code == 200
        assert r.json()["end_session_url"] is None

    async def test_logout_nao_vaza_tokens_do_provedor(
        self, client, db, sso_user, fake_redis, audit_mock, monkeypatch
    ):
        await _seed_session(db, sso_user)
        monkeypatch.setattr(
            "src.routers.keycloak_auth.security_get_user", AsyncMock(return_value=sso_user)
        )
        monkeypatch.setattr("src.routers.keycloak_auth.revoke_user_sessions_before", Mock())

        token = _session_token()
        r = await client.post(
            "/api/v1/auth/keycloak/logout", headers={"Authorization": f"Bearer {token}"}
        )

        # id_token_hint aparece na URL (é o propósito), mas o refresh upstream não.
        assert "upstream-refresh" not in r.text


class TestBackchannelLogout:
    async def test_logout_token_valido_revoga_por_sid(
        self, client, db, sso_user, fake_redis, audit_mock, rsa_key
    ):
        row = await _seed_session(db, sso_user)

        r = await client.post(
            "/api/v1/auth/keycloak/backchannel-logout",
            data={"logout_token": _logout_token(rsa_key)},
        )

        assert r.status_code == 200
        assert r.json()["revoked"] == 1
        await db.refresh(row)
        assert row.status == STATUS_REVOKED
        assert row.revocation_reason == "backchannel"
        assert f"upstream_revoked:{row.session_uuid}" in fake_redis.store

    async def test_sessao_desconhecida_e_no_op_idempotente(
        self, client, db, fake_redis, audit_mock, rsa_key
    ):
        r = await client.post(
            "/api/v1/auth/keycloak/backchannel-logout",
            data={"logout_token": _logout_token(rsa_key, sid="sid-inexistente")},
        )

        assert r.status_code == 200
        assert r.json()["revoked"] == 0

    async def test_reprocessar_sessao_ja_revogada_e_no_op(
        self, client, db, sso_user, fake_redis, audit_mock, rsa_key
    ):
        await _seed_session(db, sso_user)
        primeiro = await client.post(
            "/api/v1/auth/keycloak/backchannel-logout",
            data={"logout_token": _logout_token(rsa_key)},
        )
        assert primeiro.json()["revoked"] == 1

        segundo = await client.post(
            "/api/v1/auth/keycloak/backchannel-logout",
            data={"logout_token": _logout_token(rsa_key)},
        )
        assert segundo.status_code == 200
        assert segundo.json()["revoked"] == 0

    @pytest.mark.parametrize(
        "override",
        [
            {"iss": "https://kc-malicioso.test/realms/x"},  # iss errado
            {"aud": "outro-client"},                         # aud errado
            {"events": {}},                                  # events ausente
            {"nonce": "presente"},                           # nonce presente
            {"sid": None, "sub": None},                      # sem sid e sem sub
        ],
    )
    async def test_logout_token_invalido_400_sem_efeito(
        self, client, db, sso_user, fake_redis, audit_mock, rsa_key, override
    ):
        row = await _seed_session(db, sso_user)

        r = await client.post(
            "/api/v1/auth/keycloak/backchannel-logout",
            data={"logout_token": _logout_token(rsa_key, **override)},
        )

        assert r.status_code == 400
        assert r.text == '""' or r.text == "" or '"detail":""' in r.text
        # ZERO efeito sobre sessões (SC-005)
        await db.refresh(row)
        assert row.status == STATUS_ACTIVE

    async def test_assinatura_invalida_400_sem_efeito(
        self, client, db, sso_user, fake_redis, audit_mock
    ):
        row = await _seed_session(db, sso_user)
        outra_chave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        token = _logout_token(outra_chave)

        r = await client.post(
            "/api/v1/auth/keycloak/backchannel-logout", data={"logout_token": token}
        )

        assert r.status_code == 400
        await db.refresh(row)
        assert row.status == STATUS_ACTIVE
