"""aporte fora da meta: marca asset_movement.off_goal

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-04 10:00:00

Cria `asset_movement.off_goal` (BOOLEAN NOT NULL, padrao 0). So aditiva e sem backfill: todo
movimento existente fica com `off_goal = 0`, entao nenhum aporte muda de contagem (plano do mes,
sequencia, ritmo) e nenhum saldo, valorizacao ou lancamento de caixa e tocado. A marca so tem
efeito em aportes e apenas tira o aporte da meta; ele segue no investido, no patrimonio e na
rentabilidade.
"""
from alembic import op
import sqlalchemy as sa


revision = '0017'
down_revision = '0016'
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # ALTER TABLE simples (e nao batch), como na 0015: `cash_entry` aponta para `asset_movement`, e
    # recriar a tabela so para acrescentar uma coluna com padrao e desnecessario e arriscado.
    if 'off_goal' not in _columns('asset_movement'):
        op.execute("ALTER TABLE asset_movement ADD COLUMN off_goal BOOLEAN NOT NULL DEFAULT 0")


def downgrade() -> None:
    # A marca e so uma preferencia de contagem: nenhum valor em dinheiro se perde. Quem a tinha volta
    # a ter o aporte contado na meta.
    if 'off_goal' in _columns('asset_movement'):
        op.execute("ALTER TABLE asset_movement DROP COLUMN off_goal")
