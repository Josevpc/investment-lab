"""aporte inicial: o ativo cadastrado como novo grava um aporte marcado no diario

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-26 10:00:00

Cria `asset_movement.initial` (padrao 0) e um indice unico parcial: no maximo um aporte inicial por
ativo. Sem backfill: todo ativo existente continua "antigo" e nenhum movimento muda. O aporte
inicial e derivado do valor do ativo e nunca mexe em saldos nem no caixa.
"""
from alembic import op
import sqlalchemy as sa


revision = '0014'
down_revision = '0013'
branch_labels = None
depends_on = None

INDEX = 'uq_movement_initial_per_asset'


def _columns(table: str) -> set[str]:
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {i['name'] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    # ALTER TABLE simples: `cash_entry` aponta para `asset_movement`, recriar a tabela e perigoso.
    if 'initial' not in _columns('asset_movement'):
        op.execute("ALTER TABLE asset_movement ADD COLUMN initial BOOLEAN NOT NULL DEFAULT 0")
    if INDEX not in _indexes('asset_movement'):
        op.execute(f"CREATE UNIQUE INDEX {INDEX} ON asset_movement (asset_id) WHERE initial = 1")


def downgrade() -> None:
    if INDEX in _indexes('asset_movement'):
        op.execute(f"DROP INDEX {INDEX}")
    if 'initial' in _columns('asset_movement'):
        # Sem a coluna o inicial viraria um aporte comum e seria contado em dobro: ele sai junto
        # (e e derivado do valor do ativo, nao ha dado do usuario nele). Os demais ficam.
        op.execute("DELETE FROM asset_movement WHERE initial = 1")
        op.execute("ALTER TABLE asset_movement DROP COLUMN initial")
