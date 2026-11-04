"""caixa: contas, lancamentos e conta do ativo

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-19 10:00:00

Cria `account` (uma conta por instituicao existente, com o mesmo nome) e `cash_entry` (vazia: a
migracao nao inventa saldo nem historico). `asset.account_id` recebe a conta da instituicao do
ativo. `asset_movement.from_purchase` nasce falso para todos os movimentos antigos.
"""
from alembic import op
import sqlalchemy as sa


revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None

SIGN_RULE = (
    "(kind IN ('deposito', 'provento', 'venda') AND amount_cents > 0) OR "
    "(kind IN ('compra', 'retirada', 'taxa') AND amount_cents < 0) OR "
    "(kind = 'ajuste' AND amount_cents != 0) OR "
    "(kind = 'saldo_inicial' AND amount_cents >= 0) OR "
    "(kind = 'transferencia' AND amount_cents != 0)"
)


def upgrade() -> None:
    # Cada passo confere o que ja existe e cria so o que falta: rodar de novo (ex.: banco que ja
    # tem parte do esquema) nao falha nem duplica contas.
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if 'account' not in tables:
        op.create_table('account',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('institution_id', sa.Integer(), nullable=False),
        sa.Column('archived', sa.Boolean(), server_default=sa.text('0'), nullable=False),
        sa.ForeignKeyConstraint(['institution_id'], ['institution.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
        )
    if 'cash_entry' not in tables:
        op.create_table('cash_entry',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('amount_cents', sa.Integer(), nullable=False),
        sa.Column('asset_id', sa.Integer(), nullable=True),
        sa.Column('movement_id', sa.Integer(), nullable=True),
        sa.Column('transfer_id', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.CheckConstraint(SIGN_RULE, name='ck_cash_entry_sign'),
        sa.ForeignKeyConstraint(['account_id'], ['account.id'], ),
        sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], ),
        sa.ForeignKeyConstraint(['movement_id'], ['asset_movement.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
    indexes = {i['name'] for i in sa.inspect(op.get_bind()).get_indexes('cash_entry')}
    if 'ix_cash_entry_account_date' not in indexes:
        op.create_index('ix_cash_entry_account_date', 'cash_entry', ['account_id', 'date'], unique=False)
    if 'uq_cash_entry_opening' not in indexes:
        op.create_index('uq_cash_entry_opening', 'cash_entry', ['account_id'], unique=True,
                        sqlite_where=sa.text("kind = 'saldo_inicial'"))

    # Colunas novas por ALTER TABLE simples: nao recria `asset` nem `asset_movement`, que tem
    # filhos ligados por chave estrangeira.
    if 'account_id' not in {c['name'] for c in inspector.get_columns('asset')}:
        op.execute("ALTER TABLE asset ADD COLUMN account_id INTEGER REFERENCES account (id)")
    if 'from_purchase' not in {c['name'] for c in inspector.get_columns('asset_movement')}:
        op.add_column('asset_movement',
            sa.Column('from_purchase', sa.Boolean(), server_default=sa.text('0'), nullable=False))

    # Uma conta por instituicao que ainda nao tem conta (mesmo nome) e cada ativo sem conta
    # na conta da sua instituicao. Nomes que diferem so na caixa viram contas distintas.
    op.execute("INSERT INTO account (name, institution_id, archived) "
               "SELECT name, id, 0 FROM institution "
               "WHERE NOT EXISTS (SELECT 1 FROM account WHERE account.institution_id = institution.id) "
               "AND name NOT IN (SELECT name FROM account) ORDER BY id")
    op.execute("UPDATE asset SET account_id = "
               "(SELECT MIN(account.id) FROM account WHERE account.institution_id = asset.institution_id) "
               "WHERE account_id IS NULL")


def downgrade() -> None:
    # Os lancamentos do caixa se perdem ao voltar: sem as tabelas nao ha onde guarda-los.
    with op.batch_alter_table('asset_movement', schema=None) as batch_op:
        batch_op.drop_column('from_purchase')

    with op.batch_alter_table('asset', schema=None) as batch_op:
        batch_op.drop_column('account_id')

    op.drop_index('uq_cash_entry_opening', table_name='cash_entry')
    op.drop_index('ix_cash_entry_account_date', table_name='cash_entry')
    op.drop_table('cash_entry')
    op.drop_table('account')
