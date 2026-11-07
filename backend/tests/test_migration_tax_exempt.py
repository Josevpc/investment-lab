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
            "insert into asset (id, name, class_id, institution_id, archived, balance_is_net) "
            "values (?, ?, 1, 1, 0, ?)",
            [(1, "CDB", 0), (2, "Caixinha", 1)],
        )
        conn.executemany(
            "insert into asset_valuation (asset_id, date, invested_cents, current_cents) "
            "values (?, ?, ?, ?)",
            [(1, "2026-09-30", 100, 110), (2, "2026-09-30", 200, 210)],
        )


def test_migration_marks_every_existing_asset_as_taxed_and_keeps_everything_else(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0018")
    seed_assets(db)

    command.upgrade(config, "0019")

    with sqlite3.connect(db) as conn:
        marks = conn.execute(
            "select id, tax_exempt, balance_is_net from asset order by id"
        ).fetchall()
        column = {r[1]: r for r in conn.execute("pragma table_info(asset)")}["tax_exempt"]
        valuations = conn.execute("select count(*) from asset_valuation").fetchone()[0]
        conn.execute(
            "insert into asset (name, class_id, institution_id, archived) values ('Novo', 1, 1, 0)"
        )
        default = conn.execute("select tax_exempt from asset where name = 'Novo'").fetchone()
        # Nada muda para quem já tinha ativos: ninguém vira isento e o saldo líquido fica como era.
        assert marks == [(1, 0, 0), (2, 0, 1)]
    assert column[3] == 1 and default == (0,)  # NOT NULL, padrão 0
    assert valuations == 2  # mexer em `asset` não pode apagar o histórico dos ativos


def test_migration_can_run_again_without_losing_the_mark(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0019")
    seed_assets(db)
    with sqlite3.connect(db) as conn:
        conn.execute("update asset set tax_exempt = 1 where id = 1")

    upgrade_to_head(sqlite_url(db))  # já está na 0019: não pode falhar nem apagar a marca

    with sqlite3.connect(db) as conn:
        assert conn.execute("select tax_exempt from asset order by id").fetchall() == [(1,), (0,)]


def test_upgrade_tolerates_a_database_that_already_has_the_column(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0018")
    seed_assets(db)
    with sqlite3.connect(db) as conn:
        conn.execute("alter table asset add column tax_exempt boolean not null default 0")

    command.upgrade(config, "0019")  # a coluna já existe: não pode falhar

    with sqlite3.connect(db) as conn:
        assert conn.execute("select count(*) from asset").fetchone() == (2,)


def test_downgrade_drops_only_the_column(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0019")
    seed_assets(db)

    command.downgrade(config, "0018")

    with sqlite3.connect(db) as conn:
        columns = {r[1] for r in conn.execute("pragma table_info(asset)")}
        assert conn.execute("select count(*) from asset").fetchone() == (2,)
        assert conn.execute("select count(*) from asset_valuation").fetchone() == (2,)
        assert conn.execute("select balance_is_net from asset order by id").fetchall() == [
            (0,),
            (1,),
        ]
    assert "tax_exempt" not in columns
