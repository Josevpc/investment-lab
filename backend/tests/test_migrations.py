import sqlite3

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect

from app.core.migrate import alembic_config, upgrade_to_head
from app.registry import Base


def sqlite_url(path) -> str:
    return f"sqlite:///{path.as_posix()}"


def test_migrations_create_the_same_tables_as_the_models(tmp_path):
    url = sqlite_url(tmp_path / "test.db")
    upgrade_to_head(url)

    tables = set(inspect(create_engine(url)).get_table_names())
    assert set(Base.metadata.tables) <= tables


def test_new_database_gets_no_backup(tmp_path):
    upgrade_to_head(sqlite_url(tmp_path / "new.db"))
    assert not (tmp_path / "backups").exists()


def test_pending_migration_backs_up_existing_data_first(tmp_path):
    db = tmp_path / "investment.db"
    url = sqlite_url(db)
    # Banco "antigo": só a primeira migração, com dados do usuário.
    command.upgrade(alembic_config(url), "0001")
    with sqlite3.connect(db) as conn:
        conn.execute("insert into institution (name) values ('Mercado Pago')")

    upgrade_to_head(url)

    backups = list((tmp_path / "backups").glob("investment-*-rev0001.db"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as old:
        assert old.execute("select name from institution").fetchall() == [("Mercado Pago",)]
        tables = {r[0] for r in old.execute("select name from sqlite_master where type='table'")}
        assert "asset_movement" not in tables  # o backup é anterior à migração
    # O banco migrado mantém os dados e ganha as tabelas novas.
    with sqlite3.connect(db) as new:
        assert new.execute("select name from institution").fetchall() == [("Mercado Pago",)]
        tables = {r[0] for r in new.execute("select name from sqlite_master where type='table'")}
        assert {"asset_movement", "reserve_setting"} <= tables


def test_database_already_at_head_is_not_backed_up_again(tmp_path):
    url = sqlite_url(tmp_path / "investment.db")
    upgrade_to_head(url)
    upgrade_to_head(url)
    assert not (tmp_path / "backups").exists()


def test_default_category_colors_are_updated_only_when_untouched(tmp_path):
    db = tmp_path / "investment.db"
    url = sqlite_url(db)
    command.upgrade(alembic_config(url), "0004")
    with sqlite3.connect(db) as conn:
        conn.executemany(
            "insert into asset_class (key, name, color, archived) values (?, ?, ?, 0)",
            [
                ("renda_fixa", "Renda Fixa", "#2563eb"),  # cor padrão antiga: deve mudar
                ("cripto", "Cripto", "#123456"),  # o usuário já recolorou: deve ficar
                ("fiis", "FIIs", "#2563eb"),  # categoria própria com a mesma cor: não é padrão
            ],
        )

    upgrade_to_head(url)

    with sqlite3.connect(db) as conn:
        colors = dict(conn.execute("select key, color from asset_class").fetchall())
        tables = {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
    assert colors == {"renda_fixa": "#5aa88a", "cripto": "#123456", "fiis": "#2563eb"}
    assert "benchmark_rate" in tables


def test_existing_contributions_survive_the_plan_migration(tmp_path):
    db = tmp_path / "investment.db"
    url = sqlite_url(db)
    command.upgrade(alembic_config(url), "0005")
    with sqlite3.connect(db) as conn:
        conn.execute(
            "insert into contribution "
            "(month, salary_cents, percent_bps, calculated_cents, final_cents) "
            "values ('2026-09', 950000, 750, 71250, 71250)"
        )

    upgrade_to_head(url)

    with sqlite3.connect(db) as conn:
        row = conn.execute(
            "select final_cents, reserve_cents, mode, plan_name from contribution"
        ).fetchone()
        items = conn.execute("select count(*) from contribution_item").fetchone()[0]
    assert row == (71250, 0, None, None)  # o aporte antigo fica, sem plano gravado
    assert items == 0


def test_existing_balances_become_observed_and_reserve_stays_fixed(tmp_path):
    db = tmp_path / "investment.db"
    url = sqlite_url(db)
    command.upgrade(alembic_config(url), "0006")
    with sqlite3.connect(db) as conn:
        conn.execute("insert into institution (name) values ('Banco')")
        conn.execute(
            "insert into asset_class (key, name, color, archived) values ('rf', 'RF', '#111111', 0)"
        )
        conn.execute(
            "insert into asset (name, class_id, institution_id, archived) values ('CDB', 1, 1, 0)"
        )
        conn.execute(
            "insert into asset_valuation (asset_id, date, invested_cents, current_cents) "
            "values (1, '2026-09-30', 100000, 101000)"
        )
        conn.execute(
            "insert into reserve_setting (id, goal_cents, months, monthly_cents) "
            "values (1, 0, 6, 50000)"
        )

    upgrade_to_head(url)

    with sqlite3.connect(db) as conn:
        observed = conn.execute("select observed from asset_valuation").fetchone()[0]
        reserve = conn.execute(
            "select monthly_cents, monthly_mode, percent_bps from reserve_setting"
        ).fetchone()
        tables = {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
    assert observed == 1  # o que já estava digitado vale como saldo observado
    assert reserve == (50_000, "fixed", 0)
    assert "benchmark_daily" in tables


def test_goal_table_is_added_without_touching_existing_data(tmp_path):
    db = tmp_path / "investment.db"
    url = sqlite_url(db)
    command.upgrade(alembic_config(url), "0007")
    with sqlite3.connect(db) as conn:
        conn.execute("insert into institution (name) values ('Banco')")

    upgrade_to_head(url)

    with sqlite3.connect(db) as conn:
        assert conn.execute("select name from institution").fetchall() == [("Banco",)]
        conn.execute("insert into goal_setting (id) values (1)")
        defaults = conn.execute(
            "select net_worth_goal_cents, horizon_years, inflation_bps, conservative_bps, "
            "base_bps, optimistic_bps from goal_setting"
        ).fetchone()
    assert defaults == (0, 20, 450, 600, 900, 1200)


def _seed_before_cash(db) -> None:
    """Carteira como existia na revisão 0008: duas instituições, três ativos e um aporte."""
    with sqlite3.connect(db) as conn:
        conn.executemany(
            "insert into institution (name) values (?)", [("Banco A",), ("Corretora B",)]
        )
        conn.execute(
            "insert into asset_class (key, name, color, archived) values ('rf', 'RF', '#111111', 0)"
        )
        conn.executemany(
            "insert into asset (name, class_id, institution_id, archived) values (?, 1, ?, 0)",
            [("CDB", 1), ("LCI", 1), ("FII", 2)],
        )
        conn.executemany(
            "insert into asset_valuation (asset_id, date, invested_cents, current_cents) "
            "values (?, '2026-09-30', 100000, 101000)",
            [(1,), (2,), (3,)],
        )
        conn.execute(
            "insert into asset_movement (date, kind, asset_id, amount_cents) "
            "values ('2026-09-15', 'aporte', 1, 50000)"
        )


def test_cash_migration_creates_an_account_per_institution_and_links_the_assets(tmp_path):
    db = tmp_path / "investment.db"
    url = sqlite_url(db)
    command.upgrade(alembic_config(url), "0008")
    _seed_before_cash(db)

    upgrade_to_head(url)

    with sqlite3.connect(db) as conn:
        accounts = conn.execute(
            "select name, institution_id, archived from account order by id"
        ).fetchall()
        linked = conn.execute(
            "select asset.name, account.name from asset join account "
            "on account.id = asset.account_id order by asset.id"
        ).fetchall()
        entries = conn.execute("select count(*) from cash_entry").fetchone()[0]
        # Dados que já existiam seguem intactos.
        assets = conn.execute("select name, institution_id from asset order by id").fetchall()
        valuations = conn.execute(
            "select asset_id, date, invested_cents, current_cents, observed from asset_valuation "
            "order by asset_id"
        ).fetchall()
        movement = conn.execute(
            "select date, kind, asset_id, amount_cents, from_purchase from asset_movement"
        ).fetchone()
    assert accounts == [("Banco A", 1, 0), ("Corretora B", 2, 0)]
    assert linked == [("CDB", "Banco A"), ("LCI", "Banco A"), ("FII", "Corretora B")]
    assert entries == 0  # a migração não inventa saldo nem histórico
    assert assets == [("CDB", 1), ("LCI", 1), ("FII", 2)]
    assert valuations == [(i, "2026-09-30", 100_000, 101_000, 1) for i in (1, 2, 3)]
    assert movement == ("2026-09-15", "aporte", 1, 50_000, 0)
    # E o banco antigo foi copiado antes de migrar.
    assert len(list((tmp_path / "backups").glob("investment-*-rev0008.db"))) == 1


def test_cash_tables_enforce_signs_and_a_single_opening_balance(tmp_path):
    db = tmp_path / "investment.db"
    upgrade_to_head(sqlite_url(db))
    insert = (
        "insert into cash_entry (account_id, date, kind, amount_cents) "
        "values (1, '2026-10-01', ?, ?)"
    )
    with sqlite3.connect(db) as conn:
        conn.execute("insert into institution (name) values ('Banco')")
        conn.execute("insert into account (name, institution_id) values ('Banco', 1)")
        conn.execute(insert, ("saldo_inicial", 0))
        conn.execute(insert, ("deposito", 100))
        for kind, amount in [
            ("deposito", -1),
            ("compra", 1),
            ("provento", 0),
            ("ajuste", 0),
            ("saldo_inicial", 500),  # segundo saldo inicial na conta
            ("inexistente", 10),
        ]:
            try:
                conn.execute(insert, (kind, amount))
            except sqlite3.IntegrityError:
                continue
            raise AssertionError(f"o banco aceitou {kind} com {amount}")
        assert conn.execute("select count(*) from cash_entry").fetchone()[0] == 2


def test_cash_migration_downgrade_keeps_the_portfolio(tmp_path):
    db = tmp_path / "investment.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0008")
    _seed_before_cash(db)
    command.upgrade(config, "0009")

    command.downgrade(config, "0008")

    with sqlite3.connect(db) as conn:
        tables = {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
        asset_columns = {r[1] for r in conn.execute("pragma table_info(asset)")}
        movement_columns = {r[1] for r in conn.execute("pragma table_info(asset_movement)")}
        assets = conn.execute("select name from asset order by id").fetchall()
        valuations = conn.execute("select count(*) from asset_valuation").fetchone()[0]
    assert not {"account", "cash_entry"} & tables
    assert "account_id" not in asset_columns
    assert "from_purchase" not in movement_columns
    assert assets == [("CDB",), ("LCI",), ("FII",)]
    assert valuations == 3  # o downgrade não leva as valorizações junto


def test_cash_migration_handles_archived_assets_idle_institutions_and_case_only_names(tmp_path):
    db = tmp_path / "investment.db"
    url = sqlite_url(db)
    command.upgrade(alembic_config(url), "0008")
    with sqlite3.connect(db) as conn:
        # "Banco" e "banco" diferem só na caixa; "Parada" não tem nenhum ativo.
        conn.executemany(
            "insert into institution (name) values (?)", [("Banco",), ("banco",), ("Parada",)]
        )
        conn.execute(
            "insert into asset_class (key, name, color, archived) values ('rf', 'RF', '#111111', 0)"
        )
        conn.executemany(
            "insert into asset (name, class_id, institution_id, archived) values (?, 1, ?, ?)",
            [("CDB", 1, 0), ("Antigo", 2, 1)],  # o segundo está arquivado
        )

    upgrade_to_head(url)

    with sqlite3.connect(db) as conn:
        accounts = conn.execute("select name, institution_id from account order by id").fetchall()
        linked = conn.execute(
            "select asset.name, account.institution_id, asset.archived from asset "
            "join account on account.id = asset.account_id order by asset.id"
        ).fetchall()
    assert accounts == [("Banco", 1), ("banco", 2), ("Parada", 3)]
    assert linked == [("CDB", 1, 0), ("Antigo", 2, 1)]  # o ativo arquivado também ganha conta


def test_cash_migration_can_run_again_without_duplicating_or_failing(tmp_path):
    db = tmp_path / "investment.db"
    url = sqlite_url(db)
    config = alembic_config(url)
    command.upgrade(config, "0008")
    _seed_before_cash(db)
    upgrade_to_head(url)
    with sqlite3.connect(db) as conn:
        conn.execute("insert into account (name, institution_id) values ('Extra', 1)")
        conn.execute("update asset set account_id = 3 where name = 'LCI'")  # escolha do usuário

    # Banco que já tem o esquema e voltou a apontar para a revisão anterior.
    command.stamp(config, "0008")
    command.upgrade(config, "head")

    with sqlite3.connect(db) as conn:
        accounts = conn.execute("select name from account order by id").fetchall()
        linked = conn.execute("select name, account_id from asset order by id").fetchall()
    assert accounts == [("Banco A",), ("Corretora B",), ("Extra",)]
    assert linked == [("CDB", 1), ("LCI", 3), ("FII", 2)]  # nada sobrescrito


def test_sign_rule_is_the_same_in_the_migration_and_the_model():
    import importlib.util

    from app.core.config import BACKEND_DIR
    from app.features.cash.models import SIGN_RULE

    path = BACKEND_DIR / "migrations" / "versions" / "0009_caixa_contas_e_lancamentos.py"
    spec = importlib.util.spec_from_file_location("migration_0009", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.SIGN_RULE == SIGN_RULE


def test_index_level_migration_only_adds_an_empty_table_and_keeps_existing_data(tmp_path):
    db = tmp_path / "investment.db"
    url = sqlite_url(db)
    command.upgrade(alembic_config(url), "0009")
    _seed_before_cash(db)
    with sqlite3.connect(db) as conn:
        conn.execute(
            "insert into benchmark_daily (series, date, rate_e9) "
            "values ('cdi', '2026-10-01', 437390)"
        )
        before = {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}

    upgrade_to_head(url)

    with sqlite3.connect(db) as conn:
        tables = {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
        # Sobe até o fim: a tabela desta migração e as criadas depois dela (0016: asset_group).
        assert tables - before == {"benchmark_index_level", "asset_group"}
        assert conn.execute("select count(*) from benchmark_index_level").fetchone()[0] == 0
        assert conn.execute("select name from asset order by id").fetchall() == [
            ("CDB",),
            ("LCI",),
            ("FII",),
        ]
        assert conn.execute("select rate_e9 from benchmark_daily").fetchall() == [(437_390,)]
        # fetched_at nasce preenchido e (series, date) é único.
        insert = (
            "insert into benchmark_index_level (series, date, close_e2) "
            "values ('ibovespa', '2026-10-19', 12959329)"
        )
        conn.execute(insert)
        close, fetched = conn.execute(
            "select close_e2, fetched_at from benchmark_index_level"
        ).fetchone()
        assert close == 12_959_329
        assert fetched is not None
        try:
            conn.execute(insert)
        except sqlite3.IntegrityError:
            pass
        else:
            raise AssertionError("o banco aceitou o mesmo dia duas vezes")


def test_index_level_migration_can_run_again_without_losing_levels(tmp_path):
    db = tmp_path / "investment.db"
    url = sqlite_url(db)
    config = alembic_config(url)
    upgrade_to_head(url)
    with sqlite3.connect(db) as conn:
        conn.execute(
            "insert into benchmark_index_level (series, date, close_e2) "
            "values ('ibovespa', '2026-10-19', 12959329)"
        )

    command.stamp(config, "0009")
    command.upgrade(config, "head")

    with sqlite3.connect(db) as conn:
        levels = conn.execute("select date, close_e2 from benchmark_index_level").fetchall()
    assert levels == [("2026-10-19", 12_959_329)]


def test_index_level_migration_downgrade_removes_only_its_table(tmp_path):
    db = tmp_path / "investment.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0008")
    _seed_before_cash(db)
    command.upgrade(config, "0010")
    with sqlite3.connect(db) as conn:
        conn.execute(
            "insert into benchmark_index_level (series, date, close_e2) "
            "values ('ibovespa', '2026-10-19', 12959329)"
        )

    command.downgrade(config, "0009")

    with sqlite3.connect(db) as conn:
        tables = {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
        assets = conn.execute("select count(*) from asset").fetchone()[0]
        accounts = conn.execute("select count(*) from account").fetchone()[0]
    assert "benchmark_index_level" not in tables
    assert {"benchmark_daily", "benchmark_rate", "account", "cash_entry"} <= tables
    assert (assets, accounts) == (3, 2)


def _seed_plan_before_hold_only(db) -> None:
    """Plano como existia na revisão 0010: quatro categorias, 25% cada, uma ativa."""
    with sqlite3.connect(db) as conn:
        conn.executemany(
            "insert into asset_class (key, name, color, archived) values (?, ?, '#111111', 0)",
            [("rf", "RF"), ("acoes", "Ações"), ("fiis", "FIIs"), ("cripto", "Cripto")],
        )
        conn.execute("insert into allocation_plan (name, is_active) values ('Plano padrão', 1)")
        conn.executemany(
            "insert into allocation_target (plan_id, class_id, percent_bps) values (1, ?, 2500)",
            [(1,), (2,), (3,), (4,)],
        )


def test_hold_only_migration_keeps_every_plan_as_it_was(tmp_path):
    db = tmp_path / "investment.db"
    url = sqlite_url(db)
    command.upgrade(alembic_config(url), "0010")
    _seed_plan_before_hold_only(db)

    command.upgrade(alembic_config(url), "0011")

    with sqlite3.connect(db) as conn:
        targets = conn.execute(
            "select plan_id, class_id, percent_bps, hold_only from allocation_target "
            "order by class_id"
        ).fetchall()
        plan = conn.execute("select name, is_active from allocation_plan").fetchall()
        # Linha nova sem informar a coluna: nasce com o padrão, e a coluna é obrigatória.
        conn.execute("insert into allocation_plan (name, is_active) values ('Outro', 0)")
        conn.execute(
            "insert into allocation_target (plan_id, class_id, percent_bps) values (2, 1, 0)"
        )
        default = conn.execute(
            "select hold_only from allocation_target where plan_id = 2"
        ).fetchone()
        columns = {r[1]: r for r in conn.execute("pragma table_info(allocation_target)")}
    assert targets == [(1, i, 2_500, 0) for i in (1, 2, 3, 4)]
    assert plan == [("Plano padrão", 1)]
    assert default == (0,)
    assert columns["hold_only"][3] == 1  # NOT NULL


def test_hold_only_migration_can_run_again_without_losing_the_flag(tmp_path):
    db = tmp_path / "investment.db"
    url = sqlite_url(db)
    config = alembic_config(url)
    command.upgrade(config, "0010")
    _seed_plan_before_hold_only(db)
    command.upgrade(config, "0011")
    with sqlite3.connect(db) as conn:
        conn.execute(
            "update allocation_target set percent_bps = 0, hold_only = 1 where class_id = 4"
        )

    # Banco que já tem a coluna e voltou a apontar para a revisão anterior.
    command.stamp(config, "0010")
    command.upgrade(config, "0011")

    with sqlite3.connect(db) as conn:
        flags = conn.execute("select hold_only from allocation_target order by class_id").fetchall()
    assert flags == [(0,), (0,), (0,), (1,)]


def test_hold_only_migration_downgrade_drops_only_the_column(tmp_path):
    db = tmp_path / "investment.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0010")
    _seed_plan_before_hold_only(db)
    command.upgrade(config, "0011")
    with sqlite3.connect(db) as conn:
        conn.execute(
            "update allocation_target set percent_bps = 0, hold_only = 1 where class_id = 4"
        )
        conn.execute("update allocation_target set percent_bps = 5000 where class_id = 1")

    command.downgrade(config, "0010")

    with sqlite3.connect(db) as conn:
        columns = {r[1] for r in conn.execute("pragma table_info(allocation_target)")}
        targets = conn.execute(
            "select class_id, percent_bps from allocation_target order by class_id"
        ).fetchall()
        active = conn.execute("select name from allocation_plan where is_active = 1").fetchall()
    assert "hold_only" not in columns
    assert targets == [(1, 5_000), (2, 2_500), (3, 2_500), (4, 0)]
    assert sum(p for _, p in targets) == 10_000  # o plano continua somando 100%
    assert active == [("Plano padrão",)]


def _seed_held_portfolio(db) -> None:
    """Carteira na revisão 0011: quatro categorias, três planos e ativos em quatro situações."""
    _seed_plan_before_hold_only(db)  # categorias 1..4: rf, acoes, fiis, cripto; plano 1 ativo
    with sqlite3.connect(db) as conn:
        conn.execute("insert into institution (name) values ('Banco A')")
        conn.executemany(
            "insert into asset (name, class_id, institution_id, archived) values (?, ?, 1, ?)",
            [
                ("BTC", 4, 0),  # 1: categoria mantida, ativo
                ("ETH vendido", 4, 1),  # 2: categoria mantida, mas arquivado
                ("CDB", 1, 0),  # 3: categoria que recebe
                ("LCI", 1, 0),  # 4: idem
                ("PETR4", 2, 0),  # 5: categoria que recebe
            ],
        )
        conn.executemany(
            "insert into asset_valuation (asset_id, date, invested_cents, current_cents) "
            "values (?, '2026-09-30', 100000, 101000)",
            [(i,) for i in range(1, 6)],
        )
        # Plano 1 (ativo): mantém fiis (sem nenhum ativo) e cripto.
        # Plano 2 (inativo): mantém renda fixa em vez dessas; diverge do ativo.
        # Plano 3 (inativo): igual ao ativo; não há o que avisar.
        conn.execute("delete from allocation_target")
        conn.executemany(
            "insert into allocation_plan (name, is_active) values (?, 0)", [("B",), ("C",)]
        )
        conn.executemany(
            "insert into allocation_target (plan_id, class_id, percent_bps, hold_only) "
            "values (?, ?, ?, ?)",
            [
                (1, 1, 5_000, 0),
                (1, 2, 5_000, 0),
                (1, 3, 0, 1),
                (1, 4, 0, 1),
                (2, 1, 0, 1),
                (2, 2, 4_000, 0),
                (2, 3, 3_000, 0),
                (2, 4, 3_000, 0),
                (3, 1, 5_000, 0),
                (3, 2, 5_000, 0),
                (3, 3, 0, 1),
                (3, 4, 0, 1),
            ],
        )


def test_hold_moves_to_the_assets_of_the_held_categories_of_the_active_plan(tmp_path, caplog):
    db = tmp_path / "investment.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0011")
    _seed_held_portfolio(db)

    with caplog.at_level("WARNING"):
        command.upgrade(config, "0012")

    with sqlite3.connect(db) as conn:
        marks = conn.execute("select id, hold_only from asset order by id").fetchall()
        targets = conn.execute(
            "select plan_id, class_id, percent_bps from allocation_target order by 1, 2"
        ).fetchall()
        target_columns = {r[1] for r in conn.execute("pragma table_info(allocation_target)")}
        asset_hold = {r[1]: r for r in conn.execute("pragma table_info(asset)")}["hold_only"]
        valuations = conn.execute("select count(*) from asset_valuation").fetchone()[0]
        conn.execute(
            "insert into asset (name, class_id, institution_id, archived) values ('Novo', 1, 1, 0)"
        )
        default = conn.execute("select hold_only from asset where name = 'Novo'").fetchone()
    # Só o ativo não arquivado da categoria mantida recebe a marca; o arquivado e os das
    # categorias que recebem seguem como estavam.
    assert marks == [(1, 1), (2, 0), (3, 0), (4, 0), (5, 0)]
    assert "hold_only" not in target_columns
    assert len(targets) == 12 and (1, 4, 0) in targets and (2, 4, 3_000) in targets
    assert asset_hold[3] == 1 and default == (0,)  # NOT NULL, padrão 0
    assert valuations == 5  # mexer em `asset` não pode apagar o histórico dos ativos

    messages = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    # Plano inativo que diverge do ativo e categoria mantida sem ativos: avisados.
    assert any("'B'" in m for m in messages)
    assert any("'FIIs'" in m for m in messages)
    assert not any("'C'" in m for m in messages)  # o plano igual ao ativo não gera aviso
    assert len(messages) == 2


def test_hold_migration_without_any_held_category_marks_nothing_and_stays_quiet(tmp_path, caplog):
    db = tmp_path / "investment.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0011")
    _seed_held_portfolio(db)
    with sqlite3.connect(db) as conn:
        conn.execute("update allocation_target set hold_only = 0")

    with caplog.at_level("WARNING"):
        command.upgrade(config, "0012")

    with sqlite3.connect(db) as conn:
        assert conn.execute("select count(*) from asset where hold_only = 1").fetchone() == (0,)
    assert not [r for r in caplog.records if r.levelname == "WARNING"]


def test_hold_migration_downgrade_restores_marks_where_the_old_rule_still_holds(tmp_path):
    db = tmp_path / "investment.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0011")
    _seed_held_portfolio(db)
    command.upgrade(config, "0012")
    with sqlite3.connect(db) as conn:
        # Renda fixa fica pela metade: um ativo mantido e outro não.
        conn.execute("update asset set hold_only = 1 where id = 3")

    command.downgrade(config, "0011")

    with sqlite3.connect(db) as conn:
        held = conn.execute(
            "select plan_id, class_id from allocation_target where hold_only = 1 order by 1, 2"
        ).fetchall()
        asset_columns = {r[1] for r in conn.execute("pragma table_info(asset)")}
        valuations = conn.execute("select count(*) from asset_valuation").fetchone()[0]
        percents = conn.execute(
            "select plan_id, class_id, percent_bps from allocation_target order by 1, 2"
        ).fetchall()
        target_columns = {r[1]: r for r in conn.execute("pragma table_info(allocation_target)")}
    # Cripto (todos os ativos não arquivados mantidos; o arquivado não conta) volta marcada onde a
    # meta é 0%: planos 1 e 3. No plano 2 a meta é 3.000 e a marca não volta. Fiis não tem ativos e
    # renda fixa está pela metade: ficam sem marca em todos os planos.
    assert held == [(1, 4), (3, 4)]
    assert "hold_only" not in asset_columns
    assert valuations == 5
    assert len(percents) == 12
    assert target_columns["hold_only"][3] == 1  # NOT NULL
    assert sum(p for plan, _, p in percents if plan == 1) == 10_000


def test_hold_migration_downgrade_marks_a_category_whose_active_assets_are_all_held(tmp_path):
    db = tmp_path / "investment.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0011")
    _seed_held_portfolio(db)
    command.upgrade(config, "0012")
    with sqlite3.connect(db) as conn:
        conn.execute("update asset set hold_only = 1 where class_id = 1")  # CDB e LCI

    command.downgrade(config, "0011")

    with sqlite3.connect(db) as conn:
        held = conn.execute(
            "select plan_id, class_id from allocation_target where hold_only = 1 order by 1, 2"
        ).fetchall()
    # Renda fixa só tem meta 0% no plano 2: é o único lugar onde a marca volta para ela.
    assert held == [(1, 4), (2, 1), (3, 4)]


def test_hold_migration_warning_says_the_mark_is_global_and_lists_the_old_percentages(
    tmp_path, caplog
):
    db = tmp_path / "migrated.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0011")
    _seed_held_portfolio(db)

    with caplog.at_level("WARNING"):
        command.upgrade(config, "0012")

    messages = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    inactive = next(m for m in messages if "'B'" in m)
    assert "agora e do ativo e vale para todos os planos" in inactive
    assert "valem as marcas do plano ativo (Cripto, FIIs)" in inactive
    assert "NAO foram alteradas" in inactive
    # O plano B tinha 30% em FIIs e em Cripto, categorias que agora estao mantidas.
    assert "FIIs 30,00%" in inactive and "Cripto 30,00%" in inactive
    assert "se perde" not in inactive  # o texto antigo, enganoso, saiu


