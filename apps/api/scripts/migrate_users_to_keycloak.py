"""Migração one-shot de usuários locais para o Keycloak da plataforma.

Feature 007 (contracts/migracao-cli.md). Offline por construção: o único
caminho que escreve no provedor. Idempotente — reexecução não duplica conta
nem vínculo. Hash de senha e segredos NUNCA aparecem em logs ou relatório.

Uso (de apps/api):
    uv run python scripts/migrate_users_to_keycloak.py              # simulação
    uv run python scripts/migrate_users_to_keycloak.py --execute
    uv run python scripts/migrate_users_to_keycloak.py --execute --org default
    uv run python scripts/migrate_users_to_keycloak.py --execute --reset-passwords

Ambiente: LEARNHOUSE_KEYCLOAK_ISSUER (config existente) e, para consultar/
escrever no realm, LEARNHOUSE_KC_MIGRATION_CLIENT_ID / _SECRET (client
dedicado com service account + manage-users — research §3).
"""

import argparse
import asyncio
import base64
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Optional

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ---------------------------------------------------------------------------
# Hash Argon2 (PHC) → representação de credencial do Keycloak (research §2)
# ---------------------------------------------------------------------------


def parse_argon2_phc(phc: str) -> dict:
    """Decompõe ``$argon2id$v=19$m=...,t=...,p=...$salt$digest`` (b64 sem pad)."""
    parts = (phc or "").split("$")
    if len(parts) != 6 or not parts[1].startswith("argon2"):
        raise ValueError("hash local não é Argon2/PHC")
    variant = parts[1].removeprefix("argon2")  # "id" | "i" | "d"
    version = parts[2].removeprefix("v=")
    params = dict(kv.split("=", 1) for kv in parts[3].split(","))

    def _b64(segment: str) -> bytes:
        return base64.b64decode(segment + "=" * (-len(segment) % 4))

    digest = _b64(parts[5])
    return {
        "type": variant,
        # 19 decimal == 0x13 — o provider do Keycloak fala "1.3"
        "version": "1.3" if version == "19" else version,
        "memory": int(params["m"]),
        "iterations": int(params["t"]),
        "parallelism": int(params["p"]),
        "salt_b64": base64.b64encode(_b64(parts[4])).decode(),
        "digest_b64": base64.b64encode(digest).decode(),
        "hash_len": len(digest),
    }


def kc_credential_from_phc(phc: str) -> dict:
    """CredentialRepresentation do Admin API com o hash importado."""
    p = parse_argon2_phc(phc)
    return {
        "type": "password",
        "temporary": False,
        "secretData": json.dumps({"value": p["digest_b64"], "salt": p["salt_b64"]}),
        "credentialData": json.dumps(
            {
                "hashIterations": p["iterations"],
                "algorithm": "argon2",
                "additionalParameters": {
                    "hashLength": [str(p["hash_len"])],
                    "memory": [str(p["memory"])],
                    "type": [p["type"]],
                    "version": [p["version"]],
                    "parallelism": [str(p["parallelism"])],
                },
            }
        ),
    }


# ---------------------------------------------------------------------------
# Client mínimo do Admin API (client_credentials; sem SDK novo)
# ---------------------------------------------------------------------------


