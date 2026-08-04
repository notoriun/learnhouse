"""Testes do serviço de provisionamento federado (feature 002).

Chamam ``provision_federated_login`` diretamente com fixtures de
``FederatedClaims`` e ``ProvisioningPolicy`` — sem fluxo OIDC completo
(Nota de Integração do tasks.md).
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import func, select

from src.db.external_identities import ExternalIdentity
from src.db.user_audit_events import UserAuditEvent
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.auth import provisioning as prov
from src.services.auth.provisioning import (
    FederatedClaims,
    ProvisioningConflict,
    ProvisioningDenied,
    ProvisioningPolicy,
    ProvisioningSuccess,
    provision_federated_login,
)

ISSUER = "https://kc.test/realms/plataforma"


def claims(**over):
    base = dict(
        issuer=ISSUER,
        subject="sub-abc-123",
        email="novo@acme.dev",
        email_verified=True,
        given_name="Novo",
        family_name="Aluno",
    )
    base.update(over)
    return FederatedClaims(**base)


def policy(**over):
    base = dict(auto_provision=True, allow_link_by_email=True, default_role_id=4)
    base.update(over)
    return ProvisioningPolicy(**base)


async def _count(db, model):
    return len((await db.execute(select(model))).scalars().all())


async def _events(db, event_type=None):
    rows = (await db.execute(select(UserAuditEvent))).scalars().all()
    return [r for r in rows if event_type is None or r.event_type == event_type]


@pytest.fixture
async def audit_to_test_db(monkeypatch, db):
    """record_audit_event usa uma sessão isolada própria; nos testes,
    redireciona para a sessão de teste em memória."""
    async def _fake(**kwargs):
        # replica o filtro real de user_id opcional
        from src.services.audit.audit import _USER_OPTIONAL_EVENT_TYPES

        if not kwargs.get("user_id") and kwargs["event_type"] not in _USER_OPTIONAL_EVENT_TYPES:
            return
        db.add(
            UserAuditEvent(
                event_type=kwargs["event_type"],
                user_id=kwargs.get("user_id"),
                org_id=kwargs.get("org_id"),
                audit_metadata=kwargs.get("metadata") or {},
            )
        )
        await db.commit()

    monkeypatch.setattr(prov, "record_audit_event", _fake)


@pytest.fixture(autouse=True)
def bypass_rbac(monkeypatch):
    """create_user faz rbac_check; o provisionamento é sistêmico (sem usuário
    atuante) — o bypass segue o padrão dos testes de OAuth."""
    async def _ok(*a, **k):
        return True

    monkeypatch.setattr("src.services.users.users.rbac_check", _ok)
    # Efeitos colaterais externos de create_user, neutralizados em teste:
    for alvo in (
        "src.services.users.users.check_limits_with_usage",
        "src.services.users.users.increase_feature_usage",
        "src.services.users.users.track",
        "src.services.users.users.dispatch_webhooks",
    ):
        monkeypatch.setattr(alvo, _ok, raising=False)


async def _provision(db, c, org, pol, request=None):
    return await provision_federated_login(db, request, c, org, policy=pol)


# ---------------------------------------------------------------------------
# US1 — Primeiro acesso com provisionamento automático
# ---------------------------------------------------------------------------


class TestUS1Provisionamento:
    async def test_primeiro_acesso_conforme_cria_conta_e_vinculo(
        self, db, org, user_role, audit_to_test_db
    ):
        result = await _provision(db, claims(), org, policy(default_role_id=user_role.id))

        assert isinstance(result, ProvisioningSuccess)
        assert result.outcome == "provisioned"
        assert result.user.signup_method == "sso"
        assert result.user.email_verified is True
        # ExternalIdentity criada com email_at_link_time (auditoria)
        ext = (await db.execute(select(ExternalIdentity))).scalars().first()
        assert ext.issuer == ISSUER and ext.subject == "sub-abc-123"
        assert ext.email_at_link_time == "novo@acme.dev"
        # Membership com papel de menor privilégio (nunca 1/2)
        uo = (await db.execute(select(UserOrganization))).scalars().first()
        assert uo.role_id == user_role.id
        assert uo.role_id not in (1, 2)
        # Evento sso_provisioned sem tokens
        eventos = await _events(db, "sso_provisioned")
        assert len(eventos) == 1
        assert "token" not in str(eventos[0].audit_metadata).lower()

    async def test_email_nao_verificado_nega_sem_escrita(
        self, db, org, user_role, audit_to_test_db
    ):
        result = await _provision(
            db, claims(email_verified=False), org, policy(default_role_id=user_role.id)
        )

        assert isinstance(result, ProvisioningDenied)
        assert result.reason == "email_nao_verificado"
        assert await _count(db, User) == 0
        assert await _count(db, ExternalIdentity) == 0
        assert await _count(db, UserOrganization) == 0

    async def test_auto_provision_desativado_nega(
        self, db, org, user_role, audit_to_test_db
    ):
        result = await _provision(
            db, claims(), org, policy(auto_provision=False, default_role_id=user_role.id)
        )

        assert isinstance(result, ProvisioningDenied)
        assert result.reason == "auto_provision_desativado"
        assert await _count(db, User) == 0

    async def test_politica_padrao_e_restritiva(self, db, org, audit_to_test_db):
        # Política default (sem configuração) não provisiona.
        result = await _provision(db, claims(), org, ProvisioningPolicy())

        assert isinstance(result, ProvisioningDenied)
        assert result.reason == "auto_provision_desativado"

    async def test_dominio_nao_permitido_nega_e_audita_so_dominio(
        self, db, org, user_role, audit_to_test_db
    ):
        result = await _provision(
            db,
            claims(email="alguem@fora.com"),
            org,
            policy(allowed_email_domains=["acme.dev"], default_role_id=user_role.id),
        )

        assert isinstance(result, ProvisioningDenied)
        assert result.reason == "dominio_nao_permitido"
        assert await _count(db, User) == 0
        eventos = await _events(db, "sso_login_denied")
        assert len(eventos) == 1
        # Só o domínio no metadata, nunca o e-mail completo
        meta = str(eventos[0].audit_metadata)
        assert "fora.com" in meta
        assert "alguem@fora.com" not in meta

    async def test_lista_de_dominios_vazia_nao_restringe(
        self, db, org, user_role, audit_to_test_db
    ):
        result = await _provision(
            db,
            claims(email="qualquer@dominio.com"),
            org,
            policy(allowed_email_domains=[], default_role_id=user_role.id),
        )

        assert isinstance(result, ProvisioningSuccess)


# ---------------------------------------------------------------------------
# US2 — Identidade estável mesmo com troca de e-mail
# ---------------------------------------------------------------------------


async def _seed_provisioned(db, org, user_role):
    """Provisiona um usuário e devolve (user, identity)."""
    result = await provision_federated_login(
        db, None, claims(), org, policy(default_role_id=user_role.id)
    )
    assert isinstance(result, ProvisioningSuccess)
    return result.user, result.external_identity


class TestUS2IdentidadeEstavel:
    async def test_troca_de_email_mantem_a_mesma_conta(
        self, db, org, user_role, audit_to_test_db
    ):
        user, _ = await _seed_provisioned(db, org, user_role)
        antes = await _count(db, User)

        # Mesmo issuer+subject, e-mail NOVO no provedor.
        result = await _provision(
            db, claims(email="novo-email@acme.dev"), org, policy(default_role_id=user_role.id)
        )

        assert isinstance(result, ProvisioningSuccess)
        assert result.outcome == "login"
        assert result.user.id == user.id
        assert await _count(db, User) == antes  # zero conta nova
        # email_at_link_time inalterado (identidade não migra por e-mail)
        assert result.external_identity.email_at_link_time == "novo@acme.dev"
        eventos = await _events(db, "login")
        assert any(e.audit_metadata.get("email_changed") for e in eventos)

    async def test_subject_novo_com_email_antigo_nao_acessa_conta_alheia(
        self, db, org, user_role, audit_to_test_db
    ):
        # Dona original do e-mail.
        user, _ = await _seed_provisioned(db, org, user_role)

        # Novo subject (pessoa diferente) chega com o MESMO e-mail.
        result = await _provision(
            db,
            claims(subject="sub-outra-pessoa", email="novo@acme.dev"),
            org,
            policy(default_role_id=user_role.id),
        )

        # Nunca cai na conta da dona original por e-mail.
        if isinstance(result, ProvisioningSuccess):
            assert result.user.id != user.id
        else:
            assert isinstance(result, ProvisioningConflict)

    async def test_usuario_bloqueado_nega_sem_recriar(
        self, db, org, user_role, audit_to_test_db
    ):
        user, _ = await _seed_provisioned(db, org, user_role)
        # Bloqueia a conta.
        user.locked_until = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        db.add(user)
        await db.commit()
        antes = await _count(db, User)

        result = await _provision(db, claims(), org, policy(default_role_id=user_role.id))

        assert isinstance(result, ProvisioningDenied)
        assert result.reason == "usuario_desativado"
        assert await _count(db, User) == antes


# ---------------------------------------------------------------------------
# US3 — Vínculo seguro a conta pré-existente
# ---------------------------------------------------------------------------


async def _seed_native_user(db, org, role_id, email="nativo@acme.dev"):
    """Conta nativa pré-existente com membership na org."""
    u = User(
        username="nativo",
        first_name="Nativo",
        last_name="User",
        email=email,
        password="hash",
        user_uuid="user_nativo",
        email_verified=True,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    db.add(
        UserOrganization(
            user_id=u.id, org_id=org.id, role_id=role_id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
    )
    await db.commit()
    return u


class TestUS3VinculoSeguro:
    async def test_email_verificado_coincidente_vincula_conta_existente(
        self, db, org, user_role, audit_to_test_db
    ):
        nativo = await _seed_native_user(db, org, user_role.id)
        antes = await _count(db, User)

        result = await _provision(
            db,
            claims(email="nativo@acme.dev"),
            org,
            policy(allow_link_by_email=True, auto_provision=True, default_role_id=user_role.id),
        )

        assert isinstance(result, ProvisioningSuccess)
        assert result.outcome == "linked"
        assert result.user.id == nativo.id
        assert await _count(db, User) == antes  # sem conta nova
        assert len(await _events(db, "sso_linked")) == 1

    async def test_email_nao_verificado_nao_vincula(
        self, db, org, user_role, audit_to_test_db
    ):
        await _seed_native_user(db, org, user_role.id)

        result = await _provision(
            db,
            claims(email="nativo@acme.dev", email_verified=False),
            org,
            policy(allow_link_by_email=True, default_role_id=user_role.id),
        )

        assert isinstance(result, ProvisioningDenied)
        assert result.reason == "email_nao_verificado"
        assert await _count(db, ExternalIdentity) == 0

    async def test_conflito_email_em_outra_organizacao(
        self, db, org, other_org, user_role, audit_to_test_db
    ):
        # Conta nativa existe, mas SEM membership na org do fluxo.
        u = User(
            username="deoutra", first_name="De", last_name="Outra",
            email="nativo@acme.dev", password="h", user_uuid="user_deoutra",
            email_verified=True, creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(u)
        await db.commit()

        result = await _provision(
            db, claims(email="nativo@acme.dev"), org,
            policy(allow_link_by_email=True, default_role_id=user_role.id),
        )

        assert isinstance(result, ProvisioningConflict)
        assert result.reason == "email_em_outra_organizacao"
        eventos = await _events(db, "sso_conflict")
        assert len(eventos) == 1 and eventos[0].user_id is None
        assert await _count(db, ExternalIdentity) == 0

    async def test_conflito_politica_nega_vinculo(
        self, db, org, user_role, audit_to_test_db
    ):
        await _seed_native_user(db, org, user_role.id)

        result = await _provision(
            db, claims(email="nativo@acme.dev"), org,
            policy(allow_link_by_email=False, auto_provision=True, default_role_id=user_role.id),
        )

        assert isinstance(result, ProvisioningConflict)
        assert result.reason == "email_conflito_politica"
        assert await _count(db, ExternalIdentity) == 0

    async def test_conflito_identidade_do_mesmo_issuer_outro_subject(
        self, db, org, user_role, audit_to_test_db
    ):
        nativo = await _seed_native_user(db, org, user_role.id)
        # Nativo já tem uma identidade do mesmo issuer (subject A).
        db.add(
            ExternalIdentity(
                user_id=nativo.id, organization_id=org.id,
                issuer=ISSUER, subject="sub-A", provider="keycloak",
                email_at_link_time="nativo@acme.dev",
            )
        )
        await db.commit()

        # Chega o MESMO e-mail com subject B → conflito.
        result = await _provision(
            db, claims(subject="sub-B", email="nativo@acme.dev"), org,
            policy(allow_link_by_email=True, default_role_id=user_role.id),
        )

        assert isinstance(result, ProvisioningConflict)
        assert result.reason == "identidade_conflitante"


# ---------------------------------------------------------------------------
# US4 — Comprovação do reúso do mecanismo de sessão interno (sem código novo)
# ---------------------------------------------------------------------------


class TestUS4ReusoDeSessao:
    """FR-009: a sessão federada usa o MESMO mecanismo do login nativo. Estes
    testes comprovam o reúso do chokepoint — nenhum código de sessão é criado
    por esta feature (research.md §6)."""

    def test_sessao_sso_carrega_amr_sso_e_org(self):
        from src.security.auth import decode_jwt
        from src.security.session_context import AMR_CLAIM, AUTH_METHOD_SSO, SORG_CLAIM
        from src.services.auth.session import mint_session_tokens

        issue = mint_session_tokens("aluno@acme.dev", amr=AUTH_METHOD_SSO, org_id=7)

        payload = decode_jwt(issue.access_token)
        assert payload[AMR_CLAIM] == "sso"
        assert str(payload[SORG_CLAIM]) == "7"
        assert payload["purpose"] == "session"

    def test_refresh_sso_tem_jti_e_purpose_session(self):
        """O refresh token federado é estruturalmente idêntico ao nativo — flui
        pelo mesmo caminho de rotação/replay de /auth/refresh (FR-010)."""
        from src.security.auth import decode_jwt
        from src.security.session_context import AUTH_METHOD_SSO
        from src.services.auth.session import mint_session_tokens

        issue = mint_session_tokens("aluno@acme.dev", amr=AUTH_METHOD_SSO, org_id=7)

        refresh = decode_jwt(issue.refresh_token)
        assert refresh["purpose"] == "session"
        assert refresh.get("jti")  # jti presente → rotação/replay já cobertos
