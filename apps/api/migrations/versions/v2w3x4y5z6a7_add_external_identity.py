"""Add external_identity table and make user_audit_event.user_id nullable

Feature 002-identidade-provisionamento. Cria a tabela ``externalidentity``
(identidade federada única por issuer+subject) e, no mesmo PR (Princípio III),
torna ``user_audit_event.user_id`` anulável — eventos ``sso_*`` de negação/
conflito ocorrem antes de existir conta (research.md §8).

NÃO toca a órfã ``ssoconnection`` (DROP é da migração da feature 004).

Revision ID: v2w3x4y5z6a7
Revises: u1v2w3x4y5z6
Create Date: 2026-08-03 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'v2w3x4y5z6a7'
down_revision: Union[str, None] = 'u1v2w3x4y5z6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'externalidentity',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'user_id',
            sa.Integer(),
            sa.ForeignKey('user.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'organization_id',
            sa.Integer(),
            sa.ForeignKey('organization.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('issuer', sa.String(length=2048), nullable=False),
        sa.Column('subject', sa.String(length=255), nullable=False),
        sa.Column('provider', sa.String(length=50), nullable=False, server_default='keycloak'),
        sa.Column('email_at_link_time', sa.String(length=320), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('issuer', 'subject', name='uq_externalidentity_issuer_subject'),
    )
    op.create_index('ix_externalidentity_user_id', 'externalidentity', ['user_id'])
    op.create_index('ix_externalidentity_organization_id', 'externalidentity', ['organization_id'])

    # Eventos sso_* de negação/conflito precedem a existência de conta.
    op.alter_column('user_audit_event', 'user_id', existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    op.alter_column('user_audit_event', 'user_id', existing_type=sa.Integer(), nullable=False)
    op.drop_index('ix_externalidentity_organization_id', table_name='externalidentity')
    op.drop_index('ix_externalidentity_user_id', table_name='externalidentity')
    op.drop_table('externalidentity')
