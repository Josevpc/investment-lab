"""plano do aporte do mes

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-17 14:30:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('contribution') as batch:
        batch.add_column(sa.Column('reserve_cents', sa.Integer(), server_default=sa.text('0'), nullable=False))
        batch.add_column(sa.Column('mode', sa.String(length=12), nullable=True))
        batch.add_column(sa.Column('plan_name', sa.String(length=60), nullable=True))
    op.create_table('contribution_item',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('contribution_id', sa.Integer(), nullable=False),
    sa.Column('class_id', sa.Integer(), nullable=False),
    sa.Column('amount_cents', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['class_id'], ['asset_class.id'], ),
    sa.ForeignKeyConstraint(['contribution_id'], ['contribution.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('contribution_id', 'class_id', name='uq_contribution_item')
    )
    op.create_index(op.f('ix_contribution_item_contribution_id'), 'contribution_item', ['contribution_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_contribution_item_contribution_id'), table_name='contribution_item')
    op.drop_table('contribution_item')
    with op.batch_alter_table('contribution') as batch:
        batch.drop_column('plan_name')
        batch.drop_column('mode')
        batch.drop_column('reserve_cents')
