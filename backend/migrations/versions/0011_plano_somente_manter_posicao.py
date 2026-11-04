"""plano: categoria somente mantida

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-20 14:00:00

Adiciona `allocation_target.hold_only` (padrao 0): os planos que ja existem seguem exatamente como
estavam, sem nenhuma categoria mantida. Nao toca em nenhuma outra tabela.
"""
from alembic import op
import sqlalchemy as sa


revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Banco que ja tem a coluna e voltou a apontar para a revisao anterior nao deve falhar.
    columns = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('allocation_target')}
    if 'hold_only' in columns:
        return
    with op.batch_alter_table('allocation_target', schema=None) as batch_op:
        batch_op.add_column(sa.Column('hold_only', sa.Boolean(), server_default=sa.text('0'), nullable=False))


def downgrade() -> None:
    # A marcacao se perde ao voltar; as metas (percent_bps) continuam somando 100%, porque a
    # categoria mantida sempre tem 0% e as demais ja somam 100%.
    with op.batch_alter_table('allocation_target', schema=None) as batch_op:
        batch_op.drop_column('hold_only')
