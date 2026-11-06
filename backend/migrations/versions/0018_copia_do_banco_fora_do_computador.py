"""copia do banco fora do computador: tabela offsite_backup_setting

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-05 10:00:00

Cria `offsite_backup_setting` (linha unica, id = 1), vazia: pasta, data e nome da ultima copia ficam
nulos ate a pessoa escolher a pasta. Nao toca em nenhuma outra tabela nem em nenhum dado.
"""
from alembic import op
import sqlalchemy as sa


revision = '0018'
down_revision = '0017'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Banco que ja tem a tabela e voltou a apontar para a revisao anterior nao deve falhar.
    if 'offsite_backup_setting' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table('offsite_backup_setting',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('folder', sa.String(), nullable=True),
    sa.Column('last_copy_at', sa.DateTime(), nullable=True),
    sa.Column('last_copy_file', sa.String(), nullable=True),
    sa.CheckConstraint('id = 1', name='ck_offsite_backup_setting_single_row'),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    # Perde so a pasta escolhida e a data da ultima copia; as copias ja gravadas na pasta ficam la.
    op.drop_table('offsite_backup_setting')
