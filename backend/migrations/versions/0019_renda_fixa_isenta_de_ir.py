"""renda fixa isenta de IR: o ativo diz se o rendimento dele nao paga imposto (LCI, LCA...)

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-06 10:00:00

Cria `asset.tax_exempt` (padrao 0 = tributado). Ninguem era isento ate aqui, entao todo ativo
existente continua assim; quem tem LCI/LCA marca no ativo. A marca so serve para comparar o
desempenho contra o CDI (equivalente bruto): nao mexe em saldo, investido nem aporte. A regra
"so renda fixa, e nao junto com saldo liquido" fica no service, sem CHECK no banco.
"""
from alembic import op
import sqlalchemy as sa


revision = '0019'
down_revision = '0018'
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # Confere o que ja existe: banco que ja tem a coluna nao falha. ALTER TABLE simples em `asset`:
    # recriar a tabela apagaria, em cascata, as valorizacoes dos ativos.
    if 'tax_exempt' not in _columns('asset'):
        op.execute("ALTER TABLE asset ADD COLUMN tax_exempt BOOLEAN NOT NULL DEFAULT 0")


def downgrade() -> None:
    if 'tax_exempt' in _columns('asset'):
        # DROP COLUMN direto exige SQLite >= 3.35 (o Python 3.12 traz versao mais nova). Nao se
        # recria `asset`: isso apagaria, em cascata, as valorizacoes dos ativos.
        op.execute("ALTER TABLE asset DROP COLUMN tax_exempt")