def test_hold_migration_can_run_again_on_a_database_that_already_has_the_new_shape(tmp_path):
    db = tmp_path / "migrated.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0011")
    _seed_held_portfolio(db)
    command.upgrade(config, "0012")
    with sqlite3.connect(db) as conn:
        conn.execute("update asset set hold_only = 1 where id = 5")  # marca feita depois

    # `asset` já tem a coluna e `allocation_target` já não tem a antiga: a revisão só completa.
    command.stamp(config, "0011")
    command.upgrade(config, "0012")

    with sqlite3.connect(db) as conn:
        marks = conn.execute("select id, hold_only from asset order by id").fetchall()
        target_columns = {r[1] for r in conn.execute("pragma table_info(allocation_target)")}
        valuations = conn.execute("select count(*) from asset_valuation").fetchone()[0]
        revision = conn.execute("select version_num from alembic_version").fetchone()[0]
    assert marks == [(1, 1), (2, 0), (3, 0), (4, 0), (5, 1)]  # nada foi refeito nem perdido
    assert "hold_only" not in target_columns
    assert valuations == 5
    assert revision == "0012"


def test_reading_plans_after_the_upgrade_never_rewrites_a_stored_target(tmp_path):
    from sqlalchemy.orm import sessionmaker

    from app.features.allocation.schemas import SplitIn
    from app.features.allocation.service import get_plan, list_plans, split_contribution

    db = tmp_path / "migrated.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0011")
    _seed_held_portfolio(db)
    with sqlite3.connect(db) as conn:
        before = conn.execute(
            "select plan_id, class_id, percent_bps from allocation_target order by 1, 2"
        ).fetchall()
    command.upgrade(config, "head")  # os modelos lidos abaixo são os do esquema mais novo

    engine = create_engine(sqlite_url(db))
    with sessionmaker(bind=engine, expire_on_commit=False)() as session:
        plans = list_plans(session)  # a primeira leitura depois da atualização
        get_plan(session, 2)
        split = split_contribution(session, SplitIn(amount_cents=10_000))
    engine.dispose()

    with sqlite3.connect(db) as conn:
        after = conn.execute(
            "select plan_id, class_id, percent_bps from allocation_target order by 1, 2"
        ).fetchall()
    assert after == before  # nem o plano ativo nem os inativos mudaram uma meta
    inactive = next(p for p in plans if p.name == "B")
    assert {t.class_name: t.percent_bps for t in inactive.targets}["Ações"] == 4_000
    # O plano ativo tem FIIs e cripto com meta 0% e continua válido (soma 10.000).
    active = next(p for p in plans if p.is_active)
    assert sum(t.percent_bps for t in active.targets) == 10_000
    assert sum(item.amount_cents for item in split.items) == 10_000


