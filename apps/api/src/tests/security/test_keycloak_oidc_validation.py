"""Testes do validador de ID token do Keycloak (SC-002).

Tokens assinados com RSA real (cryptography) — os testes exercitam o validador
de verdade, não um mock de ``jwt.decode``. Um teste negativo por claim chega na
US3 (T023); aqui vive o caminho feliz (T008).
"""

import time
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

import jwt

from src.services.auth import keycloak_oidc

ISSUER = "https://kc.test/realms/plataforma"
CLIENT_ID = "learnhouse-web"
NONCE = "nonce-esperado"
KID = "chave-de-teste"


@pytest.fixture(scope="module")
def rsa_key():
    """Par de chaves RSA real para assinar/validar os ID tokens de teste."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def make_id_token(private_key, *, headers=None, **overrides):
    """ID token plausível do Keycloak; ``overrides`` ajusta claims por teste."""
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": CLIENT_ID,
        "azp": CLIENT_ID,
        "exp": now + 300,
        "iat": now,
        "nbf": now,
        "nonce": NONCE,
        "sub": "f0e1d2c3-usuario",
        "email": "aluno@acme.dev",
        "email_verified": True,
        "given_name": "Aluno",
        "family_name": "Teste",
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(
        claims, private_key, algorithm="RS256", headers=headers or {"kid": KID}
    )


@pytest.fixture(autouse=True)
def oidc_env(rsa_key, monkeypatch):
    """Config, discovery e JWKS substituídos — Keycloak não sobe em teste."""
    monkeypatch.setattr(
        keycloak_oidc,
        "get_keycloak_config",
        lambda: SimpleNamespace(
            enabled=True,
            issuer=ISSUER,
            client_id=CLIENT_ID,
            client_secret="segredo-de-teste",
            clock_skew=30,
        ),
    )
    monkeypatch.setattr(
        keycloak_oidc,
        "get_discovery",
        lambda issuer: {
            "issuer": ISSUER,
            "authorization_endpoint": f"{ISSUER}/protocol/openid-connect/auth",
            "token_endpoint": f"{ISSUER}/protocol/openid-connect/token",
            "jwks_uri": f"{ISSUER}/protocol/openid-connect/certs",
        },
    )
    fake_jwks = SimpleNamespace(
        get_signing_key_from_jwt=lambda token: SimpleNamespace(
            key=rsa_key.public_key()
        )
    )
    monkeypatch.setattr(keycloak_oidc, "_get_jwks_client", lambda uri: fake_jwks)


class TestValidacaoCaminhoFeliz:
    def test_id_token_valido_e_aceito_com_claims_retornados(self, rsa_key):
        token = make_id_token(rsa_key)

        claims = keycloak_oidc.validate_id_token(token, NONCE)

        assert claims["email"] == "aluno@acme.dev"
        assert claims["email_verified"] is True
        assert claims["sub"] == "f0e1d2c3-usuario"

    def test_multiplas_audiences_com_azp_correto_e_aceito(self, rsa_key):
        token = make_id_token(
            rsa_key, aud=[CLIENT_ID, "account"], azp=CLIENT_ID
        )

        claims = keycloak_oidc.validate_id_token(token, NONCE)

        assert claims["email"] == "aluno@acme.dev"

    def test_drift_de_relogio_dentro_do_leeway_e_aceito(self, rsa_key):
        now = int(time.time())
        # iat/nbf 10 s no futuro — dentro dos 30 s de leeway configurados.
        token = make_id_token(rsa_key, iat=now + 10, nbf=now + 10)

        claims = keycloak_oidc.validate_id_token(token, NONCE)

        assert claims["email"] == "aluno@acme.dev"
