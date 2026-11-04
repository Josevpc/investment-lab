import sqlite3

from alembic import command

from app.core.migrate import alembic_config, upgrade_to_head


def sqlite_url(path) -> str:
    return f"sqlite:///{path.as_posix()}"


def seed_assets(db) -> None:
    with sqlite3.connect(db) as conn:
        conn.execute(
            "insert into asset_class (id, key, name, color) values (1, 'rf', 'RF', '#000')"
        )
        conn.execute("insert into institution (id, name) values (1, 'Banco')")
        conn.executemany(
            "insert into asset (id, name, class_id, institution_id, archived) "
            "values (?, ?, 1, 1, 0)",
            [(1, "CDB"), (2, "Tesouro")],
        )
        conn.execute(
            "insert into asset_valuation (asset_id, date, invested_cents, current_cents) "
            "values (1, '2026-09-30', 100, 110)"
        )


def test_migration_marks_every_existing_asset_as_gross(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0012")
    seed_assets(db)

    command.upgrade(config, "0013")

    with sqlite3.connect(db) as conn:
        marks = conn.execute("select id, balance_is_net from asset order by id").fetchall()
        column = {r[1]: r for r in conn.execute("pragma table_info(asset)")}["balance_is_net"]
        valuations = conn.execute("select count(*) from asset_valuation").fetchone()[0]
        conn.execute(
            "insert into asset (name, class_id, institution_id, archived) values ('Novo', 1, 1, 0)"
        )
        default = conn.execute("select balance_is_net from asset where name = 'Novo'").fetchone()
    # O app sempre tratou o saldo como bruto: nada muda para quem já tinha ativos.
    assert marks == [(1, 0), (2, 0)]
    assert column[3] == 1 and default == (0,)  # NOT NULL, padrão 0
    assert valuations == 1  # mexer em `asset` não pode apagar o histórico dos ativos


def test_migration_can_run_again_without_losing_the_mark(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0013")
    seed_assets(db)
    with sqlite3.connect(db) as conn:
        conn.execute("update asset set balance_is_net = 1 where id = 2")

    upgrade_to_head(sqlite_url(db))  # já está na 0013: não pode falhar nem apagar a marca

    with sqlite3.connect(db) as conn:
        assert conn.execute("select balance_is_net from asset where id = 2").fetchone() == (1,)


def test_downgrade_drops_only_the_column(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0013")
    seed_assets(db)

    command.downgrade(config, "0012")

    with sqlite3.connect(db) as conn:
        columns = {r[1] for r in conn.execute("pragma table_info(asset)")}
        assert conn.execute("select count(*) from asset").fetchone() == (2,)
        assert conn.execute("select count(*) from asset_valuation").fetchone() == (1,)
    assert "balance_is_net" not in columns


def test_upgrade_after_a_downgrade_goes_back_to_gross(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0013")
    seed_assets(db)
    with sqlite3.connect(db) as conn:
        conn.execute("update asset set balance_is_net = 1 where id = 2")

    command.downgrade(config, "0012")
    command.upgrade(config, "0013")

    with sqlite3.connect(db) as conn:
        marks = conn.execute("select id, balance_is_net from asset order by id").fetchall()
    assert marks == [(1, 0), (2, 0)]  # a coluna some no downgrade e volta com o padrão
