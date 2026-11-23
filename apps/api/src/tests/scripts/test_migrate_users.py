"""Testes da migração one-shot para o Keycloak (feature 007, T009).

O Admin API é um stub em memória (contrato de ``KeycloakAdmin``); a camada
httpx real é coberta à parte com ``httpx.MockTransport``. Banco: sqlite em
memória do conftest.
"""

import base64
import importlib.util
import json
import pathlib
from datetime import datetime

import httpx
import pytest
from sqlmodel import select

from src.db.external_identities import ExternalIdentity
from src.db.user_organizations import UserOrganization
from src.db.users import User

_SCRIPT = (
    pathlib.Path(__file__).resolve().parents[3] / "scripts" / "migrate_users_to_keycloak.py"
)
_spec = importlib.util.spec_from_file_location("migrate_users_to_keycloak", _SCRIPT)
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)

ISSUER = "https://kc.plataforma.test/realms/dev"

_SALT = base64.b64encode(b"sal-de-teste-123").decode().rstrip("=")
_DIGEST = base64.b64encode(b"d" * 32).decode().rstrip("=")
PHC = f"$argon2id$v=19$m=65536,t=3,p=4${_SALT}${_DIGEST}"


class FakeAdmin:
    """Stub do contrato de KeycloakAdmin usado por migrate()."""

    def __init__(self, existing=None, fail_for=None):
        self.existing = dict(existing or {})  # email -> subject
        self.fail_for = set(fail_for or ())
        self.created: list[dict] = []
        self.reset_emails: list[str] = []

    def find_user_by_email(self, email):
        if email in self.fail_for:
            raise RuntimeError("boom")
        if email in self.existing:
            return {"id": self.existing[email]}
        return None

    def create_user(self, representation):
        self.created.append(representation)
        subject = f"kc-{representation['email']}"
        self.existing[representation["email"]] = subject
        return subject

    def send_reset_password_email(self, user_id):
        self.reset_emails.append(user_id)