class KeycloakAdmin:
    def __init__(
        self,
        issuer: str,
        client_id: str,
        client_secret: str,
        http: Optional[httpx.Client] = None,
    ):
        self.issuer = issuer.rstrip("/")
        base, sep, realm = self.issuer.rpartition("/realms/")
        if not sep:
            raise ValueError("issuer não tem o formato .../realms/<realm>")
        self.admin_base = f"{base}/admin/realms/{realm}"
        self.token_url = f"{self.issuer}/protocol/openid-connect/token"
        self.client_id = client_id
        self.client_secret = client_secret
        self.http = http or httpx.Client(timeout=15.0)
        self._token: Optional[str] = None

    def _headers(self) -> dict:
        if self._token is None:
            response = self.http.post(
                self.token_url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                },
            )
            response.raise_for_status()
            self._token = response.json()["access_token"]
        return {"Authorization": f"Bearer {self._token}"}

    def find_user_by_email(self, email: str) -> Optional[dict]:
        response = self.http.get(
            f"{self.admin_base}/users",
            params={"email": email, "exact": "true"},
            headers=self._headers(),
        )
        response.raise_for_status()
        found = response.json()
        return found[0] if found else None

    def create_user(self, representation: dict) -> str:
        """Cria o usuário e devolve o id (subject) do header Location."""
        response = self.http.post(
            f"{self.admin_base}/users",
            json=representation,
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.headers["Location"].rstrip("/").rsplit("/", 1)[-1]

    def send_reset_password_email(self, user_id: str) -> None:
        response = self.http.put(
            f"{self.admin_base}/users/{user_id}/execute-actions-email",
            json=["UPDATE_PASSWORD"],
            headers=self._headers(),
        )
        response.raise_for_status()


# ---------------------------------------------------------------------------
# Migração
# ---------------------------------------------------------------------------


@dataclass
class Relatorio:
    criados: list = field(default_factory=list)
    vinculados: list = field(default_factory=list)
    pulados: list = field(default_factory=list)  # (email, motivo)
    falhas: list = field(default_factory=list)  # (email, motivo)

    def imprimir(self, dry_run: bool) -> None:
        modo = "SIMULAÇÃO (nada foi escrito)" if dry_run else "EXECUÇÃO"
        print(f"\n=== Relatório da migração — {modo} ===")
        print(f"criados:    {len(self.criados)}")
        print(f"vinculados: {len(self.vinculados)}")
        print(f"pulados:    {len(self.pulados)}")
        print(f"falhas:     {len(self.falhas)}")
        for email, motivo in self.pulados:
            print(f"  [pulado] {email}: {motivo}")
        for email, motivo in self.falhas:
            print(f"  [FALHA]  {email}: {motivo}")


async def migrate(
    session,
    admin: Optional[KeycloakAdmin],
    platform_issuer: str,
    org_slugs: Optional[list] = None,
    dry_run: bool = True,
    reset_passwords: bool = False,
) -> Relatorio:
    """Corpo da migração. ``admin`` None só é aceito em dry-run (relatório
    apenas com o estado local, sem consultar o realm)."""
    from sqlmodel import select

    from src.db.external_identities import ExternalIdentity
    from src.db.organizations import Organization
    from src.db.user_organizations import UserOrganization
    from src.db.users import User

    issuer = platform_issuer.rstrip("/")
    relatorio = Relatorio()

    # Snapshot em dicts: commits/rollbacks no meio do loop expiram as
    # instâncias ORM e um acesso lazy depois disso estoura (MissingGreenlet).
    users = [
        {
            "id": u.id,
            "email": u.email,
            "password": u.password,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "email_verified": u.email_verified,
        }
        for u in (await session.execute(select(User))).scalars().all()
    ]
    for user in users:
        try:
            if not user["password"]:
                relatorio.pulados.append(
                    (user["email"], "sem senha local (conta social)")
                )
                continue

            rows = (
                await session.execute(
                    select(UserOrganization.org_id, Organization.slug)
                    .join(Organization, Organization.id == UserOrganization.org_id)
                    .where(UserOrganization.user_id == user["id"])
                )
            ).all()
            if org_slugs:
                rows = [r for r in rows if r[1] in org_slugs]
            if not rows:
                relatorio.pulados.append((user["email"], "fora do filtro de organizações"))
                continue

            linked_org_ids = set(
                (
                    await session.execute(
                        select(ExternalIdentity.organization_id).where(
                            ExternalIdentity.user_id == user["id"],
                            ExternalIdentity.issuer == issuer,
                        )
                    )
                )
                .scalars()
                .all()
            )
            orgs_pendentes = [r for r in rows if r[0] not in linked_org_ids]
            if not orgs_pendentes:
                relatorio.pulados.append((user["email"], "já migrado (vínculos existentes)"))
                continue

            kc_user = admin.find_user_by_email(user["email"]) if admin else None

            if dry_run:
                destino = "vinculados" if kc_user else "criados"
                getattr(relatorio, destino).append(user["email"])
                continue

            if kc_user is None:
                representation = {
                    "username": user["email"],  # e-mail é o identificador (Q2)
                    "email": user["email"],
                    "firstName": user["first_name"] or "",
                    "lastName": user["last_name"] or "",
                    "enabled": True,
                    "emailVerified": bool(user["email_verified"]),
                }
                if reset_passwords:
                    representation["requiredActions"] = ["UPDATE_PASSWORD"]
                else:
                    representation["credentials"] = [
                        kc_credential_from_phc(user["password"])
                    ]
                subject = admin.create_user(representation)
                if reset_passwords:
                    admin.send_reset_password_email(subject)
                relatorio.criados.append(user["email"])
            else:
                subject = kc_user["id"]
                relatorio.vinculados.append(user["email"])

            for org_id, _slug in orgs_pendentes:
                session.add(
                    ExternalIdentity(
                        user_id=user["id"],
                        organization_id=org_id,
                        issuer=issuer,
                        subject=subject,
                        provider="keycloak",
                        email_at_link_time=user["email"],
                    )
                )
            try:
                await session.commit()
            except Exception:
                # Corrida com outra execução: o vínculo já existe
                # (uq_externalidentity_issuer_subject) — estado final idêntico.
                await session.rollback()
        except Exception as exc:  # falha por conta não interrompe as demais
            await session.rollback()
            relatorio.falhas.append((user["email"], type(exc).__name__))
    return relatorio


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="executa de verdade (default: simulação)")
    parser.add_argument("--org", action="append", help="filtra por slug de organização (repetível)")
    parser.add_argument(
        "--reset-passwords",
        action="store_true",
        help="modo contingência: cria sem credencial + e-mail de redefinição (FR-007)",
    )
    return parser.parse_args(argv)


async def _amain(args) -> int:
    from config.config import get_learnhouse_config

    from src.core.events.database import _async_session_factory

    issuer = get_learnhouse_config().keycloak_config.issuer
    if not issuer:
        print("Erro fatal: LEARNHOUSE_KEYCLOAK_ISSUER não configurado.")
        return 2

    client_id = os.environ.get("LEARNHOUSE_KC_MIGRATION_CLIENT_ID", "")
    client_secret = os.environ.get("LEARNHOUSE_KC_MIGRATION_CLIENT_SECRET", "")
    admin: Optional[KeycloakAdmin] = None
    if client_id and client_secret:
        admin = KeycloakAdmin(issuer, client_id, client_secret)
    elif args.execute:
        print(
            "Erro fatal: --execute exige LEARNHOUSE_KC_MIGRATION_CLIENT_ID e "
            "LEARNHOUSE_KC_MIGRATION_CLIENT_SECRET."
        )
        return 2
    else:
        print("Aviso: sem credencial do realm — simulação apenas com o estado local.")

    async with _async_session_factory() as session:
        relatorio = await migrate(
            session,
            admin,
            issuer,
            org_slugs=args.org,
            dry_run=not args.execute,
            reset_passwords=args.reset_passwords,
        )
    relatorio.imprimir(dry_run=not args.execute)
    return 1 if relatorio.falhas else 0


def main() -> None:
    args = _parse_args()
    try:
        exit_code = asyncio.run(_amain(args))
    except Exception as exc:
        print(f"Erro fatal antes de iniciar: {type(exc).__name__}: {exc}")
        exit_code = 2
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
