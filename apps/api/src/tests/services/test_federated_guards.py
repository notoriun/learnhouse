"""Bloqueios de conta federada (feature 007, T013 — FR-008/FR-010).

Conta federada à plataforma não troca senha nem e-mail localmente; conta
local e identidade de IdP de terceiro seguem intocadas.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from src.db.external_identities import ExternalIdentity
from src.db.users import PublicUser, User, UserUpdate, UserUpdatePassword
from src.security.security import security_hash_password
from src.services.auth import federation
from src.services.users import users as users_service

PLATFORM_ISSUER = "https://kc.plataforma.test/realms/dev"
SENHA_ANTIGA = "Antiga123!@#"
SENHA_NOVA = "NovaSenha123!@#"


@pytest.fixture
def platform_issuer(monkeypatch):
    monkeypatch.setattr(
        federation,
        "get_keycloak_config",
        lambda: SimpleNamespace(issuer=PLATFORM_ISSUER),
    )


@pytest.fixture
def rbac_ok(monkeypatch):
    monkeypatch.setattr(users_service, "rbac_check", AsyncMock())


async def _user(db, org, *, uid=50, email="fed@acme.dev"):
    user = User(
        id=uid,
        username=f"user{uid}",
        first_name="Fed",
        last_name="Erada",
        email=email,
        password=security_hash_password(SENHA_ANTIGA),
        user_uuid=f"user_{uid}",
        email_verified=True,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _identity(db, user, org, issuer=PLATFORM_ISSUER):
    db.add(
        ExternalIdentity(
            user_id=user.id,
            organization_id=org.id,
            issuer=issuer,
            subject=f"sub-{user.id}",
            provider="keycloak",
            email_at_link_time=user.email,
        )
    )
    await db.commit()


def _assert_conta_federada(excinfo):
    detail = excinfo.value.detail
    assert excinfo.value.status_code == 403
    assert detail["code"] == "CONTA_FEDERADA"
    assert detail["account_console_url"] == f"{PLATFORM_ISSUER}/account"


class TestSenha:
    async def test_conta_federada_nao_troca_senha_local(
        self, db, org, platform_issuer
    ):
        user = await _user(db, org)
        await _identity(db, user, org)

        with pytest.raises(HTTPException) as excinfo:
            await users_service.update_user_password(
                None,
                db,
                PublicUser.model_validate(user),
                user.id,
                UserUpdatePassword(old_password=SENHA_ANTIGA, new_password=SENHA_NOVA),
            )

        _assert_conta_federada(excinfo)

    async def test_conta_local_troca_senha_normalmente(
        self, db, org, platform_issuer
    ):
        user = await _user(db, org, uid=51, email="local@acme.dev")

        result = await users_service.update_user_password(
            None,
            db,
            PublicUser.model_validate(user),
            user.id,
            UserUpdatePassword(old_password=SENHA_ANTIGA, new_password=SENHA_NOVA),
        )

        assert result.id == user.id

    async def test_identidade_de_terceiro_nao_bloqueia(
        self, db, org, platform_issuer
    ):
        user = await _user(db, org, uid=52, email="terceiro@acme.dev")
        await _identity(db, user, org, issuer="https://idp.cliente.example/realms/corp")

        result = await users_service.update_user_password(
            None,
            db,
            PublicUser.model_validate(user),
            user.id,
            UserUpdatePassword(old_password=SENHA_ANTIGA, new_password=SENHA_NOVA),
        )

        assert result.id == user.id


class TestEmail:
    async def test_conta_federada_nao_troca_email_local(
        self, db, org, platform_issuer, rbac_ok
    ):
        user = await _user(db, org, uid=53)
        await _identity(db, user, org)

        with pytest.raises(HTTPException) as excinfo:
            await users_service.update_user(
                None,
                db,
                user.id,
                PublicUser.model_validate(user),
                UserUpdate(username=user.username, email="novo@acme.dev"),
            )

        _assert_conta_federada(excinfo)

    async def test_conta_federada_edita_nome_com_email_inalterado(
        self, db, org, platform_issuer, rbac_ok
    ):
        user = await _user(db, org, uid=54, email="fed2@acme.dev")
        await _identity(db, user, org)

        result = await users_service.update_user(
            None,
            db,
            user.id,
            PublicUser.model_validate(user),
            UserUpdate(
                username=user.username, email=user.email, first_name="NovoNome"
            ),
        )

        assert result.first_name == "NovoNome"

    async def test_conta_local_troca_email_normalmente(
        self, db, org, platform_issuer, rbac_ok
    ):
        user = await _user(db, org, uid=55, email="local2@acme.dev")

        result = await users_service.update_user(
            None,
            db,
            user.id,
            PublicUser.model_validate(user),
            UserUpdate(username=user.username, email="trocado@acme.dev"),
        )

        assert result.email == "trocado@acme.dev"