async def _local_user(db, org, email, *, uid, password=PHC):
    user = User(
        id=uid,
        username=email.split("@")[0],
        first_name="Usuária",
        last_name="Local",
        email=email,
        password=password,
        user_uuid=f"user_{uid}",
        email_verified=True,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(user)
    db.add(
        UserOrganization(
            user_id=uid,
            org_id=org.id,
            role_id=4,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()
    return user


async def _links(db):
    return (await db.execute(select(ExternalIdentity))).scalars().all()


def test_parse_phc_extrai_parametros():
    parsed = mig.parse_argon2_phc(PHC)

    assert parsed["type"] == "id"
    assert parsed["version"] == "1.3"
    assert parsed["memory"] == 65536
    assert parsed["iterations"] == 3
    assert parsed["parallelism"] == 4
    assert base64.b64decode(parsed["salt_b64"]) == b"sal-de-teste-123"
    assert parsed["hash_len"] == 32


def test_parse_phc_recusa_hash_nao_argon2():
    with pytest.raises(ValueError):
        mig.parse_argon2_phc("$2b$12$abcdefg")  # bcrypt


class TestMigrate:
    async def test_conta_nova_criada_com_credencial_e_vinculo(self, db, org):
        await _local_user(db, org, "ana@acme.dev", uid=10)
        admin = FakeAdmin()

        rel = await mig.migrate(db, admin, ISSUER, dry_run=False)

        assert rel.criados == ["ana@acme.dev"] and not rel.falhas
        rep = admin.created[0]
        assert rep["username"] == "ana@acme.dev"  # e-mail é o identificador (Q2)
        cred = json.loads(rep["credentials"][0]["credentialData"])
        assert cred["algorithm"] == "argon2"
        links = await _links(db)
        assert len(links) == 1
        assert links[0].issuer == ISSUER and links[0].subject == "kc-ana@acme.dev"
        assert links[0].provider == "keycloak"

    async def test_email_existente_no_realm_apenas_vincula(self, db, org):
        await _local_user(db, org, "bia@acme.dev", uid=11)
        admin = FakeAdmin(existing={"bia@acme.dev": "sub-bia"})

        rel = await mig.migrate(db, admin, ISSUER, dry_run=False)

        assert rel.vinculados == ["bia@acme.dev"] and not admin.created
        links = await _links(db)
        assert len(links) == 1 and links[0].subject == "sub-bia"

    async def test_sem_senha_local_e_pulada(self, db, org):
        await _local_user(db, org, "social@acme.dev", uid=12, password="")

        rel = await mig.migrate(db, FakeAdmin(), ISSUER, dry_run=False)

        assert [e for e, _ in rel.pulados] == ["social@acme.dev"]
        assert not await _links(db)

    async def test_falha_em_uma_conta_nao_interrompe_as_demais(self, db, org):
        await _local_user(db, org, "quebra@acme.dev", uid=13)
        await _local_user(db, org, "segue@acme.dev", uid=14)
        admin = FakeAdmin(fail_for={"quebra@acme.dev"})

        rel = await mig.migrate(db, admin, ISSUER, dry_run=False)

        assert [e for e, _ in rel.falhas] == ["quebra@acme.dev"]
        assert rel.criados == ["segue@acme.dev"]

    async def test_reexecucao_e_idempotente(self, db, org):
        await _local_user(db, org, "ana@acme.dev", uid=15)
        admin = FakeAdmin()

        await mig.migrate(db, admin, ISSUER, dry_run=False)
        rel2 = await mig.migrate(db, admin, ISSUER, dry_run=False)

        assert [m for _, m in rel2.pulados] == ["já migrado (vínculos existentes)"]
        assert len(admin.created) == 1
        assert len(await _links(db)) == 1

    async def test_dry_run_nao_escreve_nada(self, db, org):
        await _local_user(db, org, "ana@acme.dev", uid=16)
        admin = FakeAdmin()

        rel = await mig.migrate(db, admin, ISSUER, dry_run=True)

        assert rel.criados == ["ana@acme.dev"]
        assert not admin.created and not await _links(db)

    async def test_filtro_por_org(self, db, org, other_org):
        await _local_user(db, org, "dentro@acme.dev", uid=17)
        await _local_user(db, other_org, "fora@acme.dev", uid=18)
        admin = FakeAdmin()

        rel = await mig.migrate(
            db, admin, ISSUER, org_slugs=["test-org"], dry_run=False
        )

        assert rel.criados == ["dentro@acme.dev"]
        assert [e for e, _ in rel.pulados] == ["fora@acme.dev"]

    async def test_reset_passwords_cria_sem_credencial_e_dispara_email(self, db, org):
        await _local_user(db, org, "ana@acme.dev", uid=19)
        admin = FakeAdmin()

        rel = await mig.migrate(
            db, admin, ISSUER, dry_run=False, reset_passwords=True
        )

        assert rel.criados == ["ana@acme.dev"]
        rep = admin.created[0]
        assert "credentials" not in rep
        assert rep["requiredActions"] == ["UPDATE_PASSWORD"]
        assert admin.reset_emails == ["kc-ana@acme.dev"]


class TestKeycloakAdminHttp:
    """Camada httpx real do client mínimo (token + busca + criação)."""

    def _client(self):
        def handler(request: httpx.Request) -> httpx.Response:
            path = request.url.path
            if path.endswith("/protocol/openid-connect/token"):
                assert b"client_credentials" in request.content
                return httpx.Response(200, json={"access_token": "tok"})
            if path.endswith("/admin/realms/dev/users") and request.method == "GET":
                assert request.headers["Authorization"] == "Bearer tok"
                if request.url.params.get("email") == "existe@acme.dev":
                    return httpx.Response(200, json=[{"id": "sub-1"}])
                return httpx.Response(200, json=[])
            if path.endswith("/admin/realms/dev/users") and request.method == "POST":
                return httpx.Response(
                    201,
                    headers={"Location": f"{request.url}/novo-id"},
                )
            raise AssertionError(f"rota inesperada: {request.method} {path}")

        http = httpx.Client(transport=httpx.MockTransport(handler))
        return mig.KeycloakAdmin(
            "https://kc.test/realms/dev", "learnhouse-migration", "segredo", http=http
        )

    def test_busca_por_email(self):
        admin = self._client()

        assert admin.find_user_by_email("existe@acme.dev") == {"id": "sub-1"}
        assert admin.find_user_by_email("nao@acme.dev") is None

    def test_criacao_devolve_subject_do_location(self):
        admin = self._client()

        subject = admin.create_user({"email": "x@acme.dev", "username": "x@acme.dev"})

        assert subject == "novo-id"

    def test_issuer_sem_realms_e_erro(self):
        with pytest.raises(ValueError):
            mig.KeycloakAdmin("https://kc.test/sem-realm", "a", "b", http=httpx.Client())
