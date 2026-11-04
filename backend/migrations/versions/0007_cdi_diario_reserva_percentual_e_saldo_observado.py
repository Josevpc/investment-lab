"""cdi diario, reserva percentual e saldo observado

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-17 16:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('benchmark_daily',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('series', sa.String(length=8), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('rate_e9', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('series', 'date', name='uq_benchmark_daily_series_date')
    )
    # Todo valor que já existe foi digitado pelo usuário, então vale como saldo observado.
    with op.batch_alter_table('asset_valuation') as batch:
        batch.add_column(sa.Column('observed', sa.Boolean(), server_default=sa.text('1'), nullable=False))
    with op.batch_alter_table('reserve_setting') as batch:
        batch.add_column(sa.Column('percent_bps', sa.Integer(), server_default=sa.text('0'), nullable=False))
        batch.add_column(sa.Column('monthly_mode', sa.String(length=8), server_default=sa.text("'fixed'"), nullable=False))


def downgrade() -> None:
    with op.batch_alter_table('reserve_setting') as batch:
        batch.drop_column('monthly_mode')
        batch.drop_column('percent_bps')
    with op.batch_alter_table('asset_valuation') as batch:
        batch.drop_column('observed')
    op.drop_table('benchmark_daily')
