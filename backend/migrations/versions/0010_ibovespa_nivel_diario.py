"""ibovespa: nivel diario do indice

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-20 10:00:00

Cria `benchmark_index_level` (vazia: o historico do indice chega quando o app buscar na B3).
Nao toca em nenhuma outra tabela.
"""
from alembic import op
import sqlalchemy as sa


revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Banco que ja tem a tabela e voltou a apontar para a revisao anterior nao deve falhar.
    if 'benchmark_index_level' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table('benchmark_index_level',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('series', sa.String(length=16), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('close_e2', sa.Integer(), nullable=False),
    sa.Column('fetched_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('series', 'date', name='uq_benchmark_index_level_series_date')
    )


def downgrade() -> None:
    # Os fechamentos se perdem ao voltar, mas sao copia de dado publico e voltam na proxima busca.
    op.drop_table('benchmark_index_level')
