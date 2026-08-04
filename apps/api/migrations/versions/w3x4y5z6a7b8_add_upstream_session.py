"""Add upstream_session table

Feature 003-logout-revogacao. Vínculo durável entre a cadeia de sessão local
(claim ``usid``) e a sessão do provedor (``issuer`` + ``sid``), para logout
coordenado e revogação. Migração no mesmo PR do modelo (Princípio III).

Revision ID: w3x4y5z6a7b8
Revises: v2w3x4y5z6a7
Create Date: 2026-08-03 22:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'w3x4y5z6a7b8'
down_revision: Union[str, None] = 'v2w3x4y5z6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'upstream_session',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('session_uuid', sa.String(length=64), nullable=False),
        sa.Column(
            'user_id',
            sa.Integer(),
            sa.ForeignKey('user.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'external_identity_id',
            sa.Integer(),
            sa.ForeignKey('externalidentity.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column(
            'org_id',
            sa.Integer(),
            sa.ForeignKey('organization.id', ondelete='CASCADE'),
            nullable=True,
        ),
        sa.Column('issuer', sa.Text(), nullable=False),
        sa.Column('sid', sa.String(length=255), nullable=True),
        sa.Column('upstream_refresh_encrypted', sa.Text(), nullable=True),
        sa.Column('id_token_encrypted', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='active'),
        sa.Column('revocation_reason', sa.String(length=32), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('last_refreshed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('uq_upstream_session_uuid', 'upstream_session', ['session_uuid'], unique=True)
    op.create_index('ix_upstream_session_issuer_sid', 'upstream_session', ['issuer', 'sid'])
    op.create_index('ix_upstream_session_user_status', 'upstream_session', ['user_id', 'status'])


def downgrade() -> None:
    op.drop_index('ix_upstream_session_user_status', table_name='upstream_session')
    op.drop_index('ix_upstream_session_issuer_sid', table_name='upstream_session')
    op.drop_index('uq_upstream_session_uuid', table_name='upstream_session')
    op.drop_table('upstream_session')
