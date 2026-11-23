"""Add oidc_provider_config table and drop orphan ssoconnection

A tabela `ssoconnection` foi criada por a1b2c3d4e5f6 sem modelo SQLModel nem
consumidor no código (órfã confirmada), e com `auto_provision_users` default
TRUE — o oposto do padrão restritivo exigido pela spec 004. A nova
`oidc_provider_config` cobre o caso de uso com defaults seguros
(research.md §7 da feature 004-admin-config-oidc).

Revision ID: u1v2w3x4y5z6
Revises: t6u7v8w9x0y1
Create Date: 2026-08-03 21:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'u1v2w3x4y5z6'
down_revision: Union[str, None] = 't6u7v8w9x0y1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'oidc_provider_config',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'org_id',
            sa.Integer(),
            sa.ForeignKey('organization.id', ondelete='CASCADE'),
            nullable=False,
            unique=True,
        ),
        sa.Column('issuer_url', sa.String(length=2048), nullable=False),
        sa.Column('client_id', sa.String(length=255), nullable=False),
        sa.Column('client_secret_encrypted', sa.Text(), nullable=False, server_default=''),
        sa.Column(
            'scopes',
            sa.String(length=500),
            nullable=False,
            server_default='openid email profile',
        ),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('allowed_email_domains', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column(
            'auto_provision_users',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            'default_role_id',
            sa.Integer(),
            sa.ForeignKey('role.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('required_acr', sa.String(length=255), nullable=True),
        sa.Column('clock_skew_seconds', sa.Integer(), nullable=False, server_default='60'),
        sa.Column(
            'created_by_user_id',
            sa.Integer(),
            sa.ForeignKey('user.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # Descarte da órfã: sem dados de produção possíveis (nunca consumida).
    op.drop_index('ix_ssoconnection_provider', table_name='ssoconnection')
    op.drop_index('ix_ssoconnection_org_id', table_name='ssoconnection')
    op.drop_table('ssoconnection')


def downgrade() -> None:
    # Recria a ssoconnection exatamente como a1b2c3d4e5f6 a definiu.
    op.create_table(
        'ssoconnection',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'org_id',
            sa.Integer(),
            sa.ForeignKey('organization.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('domains', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column(
            'auto_provision_users',
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            'default_role_id',
            sa.Integer(),
            sa.ForeignKey('role.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('provider_config', sa.JSON(), nullable=True, server_default='{}'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_ssoconnection_org_id', 'ssoconnection', ['org_id'], unique=True)
    op.create_index('ix_ssoconnection_provider', 'ssoconnection', ['provider'])

    op.drop_table('oidc_provider_config')
