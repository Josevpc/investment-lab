"""grupos de categorias: tabela asset_group e asset_class.group_id

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-31 14:00:00

Cria `asset_group` (nome unico, cor, arquivado) e `asset_class.group_id` (nulo, FK para o grupo).
So aditiva e sem backfill: nenhum grupo e criado, toda categoria existente fica com `group_id`
nulo e nenhum valor, meta ou historico muda. O grupo e apenas apresentacao.
"""
from alembic import op
import sqlalchemy as sa


revision = '0016'
down_revision = '0015'
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if 'asset_group' not in _tables():
        op.create_table(
            'asset_group',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(length=40), nullable=False),
            sa.Column('color', sa.String(length=16), nullable=False),
            sa.Column('archived', sa.Boolean(), server_default=sa.text('0'), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('name'),
        )
    if 'group_id' not in _columns('asset_class'):
        # ALTER TABLE simples (e nao batch): `asset` e `allocation_target` apontam para
        # `asset_class`, e recriar a tabela so para acrescentar uma coluna nula e desnecessario.
        # O SQLite aceita REFERENCES aqui porque o padrao e nulo.
        op.execute(
            "ALTER TABLE asset_class ADD COLUMN group_id INTEGER REFERENCES asset_group (id)"
        )


def downgrade() -> None:
    # Grupo e dado do usuario: a versao antiga nao o conhece e apagar a tabela o perderia. Recusa e
    # deixa o banco como esta; quem tem grupos fica na versao nova (ou os apaga por conta propria).
    count = op.get_bind().execute(sa.text("SELECT COUNT(*) FROM asset_group")).scalar()
    if count:
        raise RuntimeError(
            f"Nao e possivel voltar para a revisao 0015: existem {count} grupo(s) de categorias. "
            "Eles seriam perdidos; fique na versao nova ou apague-os por sua conta."
        )
    # O SQLite nao apaga uma coluna que e chave estrangeira: recria `asset_class` sem ela.
    if 'group_id' in _columns('asset_class'):
        with op.batch_alter_table('asset_class') as batch_op:
            batch_op.drop_column('group_id')
    if 'asset_group' in _tables():
        op.drop_table('asset_group')
