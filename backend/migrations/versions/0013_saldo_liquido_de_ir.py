"""saldo liquido de IR: o ativo diz se o saldo digitado ja vem com o imposto descontado

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-24 10:00:00

Cria `asset.balance_is_net` (padrao 0 = bruto). O app sempre tratou os saldos como brutos, entao
todo ativo existente continua assim; quem tem saldo liquido (ex.: Caixinha do Mercado Pago) marca
no ativo. A marca so rotula o desempenho contra o CDI: nao ha calculo de imposto.
"""
from alembic import op
import sqlalchemy as sa


revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # Confere o que ja existe: banco que ja tem a coluna nao falha. ALTER TABLE simples em `asset`:
    # recriar a tabela apagaria, em cascata, as valorizacoes dos ativos.
    if 'balance_is_net' not in _columns('asset'):
        op.execute("ALTER TABLE asset ADD COLUMN balance_is_net BOOLEAN NOT NULL DEFAULT 0")


def downgrade() -> None:
    if 'balance_is_net' in _columns('asset'):
        # DROP COLUMN direto exige SQLite >= 3.35 (o Python 3.12 traz versao mais nova). Nao se
        # recria `asset`: isso apagaria, em cascata, as valorizacoes dos ativos.
        op.execute("ALTER TABLE asset DROP COLUMN balance_is_net")
