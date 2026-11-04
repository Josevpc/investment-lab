"""manter posicao: a marca passa da categoria do plano para o ativo

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-23 10:00:00

Cria `asset.hold_only` (padrao 0). Cada categoria mantida no plano ATIVO (`allocation_target.hold_only`)
marca todos os ativos nao arquivados dela; depois `allocation_target.hold_only` sai. As metas
(`percent_bps`) nao mudam. Perdem-se, com aviso no log, as marcas de planos inativos que diferem do
plano ativo e as categorias mantidas que nao tinham nenhum ativo para receber a marca.
"""
import logging

from alembic import op
import sqlalchemy as sa


revision = '0012'
down_revision = '0011'
branch_labels = None
depends_on = None

log = logging.getLogger(__name__)


def _columns(table: str) -> set[str]:
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _held_by_plan(conn) -> tuple[dict[int, str], dict[int, set[int]]]:
    """Nome de cada plano e as categorias mantidas nele."""
    names = {pid: name for pid, name in conn.execute(sa.text("SELECT id, name FROM allocation_plan"))}
    held: dict[int, set[int]] = {pid: set() for pid in names}
    for pid, cid in conn.execute(sa.text("SELECT plan_id, class_id FROM allocation_target WHERE hold_only = 1")):
        held[pid].add(cid)
    return names, held


def _percent(bps: int) -> str:
    return f"{bps / 100:.2f}".replace(".", ",") + "%"


def _warn_about_lost_marks(conn) -> None:
    names, held = _held_by_plan(conn)
    active = {pid for (pid,) in conn.execute(sa.text("SELECT id FROM allocation_plan WHERE is_active = 1"))}
    active_held = set().union(*(held[pid] for pid in active)) if active else set()
    class_names = {cid: name for cid, name in conn.execute(sa.text("SELECT id, name FROM asset_class"))}
    percents = {
        (pid, cid): bps
        for pid, cid, bps in conn.execute(sa.text("SELECT plan_id, class_id, percent_bps FROM allocation_target"))
    }

    def label(cid: int) -> str:
        return class_names.get(cid, str(cid))

    for pid, classes in held.items():
        if pid in active or classes == active_held:
            continue
        # As metas gravadas do plano inativo NAO mudam; so a marca deixa de ser por plano.
        with_target = sorted(
            f"{label(c)} {_percent(percents[(pid, c)])}" for c in active_held if percents.get((pid, c), 0) > 0
        )
        log.warning(
            "Plano inativo '%s': a marca de manter posicao agora e do ativo e vale para todos os "
            "planos; valem as marcas do plano ativo (%s), e o que esse plano mantinha (%s) deixa de "
            "valer so nele. As metas gravadas no plano NAO foram alteradas%s.",
            names[pid],
            ", ".join(sorted(label(c) for c in active_held)) or 'nenhuma categoria',
            ", ".join(sorted(label(c) for c in classes)) or 'nenhuma categoria',
            "; categorias agora mantidas com meta nele: " + ", ".join(with_target) if with_target else "",
        )
    for cid in sorted(active_held):
        has_asset = conn.execute(
            sa.text("SELECT 1 FROM asset WHERE class_id = :c AND archived = 0 LIMIT 1"), {'c': cid}
        ).first()
        if not has_asset:
            log.warning(
                "A categoria '%s' estava mantida no plano ativo, mas nao tem ativos: a marca se perde.",
                label(cid),
            )


def upgrade() -> None:
    conn = op.get_bind()
    # Cada passo confere o que ja existe: banco que ja tem parte do esquema nao falha.
    # ALTER TABLE simples em `asset`: recriar a tabela apagaria, em cascata, as valorizacoes dos
    # ativos se as chaves estrangeiras estivessem ligadas.
    if 'hold_only' not in _columns('asset'):
        op.execute("ALTER TABLE asset ADD COLUMN hold_only BOOLEAN NOT NULL DEFAULT 0")

    if 'hold_only' in _columns('allocation_target'):
        _warn_about_lost_marks(conn)
        op.execute(
            "UPDATE asset SET hold_only = 1 WHERE archived = 0 AND class_id IN ("
            "SELECT t.class_id FROM allocation_target t JOIN allocation_plan p ON p.id = t.plan_id "
            "WHERE p.is_active = 1 AND t.hold_only = 1)"
        )
        with op.batch_alter_table('allocation_target', schema=None) as batch_op:
            batch_op.drop_column('hold_only')


def downgrade() -> None:
    if 'hold_only' not in _columns('allocation_target'):
        with op.batch_alter_table('allocation_target', schema=None) as batch_op:
            batch_op.add_column(sa.Column('hold_only', sa.Boolean(), server_default=sa.text('0'), nullable=False))

    # No modelo antigo a categoria mantida tem meta 0 e vale em todos os planos: so volta a marca
    # onde ela era coerente (todos os ativos ativos da categoria mantidos e meta 0).
    op.execute(
        "UPDATE allocation_target SET hold_only = 1 WHERE percent_bps = 0 "
        "AND EXISTS (SELECT 1 FROM asset a WHERE a.class_id = allocation_target.class_id AND a.archived = 0) "
        "AND NOT EXISTS (SELECT 1 FROM asset a WHERE a.class_id = allocation_target.class_id "
        "AND a.archived = 0 AND a.hold_only = 0)"
    )

    if 'hold_only' in _columns('asset'):
        # DROP COLUMN direto exige SQLite >= 3.35 (o Python 3.12 traz versao mais nova). Nao se
        # recria `asset`: isso apagaria, em cascata, as valorizacoes dos ativos.
        op.execute("ALTER TABLE asset DROP COLUMN hold_only")
