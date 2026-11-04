"""metas e premissas da projecao

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-17 20:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('goal_setting',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('net_worth_goal_cents', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('year_goal_cents', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('monthly_cents', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('horizon_years', sa.Integer(), server_default=sa.text('20'), nullable=False),
    sa.Column('inflation_bps', sa.Integer(), server_default=sa.text('450'), nullable=False),
    sa.Column('conservative_bps', sa.Integer(), server_default=sa.text('600'), nullable=False),
    sa.Column('base_bps', sa.Integer(), server_default=sa.text('900'), nullable=False),
    sa.Column('optimistic_bps', sa.Integer(), server_default=sa.text('1200'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('goal_setting')
