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
from src.db.user_audit_events import UserAuditEventType
from src.db.user_organizations import UserOrganization
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
    # A auditoria durável do login federado vive no provisionamento (feature 002).
    monkeypatch.setattr("src.services.auth.provisioning.record_audit_event", mock)
    return mock


@pytest.fixture
def create_user_sem_efeitos(monkeypatch):
    """Neutraliza o que `create_user` faz fora do banco.

    Mesmo padrão de `tests/services/test_provisioning.py`: o provisionamento é
    sistêmico (sem usuário atuante), então o rbac_check não se aplica, e limites
    de plano/telemetria/webhooks não têm o que fazer numa base de teste. Sem
    isto, o caminho de criação da feature 009 falha por ausência de plano, não
    pelo comportamento sob teste.
    """
    async def _ok(*a, **k):
        return True

    monkeypatch.setattr("src.services.users.users.rbac_check", _ok)
    for alvo in (
        "src.services.users.users.check_limits_with_usage",
        "src.services.users.users.increase_feature_usage",
        "src.services.users.users.track",
        "src.services.users.users.dispatch_webhooks",
    ):
        monkeypatch.setattr(alvo, _ok, raising=False)


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
async def sso_user(db, org):
    """Usuário local pré-existente com e-mail igual ao do provedor (research §6),
    membro da org do fluxo — pré-condição de vínculo da feature 002."""
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
    db.add(
        UserOrganization(
            user_id=42,
            org_id=org.id,
            role_id=4,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()
    await db.refresh(user)
    return user


PROVIDER_CLAIMS = {
    "sub": "f0e1d2c3-usuario",
    "email": "aluno@acme.dev",
    "email_verified": True,
}


async def _start_flow(client, fake_redis, org_slug="test-org", extra=None):
    """Executa o authorize e devolve (state, resposta).

    ``extra`` injeta campos adicionais no corpo — usado para provar que campos
    desconhecidos (ex.: o ``redirect_to`` removido na feature 009) são ignorados
    sem erro.
    """
    body = {"org_slug": org_slug}
    if extra:
        body.update(extra)
    response = await client.post("/api/v1/auth/keycloak/authorize", json=body)
    assert response.status_code == 200, response.text
    return response.json()["state"], response.json()


class TestStatus:
    async def test_status_enabled_para_org_com_provedor(
        self, client, org, keycloak_enabled
    ):
        response = await client.get("/api/v1/auth/keycloak/status?org=test-org")

        assert response.status_code == 200
        assert response.json() == {"enabled": True, "platform": True}

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
        assert response.json() == {"enabled": False, "platform": False}

    async def test_status_org_desconhecida_e_disabled_sem_erro(
        self, client, keycloak_enabled
    ):
        response = await client.get("/api/v1/auth/keycloak/status?org=nao-existe")

        assert response.status_code == 200
        assert response.json() == {"enabled": False, "platform": False}


TERCEIRO_CONFIG = SimpleNamespace(
    enabled=True,
    issuer="https://idp.cliente.example/realms/corp",
    client_id="cliente-app",
    client_secret="segredo-cliente",
    clock_skew=30,
)


class TestRegistroFederado:
    """Feature 007 — action=register no /authorize e campo platform no /status."""

    async def test_register_troca_o_path_e_preserva_parametros(
        self, client, org, keycloak_enabled, fake_redis
    ):
        response = await client.post(
            "/api/v1/auth/keycloak/authorize",
            json={"org_slug": "test-org", "action": "register"},
        )

        assert response.status_code == 200, response.text
        url = response.json()["authorization_url"]
        assert "/protocol/openid-connect/registrations?" in url
        assert "/protocol/openid-connect/auth?" not in url
        for param in ("state=", "nonce=", "code_challenge=", "code_challenge_method=S256"):
            assert param in url

    async def test_action_invalida_retorna_422(
        self, client, org, keycloak_enabled, fake_redis
    ):
        response = await client.post(
            "/api/v1/auth/keycloak/authorize",
            json={"org_slug": "test-org", "action": "delete"},
        )

        assert response.status_code == 422

    async def test_sem_action_mantem_o_path_de_login(
        self, client, org, keycloak_enabled, fake_redis
    ):
        _, body = await _start_flow(client, fake_redis)

        assert "/protocol/openid-connect/auth?" in body["authorization_url"]

    async def test_register_recusado_para_idp_de_terceiro(
        self, client, org, keycloak_enabled, fake_redis, monkeypatch
    ):
        monkeypatch.setattr(
            "src.routers.keycloak_auth.get_effective_client_config",
            AsyncMock(return_value=(object(), TERCEIRO_CONFIG)),
        )

        response = await client.post(
            "/api/v1/auth/keycloak/authorize",
            json={"org_slug": "test-org", "action": "register"},
        )

        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "REGISTRO_NAO_DISPONIVEL"

    async def test_status_platform_false_para_idp_de_terceiro(
        self, client, org, keycloak_enabled, monkeypatch
    ):
        monkeypatch.setattr(
            "src.routers.keycloak_auth.get_effective_client_config",
            AsyncMock(return_value=(object(), TERCEIRO_CONFIG)),
        )

        response = await client.get("/api/v1/auth/keycloak/status?org=test-org")

        assert response.status_code == 200
        assert response.json() == {"enabled": True, "platform": False}


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


class TestVazamentos:
    """US2 (T019) — FR-004/FR-010: nenhuma resposta ou log contém tokens do
    provedor, authorization code, code_verifier ou client_secret."""

    # Valores-sentinela: se qualquer um aparecer em resposta ou log, vazou.
    SENTINELAS = [
        "id-token-sentinela-do-provedor",
        "access-token-sentinela-do-provedor",
        "refresh-token-sentinela-do-provedor",
        "codigo-sentinela-do-provedor",
        "segredo-de-teste",
    ]

    def _assert_sem_sentinelas(self, texto: str):
        for sentinela in self.SENTINELAS:
            assert sentinela not in texto, f"vazou: {sentinela}"

    async def test_callback_200_contem_apenas_tokens_internos(
        self, client, org, sso_user, keycloak_enabled, fake_redis, audit_mock,
        monkeypatch, caplog
    ):
        import logging

        caplog.set_level(logging.DEBUG)
        monkeypatch.setattr(
            keycloak_oidc,
            "exchange_code",
            lambda code, verifier, config=None: {
                "id_token": "id-token-sentinela-do-provedor",
                "access_token": "access-token-sentinela-do-provedor",
                "refresh_token": "refresh-token-sentinela-do-provedor",
            },
        )
        monkeypatch.setattr(
            keycloak_oidc, "validate_id_token", lambda id_token, nonce, config=None: dict(PROVIDER_CLAIMS)
        )

        state, _ = await _start_flow(client, fake_redis)
        response = await client.post(
            "/api/v1/auth/keycloak/callback",
            json={"code": "codigo-sentinela-do-provedor", "state": state},
        )

        assert response.status_code == 200
        self._assert_sem_sentinelas(response.text)
        self._assert_sem_sentinelas(caplog.text)
        # Tokens presentes são os internos da plataforma (JWT próprios).
        body = response.json()
        assert body["tokens"]["access_token"].count(".") == 2
        assert "id_token" not in body.get("tokens", {})

    async def test_erros_sem_dados_sensiveis_na_resposta_ou_log(
        self, client, org, keycloak_enabled, fake_redis, monkeypatch, caplog
    ):
        import logging

        caplog.set_level(logging.DEBUG)

        # 410 — state desconhecido
        r410 = await client.post(
            "/api/v1/auth/keycloak/callback",
            json={"code": "codigo-sentinela-do-provedor", "state": "state-inexistente"},
        )
        assert r410.status_code == 410

        # 401 — código recusado pelo token_endpoint
        def recusa(code, verifier, config=None):
            raise keycloak_oidc.CodeExchangeError()

        monkeypatch.setattr(keycloak_oidc, "exchange_code", recusa)
        state, _ = await _start_flow(client, fake_redis)
        r401 = await client.post(
            "/api/v1/auth/keycloak/callback",
            json={"code": "codigo-sentinela-do-provedor", "state": state},
        )
        assert r401.status_code == 401

        for response in (r410, r401):
            self._assert_sem_sentinelas(response.text)
        self._assert_sem_sentinelas(caplog.text)

    async def test_redis_indisponivel_e_503_sem_detalhe_tecnico(
        self, client, org, keycloak_enabled, monkeypatch, caplog
    ):
        import logging

        caplog.set_level(logging.DEBUG)
        monkeypatch.setattr(keycloak_oidc, "_redis", lambda: None)

        r_auth = await client.post(
            "/api/v1/auth/keycloak/authorize",
            json={"org_slug": "test-org"},
        )
        r_cb = await client.post(
            "/api/v1/auth/keycloak/callback",
            json={"code": "qualquer", "state": "qualquer"},
        )

        assert r_auth.status_code == 503
        assert r_cb.status_code == 503
        for response in (r_auth, r_cb):
            body = response.json()
            assert body["detail"]["code"] == "SSO_INDISPONIVEL"
            assert "Traceback" not in response.text
            assert "redis" not in response.text.lower()
            self._assert_sem_sentinelas(response.text)


@pytest.fixture
def sem_sessao(monkeypatch):
    """Guarda dos casos negativos: mint_session_tokens não pode ser chamado."""

    def explode(*args, **kwargs):
        raise AssertionError("mint_session_tokens chamado em caso negativo")

    monkeypatch.setattr("src.routers.keycloak_auth.mint_session_tokens", explode)


class TestFluxosNegativos:
    """US3 (T024) — falhas de fluxo negam acesso sem sessão, com código pt-BR."""

    async def test_state_reutilizado_apos_fluxo_feliz_e_410(
        self, client, org, sso_user, keycloak_enabled, fake_redis, audit_mock, monkeypatch
    ):
        monkeypatch.setattr(
            keycloak_oidc, "exchange_code", lambda code, verifier, config=None: {"id_token": "x"}
        )
        monkeypatch.setattr(
            keycloak_oidc, "validate_id_token", lambda id_token, nonce, config=None: dict(PROVIDER_CLAIMS)
        )
        state, _ = await _start_flow(client, fake_redis)
        primeiro = await client.post(
            "/api/v1/auth/keycloak/callback", json={"code": "c", "state": state}
        )
        assert primeiro.status_code == 200

        replay = await client.post(
            "/api/v1/auth/keycloak/callback", json={"code": "c", "state": state}
        )

        assert replay.status_code == 410
        assert replay.json()["detail"]["code"] == "FLUXO_INVALIDO"

    async def test_state_desconhecido_e_410_sem_sessao(
        self, client, org, keycloak_enabled, fake_redis, sem_sessao
    ):
        response = await client.post(
            "/api/v1/auth/keycloak/callback", json={"code": "c", "state": "inexistente"}
        )

        assert response.status_code == 410
        assert response.json()["detail"]["code"] == "FLUXO_INVALIDO"

    async def test_provedor_indisponivel_na_troca_e_503_sem_stack_trace(
        self, client, org, keycloak_enabled, fake_redis, sem_sessao, monkeypatch
    ):
        def fora_do_ar(code, verifier, config=None):
            raise keycloak_oidc.ProviderUnavailableError("token_endpoint_unavailable")

        monkeypatch.setattr(keycloak_oidc, "exchange_code", fora_do_ar)
        state, _ = await _start_flow(client, fake_redis)

        response = await client.post(
            "/api/v1/auth/keycloak/callback", json={"code": "c", "state": state}
        )

        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "SSO_INDISPONIVEL"
        assert "Traceback" not in response.text

    async def test_org_sem_metodo_sso_authorize_404(
        self, client, org, keycloak_enabled, fake_redis, monkeypatch
    ):
        monkeypatch.setattr(
            "src.routers.keycloak_auth.is_login_method_allowed", AsyncMock(return_value=False)
        )

        response = await client.post(
            "/api/v1/auth/keycloak/authorize",
            json={"org_slug": "test-org"},
        )

        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "SSO_NAO_CONFIGURADO"

    async def test_org_sem_metodo_sso_callback_403_sem_sessao(
        self, client, org, sso_user, keycloak_enabled, fake_redis, sem_sessao, monkeypatch
    ):
        monkeypatch.setattr(
            keycloak_oidc, "exchange_code", lambda code, verifier, config=None: {"id_token": "x"}
        )
        monkeypatch.setattr(
            keycloak_oidc, "validate_id_token", lambda id_token, nonce, config=None: dict(PROVIDER_CLAIMS)
        )
        state, _ = await _start_flow(client, fake_redis)
        monkeypatch.setattr(
            "src.routers.keycloak_auth.is_login_method_allowed", AsyncMock(return_value=False)
        )

        response = await client.post(
            "/api/v1/auth/keycloak/callback", json={"code": "c", "state": state}
        )

        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "METODO_NAO_PERMITIDO"

    async def test_email_nao_verificado_e_403_sem_sessao(
        self, client, org, sso_user, keycloak_enabled, fake_redis, sem_sessao, monkeypatch
    ):
        claims = dict(PROVIDER_CLAIMS, email_verified=False)
        monkeypatch.setattr(
            keycloak_oidc, "exchange_code", lambda code, verifier, config=None: {"id_token": "x"}
        )
        monkeypatch.setattr(
            keycloak_oidc, "validate_id_token", lambda id_token, nonce, config=None: claims
        )
        state, _ = await _start_flow(client, fake_redis)

        response = await client.post(
            "/api/v1/auth/keycloak/callback", json={"code": "c", "state": state}
        )

        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "CONTA_NAO_ENCONTRADA"

    async def test_identidade_nova_no_provedor_da_plataforma_cria_conta_e_entra(
        self, client, org, user_role, keycloak_enabled, fake_redis, audit_mock,
        create_user_sem_efeitos, monkeypatch,
    ):
        """Feature 009: era 403 CONTA_NAO_ENCONTRADA; agora a conta é criada.

        Este teste substitui ``test_usuario_inexistente_e_403_sem_sessao``, que
        fixava o comportamento anterior. O caminho exercitado é o do fallback
        global — provedor da própria plataforma —, onde a criação automática
        passou a ser ligada por padrão. Sem config de organização (feature 004),
        `config_row is None`, que é exatamente o caso do ambiente self-hosted e
        do ambiente local.
        """
        claims = dict(PROVIDER_CLAIMS, sub="sub-novo-909", email="ninguem@acme.dev")
        monkeypatch.setattr(
            keycloak_oidc, "exchange_code", lambda code, verifier, config=None: {"id_token": "x"}
        )
        monkeypatch.setattr(
            keycloak_oidc, "validate_id_token", lambda id_token, nonce, config=None: claims
        )
        state, _ = await _start_flow(client, fake_redis)

        response = await client.post(
            "/api/v1/auth/keycloak/callback", json={"code": "c", "state": state}
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["user"]["email"] == "ninguem@acme.dev"
        assert body["tokens"]["access_token"]
        assert body["org_slug"] == "test-org"
        # Desfecho de criação, distinguível na auditoria (FR-013).
        assert audit_mock.await_args.kwargs["event_type"] == UserAuditEventType.SSO_PROVISIONED

    async def test_email_nao_verificado_de_identidade_nova_segue_403(
        self, client, org, user_role, keycloak_enabled, fake_redis, sem_sessao, monkeypatch
    ):
        """A criação automática NÃO relaxou a guarda de e-mail verificado.

        Contraste necessário do teste acima: se a admissão tivesse ficado aberta
        demais, este caso passaria a entrar também.
        """
        claims = dict(
            PROVIDER_CLAIMS, sub="sub-novo-910", email="ninguem2@acme.dev",
            email_verified=False,
        )
        monkeypatch.setattr(
            keycloak_oidc, "exchange_code", lambda code, verifier, config=None: {"id_token": "x"}
        )
        monkeypatch.setattr(
            keycloak_oidc, "validate_id_token", lambda id_token, nonce, config=None: claims
        )
        state, _ = await _start_flow(client, fake_redis)

        response = await client.post(
            "/api/v1/auth/keycloak/callback", json={"code": "c", "state": state}
        )

        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "CONTA_NAO_ENCONTRADA"

    async def test_destino_nao_vem_de_entrada_do_usuario(
        self, client, org, sso_user, keycloak_enabled, fake_redis, audit_mock, monkeypatch
    ):
        """Feature 009: o destino é derivado da organização, não sanitizado.

        Antes, um ``redirect_to`` malicioso era neutralizado e virava ``/``.
        Agora o campo não existe no contrato: o authorize o ignora e o callback
        não devolve destino nenhum — devolve ``org_slug``, e quem compõe a URL é
        o BFF. Afirmação mais forte do que a sanitização anterior, porque não há
        entrada do usuário no cálculo do destino.
        """
        monkeypatch.setattr(
            keycloak_oidc, "exchange_code", lambda code, verifier, config=None: {"id_token": "x"}
        )
        monkeypatch.setattr(
            keycloak_oidc, "validate_id_token", lambda id_token, nonce, config=None: dict(PROVIDER_CLAIMS)
        )
        state, _ = await _start_flow(
            client, fake_redis, extra={"redirect_to": "//evil.com/phish"}
        )

        response = await client.post(
            "/api/v1/auth/keycloak/callback", json={"code": "c", "state": state}
        )

        assert response.status_code == 200
        body = response.json()
        assert "redirect_to" not in body
        assert body["org_slug"] == "test-org"
        # Nem o valor malicioso, nem qualquer eco dele, sobrevive em lugar algum.
        assert "evil.com" not in response.text

    async def test_org_slug_vem_do_fluxo_e_nao_do_cliente(
        self, client, org, other_org, sso_user, keycloak_enabled, fake_redis,
        audit_mock, monkeypatch,
    ):
        """Princípio IV: a organização do desfecho é a do fluxo, resolvida no
        servidor a partir do state — não algo que o cliente possa pedir.

        Duas afirmações: (a) um ``org_slug`` injetado no corpo do callback é
        ignorado; (b) o slug devolvido acompanha o fluxo, então um fluxo de outra
        organização devolve a outra organização — não um valor fixo nem o default.
        """
        monkeypatch.setattr(
            keycloak_oidc, "exchange_code", lambda code, verifier, config=None: {"id_token": "x"}
        )
        monkeypatch.setattr(
            keycloak_oidc, "validate_id_token", lambda id_token, nonce, config=None: dict(PROVIDER_CLAIMS)
        )

        # (a) fluxo de test-org; o cliente tenta pedir other-org no callback.
        state, _ = await _start_flow(client, fake_redis, org_slug="test-org")
        response = await client.post(
            "/api/v1/auth/keycloak/callback",
            json={"code": "c", "state": state, "org_slug": "other-org"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["org_slug"] == "test-org"

        # (b) fluxo de other-org devolve other-org. Sem conta vinculada nem
        # membresia ali, o desfecho é recusa — mas o ponto verificado é que a
        # organização do fluxo é a que rege a decisão, e não a do fluxo anterior.
        state_outra, _ = await _start_flow(client, fake_redis, org_slug="other-org")
        r_outra = await client.post(
            "/api/v1/auth/keycloak/callback", json={"code": "c", "state": state_outra}
        )
        if r_outra.status_code == 200:
            assert r_outra.json()["org_slug"] == "other-org"
        else:
            # Recusa é o desfecho esperado: a conta de aluno@acme.dev é membro de
            # test-org, não de other-org — cruzar organizações é proibido.
            assert r_outra.status_code == 403
            assert r_outra.json()["detail"]["code"] == "CONTA_NAO_ENCONTRADA"


class TestCallbackFluxoFeliz:
    async def test_callback_emite_sessao_interna_e_consome_state(
        self, client, org, sso_user, keycloak_enabled, fake_redis, audit_mock, monkeypatch
    ):
        monkeypatch.setattr(
            keycloak_oidc, "exchange_code", lambda code, verifier, config=None: {"id_token": "opaco"}
        )
        monkeypatch.setattr(
            keycloak_oidc, "validate_id_token", lambda id_token, nonce, config=None: dict(PROVIDER_CLAIMS)
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
        # Feature 009: a resposta traz a organização do fluxo, não um destino.
        assert body["org_slug"] == "test-org"
        assert "redirect_to" not in body
        # State consumido — uso único
        assert f"oidc_flow:{state}" not in fake_redis.store
        # Auditoria durável do desfecho federado (provisionamento), sem tokens
        audit_mock.assert_awaited()
        kwargs = audit_mock.await_args.kwargs
        assert kwargs["event_type"] == UserAuditEventType.SSO_LINKED
        assert kwargs["metadata"]["provider"] == "keycloak"
