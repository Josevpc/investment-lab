"""resgate: observacao e marca de saldo ja sem o dinheiro no movimento

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-31 10:00:00

Cria `asset_movement.note` (texto livre, ate 120 caracteres, pode ficar nulo) e
`asset_movement.in_balance` (padrao 0). Sem backfill: todo movimento existente fica sem observacao
e com `in_balance = 0`, e nenhum saldo muda. O tipo novo ('resgate') e so um valor da coluna `kind`.
"""
from alembic import op
import sqlalchemy as sa


revision = '0015'
down_revision = '0014'
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # ALTER TABLE simples (e nao batch): `cash_entry` aponta para `asset_movement`, e recriar a
    # tabela para acrescentar colunas e perigoso.
    columns = _columns('asset_movement')
    if 'note' not in columns:
        op.execute("ALTER TABLE asset_movement ADD COLUMN note VARCHAR(120)")
    if 'in_balance' not in columns:
        op.execute("ALTER TABLE asset_movement ADD COLUMN in_balance BOOLEAN NOT NULL DEFAULT 0")


def downgrade() -> None:
    # A versao antiga nao conhece o tipo 'resgate': os saldos dos ativos (ja reduzidos por ele)
    # ficariam sem explicacao no diario. Dado do usuario nao se apaga: recusa e deixa o banco como
    # esta; quem tem resgate precisa desfaze-los no app antes (ou ficar na versao nova).
    count = op.get_bind().execute(
        sa.text("SELECT COUNT(*) FROM asset_movement WHERE kind = 'resgate'")
    ).scalar()
    if count:
        raise RuntimeError(
            f"Nao e possivel voltar para a revisao 0014: existem {count} resgate(s) registrados. "
            "Desfaca os resgates no app antes, para nao perder dados."
        )
    columns = _columns('asset_movement')
    if 'in_balance' in columns:
        op.execute("ALTER TABLE asset_movement DROP COLUMN in_balance")
    if 'note' in columns:
        op.execute("ALTER TABLE asset_movement DROP COLUMN note")
