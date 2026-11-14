"""dinheiro separado para comprar, por categoria: tabelas cash_reservation e cash_reservation_use

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-11 10:00:00

Cria duas tabelas vazias. `cash_reservation` guarda quanto do caixa de uma conta foi separado para
comprar uma categoria; `cash_reservation_use` guarda cada baixa dessa reserva (compra, ligada ao
aporte, ou liberacao de volta ao caixa livre). A reserva nao move saldo: o caixa segue sendo a
soma de `cash_entry`. Nao altera nenhuma tabela existente nem nenhum dado.
"""
from alembic import op
import sqlalchemy as sa


revision = '0020'
down_revision = '0019'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Cada passo confere o que ja existe e cria so o que falta: banco que ja tem parte do esquema
    # nao falha.
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if 'cash_reservation' not in tables:
        op.create_table('cash_reservation',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('class_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('amount_cents', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.CheckConstraint('amount_cents > 0', name='ck_cash_reservation_amount'),
        sa.ForeignKeyConstraint(['account_id'], ['account.id'], ),
        sa.ForeignKeyConstraint(['class_id'], ['asset_class.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
    if 'cash_reservation_use' not in tables:
        op.create_table('cash_reservation_use',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('reservation_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('amount_cents', sa.Integer(), nullable=False),
        sa.Column('movement_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.CheckConstraint("kind IN ('compra', 'liberacao')", name='ck_cash_reservation_use_kind'),
        sa.CheckConstraint('amount_cents > 0', name='ck_cash_reservation_use_amount'),
        sa.CheckConstraint("movement_id IS NULL OR kind = 'compra'", name='ck_cash_reservation_use_movement'),
        sa.ForeignKeyConstraint(['reservation_id'], ['cash_reservation.id'], ),
        sa.ForeignKeyConstraint(['movement_id'], ['asset_movement.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    reservation_indexes = {i['name'] for i in sa.inspect(op.get_bind()).get_indexes('cash_reservation')}
    if 'ix_cash_reservation_account_class_date' not in reservation_indexes:
        op.create_index('ix_cash_reservation_account_class_date', 'cash_reservation',
                        ['account_id', 'class_id', 'date'], unique=False)
    use_indexes = {i['name'] for i in sa.inspect(op.get_bind()).get_indexes('cash_reservation_use')}
    if 'ix_cash_reservation_use_reservation' not in use_indexes:
        op.create_index('ix_cash_reservation_use_reservation', 'cash_reservation_use',
                        ['reservation_id'], unique=False)
    if 'ix_cash_reservation_use_movement' not in use_indexes:
        op.create_index('ix_cash_reservation_use_movement', 'cash_reservation_use',
                        ['movement_id'], unique=False)


def downgrade() -> None:
    # Perde so as reservas e as baixas; caixa, ativos e movimentos nao dependem delas. Os usos saem
    # primeiro porque apontam para a reserva.
    op.drop_index('ix_cash_reservation_use_movement', table_name='cash_reservation_use')
    op.drop_index('ix_cash_reservation_use_reservation', table_name='cash_reservation_use')
    op.drop_table('cash_reservation_use')
    op.drop_index('ix_cash_reservation_account_class_date', table_name='cash_reservation')
    op.drop_table('cash_reservation')
