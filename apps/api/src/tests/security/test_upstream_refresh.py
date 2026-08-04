"""Testes do refresh federado upstream-primeiro (feature 003, US2+US3).

Exercita o ramo federado de GET /auth/refresh: ordem upstream-primeiro,
rejeição definitiva (invalid_grant → 401 + revogação), falha transitória
(503, sessão preservada, jti desfeito) e TTL máximo absoluto.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.upstream_sessions import STATUS_ACTIVE, STATUS_EXPIRED, STATUS_REVOKED, UpstreamSession
from src.db.users import AnonymousUser, User
from src.routers.auth import router as auth_router, JWT_REFRESH_COOKIE_NAME
from src.security.auth import create_refresh_token, get_current_user
from src.security.session_context import AUTH_METHOD_SSO, session_claims
from src.services.auth import keycloak_oidc as oidc
from src.services.auth import upstream_session as upstream

ISSUER = "https://kc.test/realms/plataforma"


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

    def delete(self, *ks):
        for k in ks:
            self.store.pop(k, None)
        return True

    def setex(self, k, ttl, v):
        self.store[k] = v
        return True

    def ttl(self, k):
        return 100


@pytest.fixture
def fake_redis(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(upstream, "_redis", lambda: fake)
    # Os helpers de revogação/rotação de auth.py usam seu próprio client Redis.
    monkeypatch.setattr("src.security.auth._get_revocation_redis_client", lambda: fake)
    monkeypatch.setattr("src.routers.auth.check_refresh_rate_limit", lambda req: (True, None))
    return fake


@pytest.fixture(autouse=True)
def kc_config(monkeypatch):
    config = SimpleNamespace(
        enabled=True, issuer=ISSUER, client_id="learnhouse-web",
        client_secret="segredo", clock_skew=30,
    )
    monkeypatch.setattr(oidc, "get_keycloak_config", lambda: config)
    monkeypatch.setattr(
        oidc, "get_discovery",
        lambda issuer: {"issuer": ISSUER, "token_endpoint": f"{ISSUER}/token",
                        "jwks_uri": f"{ISSUER}/certs", "authorization_endpoint": f"{ISSUER}/auth"},
    )


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/v1/auth")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def sso_user(db):
    u = User(
        id=600, username="refuser", first_name="Ref", last_name="User",
        email="ref@acme.dev", password="h", user_uuid="user_ref600",
        email_verified=True, creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def _seed(db, user, uuid="upsession_ref", created_at=None):
    row = UpstreamSession(
        session_uuid=uuid, user_id=user.id, issuer=ISSUER, sid="sid-ref",
        upstream_refresh_encrypted=upstream.encrypt("upstream-refresh-v1"),
        status=STATUS_ACTIVE,
        created_at=created_at or datetime.now(timezone.utc),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


def _refresh_cookie(uuid="upsession_ref", email="ref@acme.dev"):
    return create_refresh_token(
        data={"sub": email, "purpose": "session",
              **session_claims(AUTH_METHOD_SSO, 1, usid=uuid)}
    )


async def _do_refresh(client, cookie):
    return await client.get(
        "/api/v1/auth/refresh", cookies={JWT_REFRESH_COOKIE_NAME: cookie}
    )


class TestRefreshUpstreamPrimeiro:
    async def test_sucesso_valida_upstream_antes_de_rotacionar(
        self, client, db, sso_user, fake_redis, monkeypatch
    ):
        row = await _seed(db, sso_user)
        chamado = {"upstream": False}

        def _refresh(rt, config=None):
            chamado["upstream"] = True
            return {"access_token": "up-access", "refresh_token": "upstream-refresh-v2"}

        monkeypatch.setattr(oidc, "refresh_upstream", _refresh)

        r = await _do_refresh(client, _refresh_cookie())

        assert r.status_code == 200
        assert chamado["upstream"] is True
        # refresh upstream rotacionado foi persistido (cifrado, novo valor)
        await db.refresh(row)
        assert upstream.decrypt(row.upstream_refresh_encrypted) == "upstream-refresh-v2"
        assert row.last_refreshed_at is not None

    async def test_invalid_grant_encerra_sessao_definitivamente(
        self, client, db, sso_user, fake_redis, monkeypatch
    ):
        row = await _seed(db, sso_user)

        def _refresh(rt, config=None):
            raise oidc.CodeExchangeError("invalid_grant")

        monkeypatch.setattr(oidc, "refresh_upstream", _refresh)

        r = await _do_refresh(client, _refresh_cookie())

        assert r.status_code == 401
        await db.refresh(row)
        assert row.status == STATUS_REVOKED
        assert row.revocation_reason == "upstream_denied"
        assert f"upstream_revoked:{row.session_uuid}" in fake_redis.store

    async def test_usid_ja_revogado_rejeita_401(
        self, client, db, sso_user, fake_redis, monkeypatch
    ):
        row = await _seed(db, sso_user)
        fake_redis.store[f"upstream_revoked:{row.session_uuid}"] = "1"
        # Não deve nem chamar o upstream.
        monkeypatch.setattr(
            oidc, "refresh_upstream", Mock(side_effect=AssertionError("não deveria chamar"))
        )

        r = await _do_refresh(client, _refresh_cookie())

        assert r.status_code == 401


class TestRefreshTransitorio:
    @pytest.mark.parametrize("cat", ["timeout", "5xx", "invalid_client"])
    async def test_falha_transitoria_preserva_sessao_e_desfaz_jti(
        self, client, db, sso_user, fake_redis, monkeypatch, cat
    ):
        row = await _seed(db, sso_user)

        def _refresh(rt, config=None):
            raise oidc.ProviderUnavailableError(f"upstream_refresh_error:{cat}")

        monkeypatch.setattr(oidc, "refresh_upstream", _refresh)

        cookie = _refresh_cookie()
        r = await _do_refresh(client, cookie)

        assert r.status_code == 503
        assert r.json()["detail"]["code"] == "UPSTREAM_UNAVAILABLE"
        # Sessão preservada (linha ativa), nada rotacionado
        await db.refresh(row)
        assert row.status == STATUS_ACTIVE
        # jti desfeito → o MESMO cookie funciona na tentativa seguinte
        refresh_keys = [k for k in fake_redis.store if k.startswith("refresh_used:")]
        assert refresh_keys == []

    async def test_definitiva_nunca_vira_503_e_transitoria_nunca_vira_401(
        self, client, db, sso_user, fake_redis, monkeypatch
    ):
        # invalid_grant → 401 (definitiva)
        await _seed(db, sso_user, uuid="upsession_a")
        monkeypatch.setattr(oidc, "refresh_upstream", Mock(side_effect=oidc.CodeExchangeError("invalid_grant")))
        r1 = await _do_refresh(client, _refresh_cookie(uuid="upsession_a"))
        assert r1.status_code == 401

        # timeout → 503 (transitória)
        await _seed(db, sso_user, uuid="upsession_b")
        monkeypatch.setattr(oidc, "refresh_upstream", Mock(side_effect=oidc.ProviderUnavailableError("t")))
        r2 = await _do_refresh(client, _refresh_cookie(uuid="upsession_b"))
        assert r2.status_code == 503


class TestTTLMaximo:
    async def test_ttl_excedido_expira_sessao(
        self, client, db, sso_user, fake_redis, monkeypatch
    ):
        # Sessão criada há 48 h; limite padrão é 24 h.
        antiga = datetime.now(timezone.utc) - timedelta(hours=48)
        row = await _seed(db, sso_user, created_at=antiga)
        # Upstream nem deve ser chamado — o TTL corta antes.
        monkeypatch.setattr(
            oidc, "refresh_upstream", Mock(side_effect=AssertionError("não deveria chamar"))
        )

        r = await _do_refresh(client, _refresh_cookie())

        assert r.status_code == 401
        await db.refresh(row)
        assert row.status == STATUS_EXPIRED
        assert row.revocation_reason == "policy_ttl"
