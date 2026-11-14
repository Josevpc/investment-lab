import sqlite3

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect

from app.core.migrate import alembic_config, upgrade_to_head
from app.registry import Base

NEW_TABLES = ("cash_reservation", "cash_reservation_use")
OLD_TABLES = (
    "institution",
    "account",
    "asset_class",
    "asset",
    "asset_valuation",
    "asset_movement",
    "cash_entry",
)


def sqlite_url(path) -> str:
    return f"sqlite:///{path.as_posix()}"


def seed_cash_portfolio(db) -> None:
    with sqlite3.connect(db) as conn:
        conn.execute(
            "insert into asset_class (id, key, name, color) values (1, 'rf', 'RF', '#000')"
        )
        conn.execute("insert into institution (id, name) values (1, 'Banco')")
        conn.execute("insert into account (id, name, institution_id) values (1, 'Banco', 1)")
        conn.execute(
            "insert into asset (id, name, class_id, institution_id, archived) "
            "values (1, 'CDB', 1, 1, 0)"
        )
        conn.execute(
            "insert into asset_valuation (asset_id, date, invested_cents, current_cents) "
            "values (1, '2026-09-30', 100, 110)"
        )
        conn.execute(
            "insert into asset_movement (id, date, kind, asset_id, amount_cents) "
            "values (1, '2026-10-05', 'aporte', 1, 50000)"
        )
        conn.execute(
            "insert into cash_entry (account_id, date, kind, amount_cents) "
            "values (1, '2026-10-01', 'saldo_inicial', 100000)"
        )


def counts(db) -> dict[str, int]:
    with sqlite3.connect(db) as conn:
        return {
            table: conn.execute(f"select count(*) from {table}").fetchone()[0]
            for table in OLD_TABLES
        }


def table_names(db) -> set[str]:
    with sqlite3.connect(db) as conn:
        return {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}


def test_migration_adds_two_empty_tables_and_keeps_every_existing_table(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0019")
    seed_cash_portfolio(db)
    before = counts(db)
    with sqlite3.connect(db) as conn:
        schema_before = {
            r[0]: r[1]
            for r in conn.execute("select name, sql from sqlite_master where type='table'")
        }

    command.upgrade(config, "0020")

    assert counts(db) == before and before["cash_entry"] == 1
    with sqlite3.connect(db) as conn:
        schema_after = {
            r[0]: r[1]
            for r in conn.execute("select name, sql from sqlite_master where type='table'")
        }
        for table in NEW_TABLES:
            assert conn.execute(f"select count(*) from {table}").fetchone()[0] == 0
    # Nenhuma tabela existente foi recriada ou alterada: o SQL de criação é idêntico.
    assert {k: v for k, v in schema_after.items() if k in schema_before} == schema_before
    assert set(schema_after) - set(schema_before) == set(NEW_TABLES)


def test_reservation_tables_enforce_positive_amounts_kinds_and_foreign_keys(tmp_path):
    db = tmp_path / "antigo.db"
    command.upgrade(alembic_config(sqlite_url(db)), "0020")
    seed_cash_portfolio(db)

    with sqlite3.connect(db) as conn:
        conn.execute("pragma foreign_keys = on")
        insert = (
            "insert into cash_reservation (account_id, class_id, date, amount_cents) "
            "values (?, ?, '2026-11-01', ?)"
        )
        conn.execute(insert, (1, 1, 30000))
        for bad in ((1, 1, 0), (1, 1, -100)):  # nunca zero nem negativo
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute(insert, bad)
        with pytest.raises(sqlite3.IntegrityError):  # conta que não existe
            conn.execute(insert, (99, 1, 100))
        with pytest.raises(sqlite3.IntegrityError):  # categoria que não existe
            conn.execute(insert, (1, 99, 100))

        use = (
            "insert into cash_reservation_use "
            "(reservation_id, kind, date, amount_cents, movement_id) "
            "values (?, ?, '2026-11-02', ?, ?)"
        )
        conn.execute(use, (1, "compra", 10000, 1))
        conn.execute(use, (1, "liberacao", 5000, None))
        for bad in (
            (1, "compra", 0, 1),
            (1, "liberacao", -5, None),
            (1, "saque", 100, None),  # tipo desconhecido
            (1, "liberacao", 100, 1),  # liberar não gera movimento da carteira
            (99, "compra", 100, 1),  # reserva que não existe
            (1, "compra", 100, 99),  # movimento que não existe
        ):
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute(use, bad)
        assert conn.execute("select count(*) from cash_reservation_use").fetchone() == (2,)
        created = conn.execute("select created_at from cash_reservation").fetchone()[0]
        assert created is not None  # preenchido pelo banco


def test_reservation_tables_have_the_planned_indexes(tmp_path):
    db = tmp_path / "antigo.db"
    command.upgrade(alembic_config(sqlite_url(db)), "0020")

    inspector = inspect(create_engine(sqlite_url(db)))
    reservation = {i["name"]: i["column_names"] for i in inspector.get_indexes("cash_reservation")}
    use = {i["name"]: i["column_names"] for i in inspector.get_indexes("cash_reservation_use")}
    assert reservation == {
        "ix_cash_reservation_account_class_date": ["account_id", "class_id", "date"]
    }
    assert use == {
        "ix_cash_reservation_use_reservation": ["reservation_id"],
        "ix_cash_reservation_use_movement": ["movement_id"],
    }


def test_migration_matches_the_models(tmp_path):
    url = sqlite_url(tmp_path / "novo.db")
    upgrade_to_head(url)

    inspector = inspect(create_engine(url))
    for table in NEW_TABLES:
        model = Base.metadata.tables[table]
        assert {c["name"] for c in inspector.get_columns(table)} == set(model.columns.keys())
        assert {i["name"] for i in inspector.get_indexes(table)} == {i.name for i in model.indexes}
        assert {c["name"] for c in inspector.get_check_constraints(table)} == {
            c.name for c in model.constraints if c.__class__.__name__ == "CheckConstraint"
        }


def test_migration_can_run_again_without_losing_reservations(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0020")
    seed_cash_portfolio(db)
    with sqlite3.connect(db) as conn:
        conn.execute(
            "insert into cash_reservation (account_id, class_id, date, amount_cents) "
            "values (1, 1, '2026-11-01', 30000)"
        )

    command.stamp(config, "0019")
    command.upgrade(config, "0020")  # as tabelas já existem

    with sqlite3.connect(db) as conn:
        assert conn.execute("select amount_cents from cash_reservation").fetchall() == [(30000,)]


def test_downgrade_drops_only_the_two_tables_and_can_go_up_again(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0019")
    seed_cash_portfolio(db)
    before = counts(db)
    tables_before = table_names(db)

    command.upgrade(config, "0020")
    command.downgrade(config, "0019")

    assert counts(db) == before
    assert table_names(db) == tables_before
    with sqlite3.connect(db) as conn:
        assert conn.execute("select version_num from alembic_version").fetchone() == ("0019",)

    command.upgrade(config, "0020")
    assert counts(db) == before
    assert set(NEW_TABLES) <= table_names(db)