# ---- 0014: aporte inicial do ativo novo ------------------------------------------------------


def _seed_before_initial(db) -> None:
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
        conn.executemany(
            "insert into asset_movement (id, date, kind, asset_id, amount_cents) "
            "values (?, ?, ?, ?, ?)",
            [(1, "2026-10-05", "aporte", 1, 5_000), (2, "2026-10-06", "provento", 1, 700)],
        )


def test_initial_migration_keeps_every_movement_as_an_ordinary_one(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0013")
    _seed_before_initial(db)

    command.upgrade(config, "0014")

    with sqlite3.connect(db) as conn:
        rows = conn.execute("select id, kind, amount_cents, initial from asset_movement").fetchall()
        column = {r[1]: r for r in conn.execute("pragma table_info(asset_movement)")}["initial"]
        valuations = conn.execute("select count(*) from asset_valuation").fetchone()[0]
    # Sem backfill: ativos existentes continuam "antigos"; nada é apagado.
    assert rows == [(1, "aporte", 5_000, 0), (2, "provento", 700, 0)]
    assert column[3] == 1 and column[4] == "0"  # NOT NULL, padrão 0
    assert valuations == 1


def test_initial_index_allows_one_initial_per_asset_and_any_number_of_ordinary(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0014")
    _seed_before_initial(db)
    insert = (
        "insert into asset_movement (date, kind, asset_id, amount_cents, initial) "
        "values ('2026-09-30', 'aporte', ?, 100, ?)"
    )

    with sqlite3.connect(db) as conn:
        conn.execute(insert, (1, 1))
        conn.execute(insert, (2, 1))  # outro ativo pode ter o seu
        conn.execute(insert, (1, 0))
        conn.execute(insert, (1, 0))  # comuns não têm limite
        try:
            conn.execute(insert, (1, 1))
        except sqlite3.IntegrityError:
            refused = True
        else:
            refused = False
    assert refused


def test_initial_migration_can_run_again_without_failing(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0014")
    _seed_before_initial(db)
    with sqlite3.connect(db) as conn:
        conn.execute("update asset_movement set initial = 1 where id = 1")

    command.stamp(config, "0013")
    command.upgrade(config, "0014")  # coluna e índice já existem

    with sqlite3.connect(db) as conn:
        assert conn.execute("select initial from asset_movement where id = 1").fetchone() == (1,)


def test_initial_migration_downgrade_drops_the_column_and_the_derived_initials(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0014")
    _seed_before_initial(db)
    with sqlite3.connect(db) as conn:
        conn.execute(
            "insert into asset_movement (id, date, kind, asset_id, amount_cents, initial) "
            "values (3, '2026-09-30', 'aporte', 2, 900, 1)"
        )

    command.downgrade(config, "0013")

    with sqlite3.connect(db) as conn:
        columns = {r[1] for r in conn.execute("pragma table_info(asset_movement)")}
        ids = [r[0] for r in conn.execute("select id from asset_movement order by id")]
        indexes = {r[1] for r in conn.execute("pragma index_list(asset_movement)")}
        assets = conn.execute("select count(*) from asset").fetchone()[0]
    # O inicial é derivado do valor do ativo e não mexe em saldos: sem a coluna, viraria um
    # aporte comum e seria contado em dobro. Os demais movimentos ficam.
    assert "initial" not in columns and "uq_movement_initial_per_asset" not in indexes
    assert ids == [1, 2]
    assert assets == 2


# ---- 0015: resgate (observação e marca de saldo já sem o dinheiro) --------------------------


def test_redemption_migration_keeps_every_movement_without_note_and_not_in_balance(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0014")
    _seed_before_initial(db)

    command.upgrade(config, "0015")

    with sqlite3.connect(db) as conn:
        rows = conn.execute(
            "select id, kind, amount_cents, note, in_balance from asset_movement order by id"
        ).fetchall()
        columns = {r[1]: r for r in conn.execute("pragma table_info(asset_movement)")}
        valuations = conn.execute("select count(*) from asset_valuation").fetchone()[0]
        # Linha nova sem informar as colunas: nasce com o padrão.
        conn.execute(
            "insert into asset_movement (date, kind, asset_id, amount_cents, cost_cents) "
            "values ('2026-10-10', 'resgate', 1, 500, 450)"
        )
        fresh = conn.execute("select note, in_balance from asset_movement where id = 3").fetchone()
    assert rows == [(1, "aporte", 5_000, None, 0), (2, "provento", 700, None, 0)]
    assert columns["note"][3] == 0 and columns["note"][2] == "VARCHAR(120)"  # opcional
    assert columns["in_balance"][3] == 1 and columns["in_balance"][4] == "0"  # NOT NULL, padrão 0
    assert fresh == (None, 0)
    assert valuations == 1


def test_redemption_migration_can_run_again_without_losing_the_columns_data(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0015")
    _seed_before_initial(db)
    with sqlite3.connect(db) as conn:
        conn.execute("update asset_movement set note = 'Viagem', in_balance = 1 where id = 1")

    command.stamp(config, "0014")
    command.upgrade(config, "0015")  # as colunas já existem

    with sqlite3.connect(db) as conn:
        row = conn.execute("select note, in_balance from asset_movement where id = 1").fetchone()
    assert row == ("Viagem", 1)


def test_redemption_migration_downgrade_drops_only_the_columns_when_there_is_no_redemption(
    tmp_path,
):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0015")
    _seed_before_initial(db)

    command.downgrade(config, "0014")

    with sqlite3.connect(db) as conn:
        columns = {r[1] for r in conn.execute("pragma table_info(asset_movement)")}
        ids = [r[0] for r in conn.execute("select id from asset_movement order by id")]
        revision = conn.execute("select version_num from alembic_version").fetchone()[0]
    assert not {"note", "in_balance"} & columns and "initial" in columns
    assert ids == [1, 2]
    assert revision == "0014"


def test_redemption_migration_downgrade_refuses_to_run_with_a_redemption_and_deletes_nothing(
    tmp_path,
):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0015")
    _seed_before_initial(db)
    with sqlite3.connect(db) as conn:
        conn.execute(
            "insert into asset_movement (id, date, kind, asset_id, amount_cents, cost_cents, note) "
            "values (3, '2026-10-10', 'resgate', 1, 500, 450, 'Viagem')"
        )

    with pytest.raises(RuntimeError, match="1 resgate"):
        command.downgrade(config, "0014")

    with sqlite3.connect(db) as conn:
        columns = {r[1] for r in conn.execute("pragma table_info(asset_movement)")}
        kept = conn.execute("select kind, amount_cents, note from asset_movement where id = 3")
        revision = conn.execute("select version_num from alembic_version").fetchone()[0]
        assert kept.fetchall() == [("resgate", 500, "Viagem")]
        assert conn.execute("select count(*) from asset_movement").fetchone()[0] == 3
    assert {"note", "in_balance"} <= columns  # nada foi mexido
    assert revision == "0015"


# ---- 0016: grupos de categorias ----------------------------------------------------------------


def _seed_classes(db) -> None:
    with sqlite3.connect(db) as conn:
        conn.executemany(
            "insert into asset_class (id, key, name, color, archived) values (?, ?, ?, ?, ?)",
            [
                (1, "renda_fixa", "Renda Fixa", "#5aa88a", 0),
                (2, "fii", "FII", "#5b8fd9", 0),
                (3, "antiga", "Antiga", "#123456", 1),
            ],
        )
        conn.execute("insert into institution (id, name) values (1, 'Banco')")
        conn.execute(
            "insert into asset (id, name, class_id, institution_id, archived) "
            "values (1, 'CDB', 1, 1, 0)"
        )
        conn.execute(
            "insert into asset_valuation (asset_id, date, invested_cents, current_cents) "
            "values (1, '2026-09-30', 100, 110)"
        )


def test_group_migration_adds_an_empty_table_and_leaves_every_category_ungrouped(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0015")
    _seed_classes(db)
    with sqlite3.connect(db) as conn:
        before = conn.execute(
            "select id, key, name, color, archived from asset_class order by id"
        ).fetchall()

    command.upgrade(config, "0016")

    with sqlite3.connect(db) as conn:
        after = conn.execute(
            "select id, key, name, color, archived from asset_class order by id"
        ).fetchall()
        groups = conn.execute("select count(*) from asset_group").fetchone()[0]
        grouped = conn.execute("select group_id from asset_class order by id").fetchall()
        asset = conn.execute("select name, class_id from asset").fetchall()
        valuation = conn.execute("select invested_cents, current_cents from asset_valuation")
        assert valuation.fetchall() == [(100, 110)]
        revision = conn.execute("select version_num from alembic_version").fetchone()[0]
        columns = {r[1]: r for r in conn.execute("pragma table_info(asset_class)")}
        group_columns = {r[1]: r for r in conn.execute("pragma table_info(asset_group)")}
        foreign = conn.execute("pragma foreign_key_list(asset_class)").fetchall()
    assert after == before  # nenhuma linha existente mudou
    assert groups == 0  # nenhum grupo é criado sozinho
    assert grouped == [(None,), (None,), (None,)]
    assert asset == [("CDB", 1)]
    assert columns["group_id"][3] == 0  # opcional
    assert set(group_columns) == {"id", "name", "color", "archived"}
    assert group_columns["archived"][3] == 1 and group_columns["archived"][4] == "0"
    assert [(f[2], f[3], f[4]) for f in foreign] == [("asset_group", "group_id", "id")]
    assert revision == "0016"


def test_group_table_enforces_unique_names_and_the_foreign_key(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0016")
    _seed_classes(db)

    with sqlite3.connect(db) as conn:
        conn.execute("pragma foreign_keys = on")
        conn.execute("insert into asset_group (id, name, color) values (1, 'Bolsa', '#111111')")
        conn.execute("update asset_class set group_id = 1 where id = 2")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("insert into asset_group (name, color) values ('Bolsa', '#222222')")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("update asset_class set group_id = 99 where id = 1")
        assert conn.execute("select archived from asset_group").fetchall() == [(0,)]


def test_group_migration_can_run_again_without_losing_groups(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0016")
    _seed_classes(db)
    with sqlite3.connect(db) as conn:
        conn.execute("insert into asset_group (id, name, color) values (1, 'Bolsa', '#111111')")
        conn.execute("update asset_class set group_id = 1 where id = 2")

    command.stamp(config, "0015")
    command.upgrade(config, "0016")  # a tabela e a coluna já existem

    with sqlite3.connect(db) as conn:
        assert conn.execute("select name from asset_group").fetchall() == [("Bolsa",)]
        assert conn.execute("select group_id from asset_class order by id").fetchall() == [
            (None,),
            (1,),
            (None,),
        ]


def test_group_migration_downgrade_removes_only_the_group_structures(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0016")
    _seed_classes(db)
    with sqlite3.connect(db) as conn:
        before = conn.execute(
            "select id, key, name, color, archived from asset_class order by id"
        ).fetchall()

    command.downgrade(config, "0015")

    with sqlite3.connect(db) as conn:
        columns = {r[1] for r in conn.execute("pragma table_info(asset_class)")}
        tables = {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
        after = conn.execute(
            "select id, key, name, color, archived from asset_class order by id"
        ).fetchall()
        assets = conn.execute("select name, class_id from asset").fetchall()
        revision = conn.execute("select version_num from alembic_version").fetchone()[0]
        conn.execute("pragma foreign_keys = on")
        assert conn.execute("pragma foreign_key_check").fetchall() == []
    assert "group_id" not in columns and "asset_group" not in tables
    assert after == before and assets == [("CDB", 1)]
    assert revision == "0015"
    command.upgrade(config, "0016")  # e dá para subir de novo


def test_group_migration_downgrade_refuses_to_run_with_a_group_and_deletes_nothing(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0016")
    _seed_classes(db)
    with sqlite3.connect(db) as conn:
        conn.execute("insert into asset_group (id, name, color) values (1, 'Bolsa', '#111111')")
        conn.execute("update asset_class set group_id = 1 where id = 2")

    with pytest.raises(RuntimeError, match="1 grupo"):
        command.downgrade(config, "0015")

    with sqlite3.connect(db) as conn:
        assert conn.execute("select name from asset_group").fetchall() == [("Bolsa",)]
        assert conn.execute("select group_id from asset_class where id = 2").fetchone() == (1,)
        revision = conn.execute("select version_num from alembic_version").fetchone()[0]
    assert revision == "0016"


# ---- 0017: aporte fora da meta -----------------------------------------------------------------


def test_off_goal_migration_leaves_every_existing_movement_counting_in_the_goal(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0016")
    _seed_before_initial(db)
    with sqlite3.connect(db) as conn:
        before = conn.execute(
            "select id, date, kind, asset_id, amount_cents, cost_cents, initial, from_purchase "
            "from asset_movement order by id"
        ).fetchall()
        valuations = conn.execute("select * from asset_valuation").fetchall()

    command.upgrade(config, "0017")

    with sqlite3.connect(db) as conn:
        rows = conn.execute("select id, off_goal from asset_movement order by id").fetchall()
        after = conn.execute(
            "select id, date, kind, asset_id, amount_cents, cost_cents, initial, from_purchase "
            "from asset_movement order by id"
        ).fetchall()
        columns = {r[1]: r for r in conn.execute("pragma table_info(asset_movement)")}
        # Linha nova sem informar a coluna: nasce com o padrão (conta na meta).
        conn.execute(
            "insert into asset_movement (date, kind, asset_id, amount_cents) "
            "values ('2026-10-10', 'aporte', 1, 900)"
        )
        fresh = conn.execute("select off_goal from asset_movement where id = 3").fetchone()
        assert conn.execute("select * from asset_valuation").fetchall() == valuations
        conn.execute("pragma foreign_keys = on")
        assert conn.execute("pragma foreign_key_check").fetchall() == []
    assert rows == [(1, 0), (2, 0)]
    assert after == before  # nada além da coluna nova mudou
    assert columns["off_goal"][3] == 1 and columns["off_goal"][4] == "0"  # NOT NULL, padrão 0
    assert fresh == (0,)


def test_off_goal_migration_can_run_again_without_losing_the_marks(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0017")
    _seed_before_initial(db)
    with sqlite3.connect(db) as conn:
        conn.execute("update asset_movement set off_goal = 1 where id = 1")

    command.stamp(config, "0016")
    command.upgrade(config, "0017")  # a coluna já existe

    with sqlite3.connect(db) as conn:
        rows = conn.execute("select id, off_goal from asset_movement order by id").fetchall()
    assert rows == [(1, 1), (2, 0)]


def test_off_goal_migration_downgrade_drops_only_the_column_and_can_go_up_again(tmp_path):
    db = tmp_path / "antigo.db"
    config = alembic_config(sqlite_url(db))
    command.upgrade(config, "0017")
    _seed_before_initial(db)
    with sqlite3.connect(db) as conn:
        conn.execute("update asset_movement set off_goal = 1 where id = 1")
        before = conn.execute(
            "select id, date, kind, asset_id, amount_cents from asset_movement order by id"
        ).fetchall()

    command.downgrade(config, "0016")

    with sqlite3.connect(db) as conn:
        columns = {r[1] for r in conn.execute("pragma table_info(asset_movement)")}
        rows = conn.execute(
            "select id, date, kind, asset_id, amount_cents from asset_movement order by id"
        ).fetchall()
        revision = conn.execute("select version_num from alembic_version").fetchone()[0]
    assert "off_goal" not in columns and {"initial", "in_balance"} <= columns
    assert rows == before  # nenhum movimento nem valor se perde
    assert revision == "0016"

    command.upgrade(config, "0017")
    with sqlite3.connect(db) as conn:
        assert conn.execute("select off_goal from asset_movement order by id").fetchall() == [
            (0,),
            (0,),
        ]
