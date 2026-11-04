import copy
import logging
import sqlite3
from datetime import datetime

import pytest
from alembic import command

from app.core.migrate import alembic_config, head_revision, revision_chain

API = "/api/v1"


def populate(client, make_asset):
    """Um pouco de tudo: ativos, valores, aporte, plano, reserva, movimento e snapshot."""
    cdb = make_asset(name="CDB", class_key="renda_fixa", invested=100_000, current=110_000)
    fii = make_asset(
        name="HGLG11",
        class_key="renda_variavel",
        invested=50_000,
        current=52_000,
        asset_type="fii",
        fii_segment="tijolo",
    )
    client.put(f"{API}/contributions/2026-09", json={"salary_cents": 900_000, "percent_bps": 1_000})
    client.post(
        f"{API}/assets/{cdb['id']}/balance",
        json={"date": "2099-01-01", "balance_cents": 125_000, "contribution_cents": 10_000},
    )
    client.post(
        f"{API}/proventos", json={"asset_id": fii["id"], "amount_cents": 500, "date": "2099-01-02"}
    )
    client.put(
        f"{API}/reserve", json={"goal_cents": 5_400_000, "months": 6, "monthly_cents": 100_000}
    )
    client.post(f"{API}/snapshots", json={"date": "2026-09-30"})
    client.post(f"{API}/snapshots", json={"date": "2026-10-31"})


def export(client):
    response = client.get(f"{API}/backup/export")
    assert response.status_code == 200
    return response.json()


def state(client):
    """Foto comparável do estado: tudo que o usuário enxerga nas telas principais."""
    return {
        "summary": client.get(f"{API}/portfolio/summary").json(),
        "assets": client.get(f"{API}/assets?include_archived=true").json(),
        "snapshots": client.get(f"{API}/snapshots").json(),
        "contributions": client.get(f"{API}/contributions").json(),
        "movements": client.get(f"{API}/movements").json(),
        "reserve": client.get(f"{API}/reserve").json(),
        "plans": client.get(f"{API}/allocation/plans").json(),
    }


# ---- exportar ----------------------------------------------------------------------------


def test_export_has_header_every_table_and_is_a_download(client, make_asset):
    populate(client, make_asset)
    response = client.get(f"{API}/backup/export")
    assert "attachment" in response.headers["content-disposition"]
    assert "investment-lab-backup-" in response.headers["content-disposition"]

    body = response.json()
    assert body["app"] == "investment-lab"
    assert body["format_version"] == 1
    assert body["schema_revision"] == head_revision()
    assert body["exported_at"]
    tables = body["tables"]
    for name in (
        "asset",
        "asset_valuation",
        "asset_movement",
        "snapshot",
        "snapshot_item",
        "contribution",
        "asset_class",
        "allocation_plan",
        "reserve_setting",
        "benchmark_rate",
    ):
        assert name in tables, name
    assert len(tables["asset"]) == 2
    assert tables["asset"][1]["fii_segment"] == "tijolo"
    assert isinstance(tables["snapshot"][0]["date"], str)  # datas viram texto ISO


# ---- conferir ----------------------------------------------------------------------------


def test_inspect_summarizes_a_valid_backup(client, make_asset):
    populate(client, make_asset)
    body = client.post(f"{API}/backup/inspect", json=export(client)).json()
    assert body["valid"] is True
    assert body["compatible"] is True
    assert body["problems"] == []
    assert body["counts"]["asset"] == 2
    assert body["counts"]["snapshot"] == 2
    assert (body["snapshots_from"], body["snapshots_to"]) == ("2026-09-30", "2026-10-31")
    assert body["schema_revision"] == body["current_revision"] == head_revision()


@pytest.mark.parametrize(
    "change, fragment",
    [
        (lambda p: p.update(app="outro-app"), "não é um backup do Investment Lab"),
        (lambda p: p.update(format_version=99), "Formato de backup não suportado"),
        (lambda p: p.update(schema_revision="9999"), "versão 9999 do esquema"),
        (lambda p: p["tables"].update(tabela_estranha=[]), "Tabelas desconhecidas"),
        (lambda p: p.update(tables="nada"), "não traz a lista de tabelas"),
    ],
)
def test_inspect_flags_problems_without_failing(client, change, fragment):
    payload = copy.deepcopy(export(client))
    change(payload)
    response = client.post(f"{API}/backup/inspect", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    assert any(fragment in problem for problem in body["problems"]), body["problems"]


def test_inspect_rejects_a_bad_export_date(client):
    payload = copy.deepcopy(export(client))
    payload["exported_at"] = "ontem"
    body = client.post(f"{API}/backup/inspect", json=payload).json()
    assert body["valid"] is False
    assert any("data de exportação" in p for p in body["problems"])


# ---- restaurar ---------------------------------------------------------------------------


def test_restore_replaces_current_data_with_the_backup(client, make_asset):
    populate(client, make_asset)
    backup = export(client)
    before = state(client)

    # Depois do backup, o usuário mexe: novo ativo, snapshot apagado, aporte alterado.
    make_asset(name="Extra", class_key="cripto", invested=1, current=1)
    snapshot_id = client.get(f"{API}/snapshots").json()[0]["id"]
    client.delete(f"{API}/snapshots/{snapshot_id}")
    client.put(f"{API}/contributions/2026-09", json={"salary_cents": 1, "percent_bps": 1})
    assert state(client) != before

    response = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True})
    assert response.status_code == 200
    assert response.json()["counts"]["asset"] == 2
    assert state(client) == before
    # O export depois da restauração é igual ao original (exceto a hora em que foi gerado).
    again = export(client)
    again["exported_at"] = backup["exported_at"]
    assert again == backup


def test_backup_carries_accounts_and_the_cash_ledger_through_a_restore(client, make_asset):
    from datetime import date, timedelta

    def day(offset):
        return (date.today() + timedelta(days=offset)).isoformat()

    cdb = make_asset(name="CDB", invested=100_000, current=100_000)
    account = client.get(f"{API}/accounts").json()[0]["id"]
    other = client.post(f"{API}/accounts", json={"name": "Extra", "institution_id": 1}).json()["id"]
    client.post(
        f"{API}/accounts/{account}/opening-balance", json={"date": day(-30), "amount_cents": 5_000}
    )
    client.post(
        f"{API}/accounts/{other}/opening-balance", json={"date": day(-30), "amount_cents": 0}
    )
    client.post(f"{API}/accounts/{account}/deposits", json={"date": day(-5), "amount_cents": 2_000})
    client.post(
        f"{API}/cash/transfers",
        json={"from_account_id": account, "to_account_id": other, "amount_cents": 700},
    )
    client.post(f"{API}/purchases", json={"asset_id": cdb["id"], "amount_cents": 1_500})

    def ledger():
        return {
            "accounts": client.get(f"{API}/accounts?include_archived=true").json(),
            "statement": client.get(f"{API}/accounts/{account}/entries").json(),
            "other": client.get(f"{API}/accounts/{other}/entries").json(),
            "capital": client.get(f"{API}/cash/contributed-capital").json(),
            "asset": client.get(f"{API}/assets/{cdb['id']}").json(),
        }

    backup = export(client)
    assert len(backup["tables"]["account"]) == 2
    assert len(backup["tables"]["cash_entry"]) == 6
    before = ledger()

    # Depois do backup o usuário mexe no caixa; restaurar volta tudo, inclusive os vínculos.
    client.post(
        f"{API}/accounts/{account}/withdrawals", json={"date": day(-1), "amount_cents": 100}
    )
    assert ledger() != before
    response = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True})

    assert response.status_code == 200, response.text
    assert response.json()["counts"]["cash_entry"] == 6
    assert ledger() == before


def test_backup_carries_the_asset_marks_through_a_restore(client, make_asset):
    cdb = make_asset(name="CDB", class_key="renda_fixa", invested=100_000, current=100_000)
    btc = make_asset(name="BTC", class_key="cripto", invested=500_000, current=500_000)
    plans = f"{API}/allocation/plans"
    plan = client.get(plans).json()[0]
    marked = {key: btc[key] for key in (
        "name", "class_key", "institution_id", "ticker", "indexer", "rate_bps", "maturity_date",
        "quantity", "purpose", "asset_type", "fii_segment", "account_id", "archived",
    )} | {"hold_only": True}  # fmt: skip
    assert client.put(f"{API}/assets/{btc['id']}", json=marked).status_code == 200
    backup = export(client)
    # A marca mora nos ativos: o backup a leva na tabela asset, e as metas não têm mais a coluna.
    assert {a["name"]: a["hold_only"] for a in backup["tables"]["asset"]} == {
        "CDB": False,
        "BTC": True,
    }
    assert all("hold_only" not in row for row in backup["tables"]["allocation_target"])
    before = state(client)

    unmarked = marked | {"hold_only": False}
    client.put(f"{API}/assets/{btc['id']}", json=unmarked)
    equal_shares = [
        {"class_key": key, "percent_bps": 2_500}
        for key in ("renda_fixa", "renda_variavel", "acoes_etfs", "cripto")
    ]
    client.put(f"{plans}/{plan['id']}", json={"name": plan["name"], "targets": equal_shares})

    response = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True})

    assert response.status_code == 200, response.text
    assert state(client) == before
    assert {a["name"]: a["hold_only"] for a in client.get(f"{API}/assets").json()} == {
        "CDB": False,
        "BTC": True,
    }
    assert cdb["hold_only"] is False


def test_backup_without_the_asset_column_restores_with_every_mark_off(client, make_asset):
    make_asset(name="BTC", class_key="cripto", invested=500_000, current=500_000)
    backup = copy.deepcopy(export(client))
    assets = backup["tables"]["asset"]
    assert assets
    for row in assets:
        del row["hold_only"]  # arquivo sem a coluna

    response = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True})

    assert response.status_code == 200, response.text
    assert [a["hold_only"] for a in client.get(f"{API}/assets").json()] == [False]
    restored = client.get(f"{API}/allocation/plans").json()[0]
    assert sum(t["percent_bps"] for t in restored["targets"]) == 10_000


def test_restore_requires_explicit_confirmation(client, make_asset):
    populate(client, make_asset)
    backup = export(client)
    before = state(client)
    response = client.post(f"{API}/backup/restore", json={"backup": backup})
    assert response.status_code == 422
    assert "Confirme" in response.json()["detail"]
    assert state(client) == before


def test_restore_of_an_invalid_file_changes_nothing(client, make_asset):
    populate(client, make_asset)
    before = state(client)
    bad = copy.deepcopy(export(client))
    bad["schema_revision"] = "9999"
    response = client.post(f"{API}/backup/restore", json={"backup": bad, "confirm": True})
    assert response.status_code == 422
    assert state(client) == before


def test_restore_rolls_back_when_the_data_is_inconsistent(client, make_asset):
    populate(client, make_asset)
    before = state(client)
    broken = copy.deepcopy(export(client))
    broken["tables"]["asset"][0]["institution_id"] = 9_999  # instituição que não existe

    response = client.post(f"{API}/backup/restore", json={"backup": broken, "confirm": True})
    assert response.status_code == 422
    assert "nenhum dado foi alterado" in response.json()["detail"]
    assert state(client) == before  # a transação desfez o apagamento


def test_restore_rolls_back_on_a_malformed_value(client, make_asset):
    populate(client, make_asset)
    before = state(client)
    broken = copy.deepcopy(export(client))
    broken["tables"]["snapshot"][0]["date"] = "não é data"
    assert (
        client.post(f"{API}/backup/restore", json={"backup": broken, "confirm": True}).status_code
        == 422
    )
    assert state(client) == before


def test_restore_makes_a_safety_copy_of_the_database_file(
    client, make_asset, isolated_database_file
):
    populate(client, make_asset)
    isolated_database_file.parent.mkdir(parents=True)
    with sqlite3.connect(isolated_database_file) as conn:
        conn.execute("create table marcador (x integer)")
        conn.execute("insert into marcador values (42)")

    result = client.post(
        f"{API}/backup/restore", json={"backup": export(client), "confirm": True}
    ).json()

    safety = result["safety_backup"]
    assert safety and "antes-da-restauracao" in safety
    with sqlite3.connect(safety) as copy_db:
        assert copy_db.execute("select x from marcador").fetchone() == (42,)


# ---- reiniciar ---------------------------------------------------------------------------


def test_reset_requires_the_exact_confirmation_word(client, make_asset):
    populate(client, make_asset)
    before = state(client)
    for confirm in ("", "apagar", "SIM", "APAGAR "):
        response = client.post(f"{API}/backup/reset", json={"confirm": confirm})
        assert response.status_code == 422, confirm
    assert state(client) == before


def test_reset_wipes_user_data_but_keeps_the_starting_point(client, make_asset):
    populate(client, make_asset)
    response = client.post(f"{API}/backup/reset", json={"confirm": "APAGAR"})
    assert response.status_code == 200
    counts = response.json()["counts"]
    assert counts["asset"] == 0
    assert counts["snapshot"] == 0
    assert counts["contribution"] == 0
    assert counts["asset_movement"] == 0

    classes = client.get(f"{API}/asset-classes").json()
    assert [c["key"] for c in classes] == ["renda_fixa", "renda_variavel", "acoes_etfs", "cripto"]
    plans = client.get(f"{API}/allocation/plans").json()
    assert len(plans) == 1 and plans[0]["is_active"]
    assert client.get(f"{API}/assets").json() == []
    assert client.get(f"{API}/portfolio/summary").json()["total_current_cents"] == 0


def test_reset_makes_a_safety_copy_and_the_data_can_come_back(
    client, make_asset, isolated_database_file
):
    populate(client, make_asset)
    backup = export(client)
    before = state(client)
    isolated_database_file.parent.mkdir(parents=True)
    with sqlite3.connect(isolated_database_file) as conn:
        conn.execute("create table marcador (x integer)")

    result = client.post(f"{API}/backup/reset", json={"confirm": "APAGAR"}).json()
    assert result["safety_backup"] and "antes-de-apagar" in result["safety_backup"]

    assert (
        client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True}).status_code
        == 200
    )
    assert state(client) == before


# ---- status do ambiente ------------------------------------------------------------------


def test_system_status_for_a_new_environment(client, isolated_database_file):
    body = client.get(f"{API}/system/status").json()
    assert body["storage"] == "local"
    assert body["database_file"] == "investment.db"
    assert body["expected_revision"] == head_revision()
    assert body["backups_count"] == 0
    assert body["last_backup_at"] is None
    assert body["benchmarks_updated_at"] is None
    assert body["database_size_bytes"] is None  # o arquivo ainda não existe


def test_system_status_counts_backups_and_sees_the_file(client, isolated_database_file):
    isolated_database_file.parent.mkdir(parents=True)
    isolated_database_file.write_bytes(b"x" * 10)
    backups = isolated_database_file.parent / "backups"
    backups.mkdir()
    (backups / "investment-20261015-120000-rev0003.db").write_bytes(b"1")
    (backups / "investment-20261016-120000-antes-de-apagar.db").write_bytes(b"1")

    body = client.get(f"{API}/system/status").json()
    assert body["backups_count"] == 2
    assert body["last_backup_at"] is not None
    assert body["database_size_bytes"] == 10


def test_backup_carries_the_net_balance_mark_through_a_restore(client, make_asset):
    make_asset(name="Tesouro")
    make_asset(name="Caixinha", balance_is_net=True)
    backup = export(client)
    assert {a["name"]: a["balance_is_net"] for a in backup["tables"]["asset"]} == {
        "Tesouro": False,
        "Caixinha": True,
    }

    response = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True})

    assert response.status_code == 200, response.text
    assert {a["name"]: a["balance_is_net"] for a in client.get(f"{API}/assets").json()} == {
        "Tesouro": False,
        "Caixinha": True,
    }


def test_backup_without_the_net_balance_column_restores_every_asset_as_gross(client, make_asset):
    make_asset(name="Caixinha", balance_is_net=True)
    backup = copy.deepcopy(export(client))
    for row in backup["tables"]["asset"]:
        del row["balance_is_net"]  # arquivo sem a coluna

    response = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True})

    assert response.status_code == 200, response.text
    assert [a["balance_is_net"] for a in client.get(f"{API}/assets").json()] == [False]


def test_backup_carries_the_initial_contribution_mark_through_a_restore(client, make_asset):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    from app.core.db import get_session

    new = make_asset(name="Novo", invested=80_000, current=90_000, is_new_investment=True)
    make_asset(name="Antigo")
    backup = export(client)
    exported = backup["tables"]["asset_movement"]
    assert [(m["asset_id"], m["kind"], m["amount_cents"], m["initial"]) for m in exported] == [
        (new["id"], "aporte", 80_000, True)
    ]
    before = state(client)

    # Depois do backup o usuário desfaz o aporte inicial; a restauração o traz de volta marcado.
    [original] = client.get(f"{API}/movements").json()
    assert client.post(f"{API}/movements/{original['id']}/undo").status_code == 200
    assert client.get(f"{API}/movements").json() == []
    response = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True})

    assert response.status_code == 200, response.text
    [movement] = client.get(f"{API}/movements").json()
    assert movement["initial"] is True and movement["amount_cents"] == 80_000
    assert state(client) == before  # saldos, investido e diário idênticos
    assert (client.get(f"{API}/assets/{new['id']}").json()["invested_cents"]) == 80_000

    # O índice único parcial continua valendo: um 2º aporte inicial do mesmo ativo é recusado,
    # mas aportes comuns do ativo seguem permitidos.
    session = next(client.app.dependency_overrides[get_session]())
    with session:
        index_sql = session.execute(
            text("select sql from sqlite_master where name = 'uq_movement_initial_per_asset'")
        ).scalar_one()
        assert "initial = 1" in index_sql
        insert = (
            "insert into asset_movement (date, kind, asset_id, amount_cents, cost_cents, initial)"
            " values ('2026-10-01', 'aporte', :a, 1, 0, :i)"
        )
        session.execute(text(insert), {"a": new["id"], "i": 0})  # aporte comum cabe
        with pytest.raises(IntegrityError):
            session.execute(text(insert), {"a": new["id"], "i": 1})


def test_backup_carries_the_redemption_note_and_mark_through_a_restore(client, make_asset):
    item = make_asset(name="CDB", invested=100_000, current=110_000, valuation_date="2026-09-30")
    first = client.post(
        f"{API}/redemptions",
        json={
            "asset_id": item["id"],
            "amount_cents": 11_000,
            "date": "2026-10-10",
            "note": "Viagem",
        },
    ).json()
    client.post(
        f"{API}/assets/{item['id']}/balance", json={"date": "2026-10-31", "balance_cents": 80_000}
    )
    second = client.post(
        f"{API}/redemptions",
        json={
            "asset_id": item["id"],
            "amount_cents": 9_900,
            "date": "2026-10-20",
            "already_in_balance": True,
        },
    ).json()
    backup = export(client)
    exported = {m["id"]: m for m in backup["tables"]["asset_movement"]}
    assert (exported[first["id"]]["note"], exported[first["id"]]["in_balance"]) == ("Viagem", False)
    assert (exported[second["id"]]["note"], exported[second["id"]]["in_balance"]) == (None, True)
    before = state(client)

    for movement in client.get(f"{API}/movements").json():  # depois do backup, tudo é desfeito
        assert client.post(f"{API}/movements/{movement['id']}/undo").status_code == 200
    response = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True})

    assert response.status_code == 200, response.text
    assert state(client) == before
    restored = {m["id"]: m for m in client.get(f"{API}/movements").json()}
    assert (restored[first["id"]]["note"], restored[first["id"]]["in_balance"]) == ("Viagem", False)
    assert restored[second["id"]]["in_balance"] is True
    # E o desfazer ainda sabe o que reverter no resgate "já no saldo".
    assert client.post(f"{API}/movements/{second['id']}/undo").status_code == 200


def test_rows_without_the_redemption_columns_get_no_note_and_not_in_balance_on_restore(
    client, make_asset
):
    # Mesma revisão do app (passa pelo portão), mas as linhas de movimento não trazem as colunas
    # novas: o banco preenche o padrão. Não representa um backup antigo de verdade (veja abaixo).
    make_asset(name="CDB", invested=100_000, current=110_000)
    backup = copy.deepcopy(export(client))
    backup["tables"]["asset_movement"] = [
        {
            "id": 1,
            "date": "2026-10-01",
            "kind": "aporte",
            "asset_id": 1,
            "related_asset_id": None,
            "amount_cents": 500,
            "cost_cents": None,
            "from_purchase": False,
            "initial": False,
        }
    ]

    response = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True})

    assert response.status_code == 200, response.text
    [movement] = client.get(f"{API}/movements").json()
    assert (movement["note"], movement["in_balance"]) == (None, False)


# ---- backup de uma versão anterior do esquema --------------------------------------------


def legacy_backup(tmp_path, revision, fill):
    """Backup JSON como o app daquela revisão o exportaria.

    Sobe um banco temporário até `revision`, deixa `fill(conn)` gravar os dados e lê as tabelas
    no formato do backup (as datas já são texto ISO no SQLite).
    """
    path = tmp_path / "legado" / f"rev{revision}.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    command.upgrade(alembic_config(f"sqlite:///{path.as_posix()}"), revision)
    tables = {}
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        fill(conn)
        conn.commit()
        names = [
            r[0]
            for r in conn.execute("select name from sqlite_master where type = 'table'")
            if r[0] != "alembic_version" and not r[0].startswith("sqlite_")
        ]
        for name in sorted(names):
            tables[name] = [dict(row) for row in conn.execute(f"select * from {name}")]
    finally:
        conn.close()
    return {
        "app": "investment-lab",
        "format_version": 1,
        "schema_revision": revision,
        "exported_at": datetime(2026, 10, 30, 12, 0).isoformat(timespec="seconds"),
        "tables": tables,
    }


def fill_rev_0014(conn):
    """Dois ativos, valores, um aporte com caixa e um fechamento."""
    run = conn.execute
    run("insert into institution (id, name) values (1, 'Banco Velho')")
    run("insert into asset_class (id, key, name, color) values (1, 'renda_fixa', 'RF', '#111111')")
    run("insert into account (id, name, institution_id) values (1, 'Conta Velha', 1)")
    for asset_id, name in ((1, "CDB Antigo"), (2, "Tesouro Antigo")):
        run(
            "insert into asset (id, name, class_id, institution_id, archived, account_id) "
            "values (?, ?, 1, 1, 0, 1)",
            (asset_id, name),
        )
    values = [(1, "2026-09-30", 100_000, 110_000), (1, "2026-10-15", 120_000, 131_000)]
    values += [(2, "2026-10-15", 50_000, 50_500)]
    for asset_id, day, invested, current in values:
        run(
            "insert into asset_valuation (asset_id, date, invested_cents, current_cents) "
            "values (?, ?, ?, ?)",
            (asset_id, day, invested, current),
        )
    run(
        "insert into asset_movement (id, date, kind, asset_id, amount_cents, from_purchase) "
        "values (1, '2026-10-01', 'aporte', 1, 20000, 1)"
    )
    cash = [
        (1, "2026-09-01", "saldo_inicial", 500_000, None, None),
        (1, "2026-10-01", "compra", -20_000, 1, 1),
    ]
    for account_id, day, kind, amount, asset_id, movement_id in cash:
        run(
            "insert into cash_entry (account_id, date, kind, amount_cents, asset_id, movement_id) "
            "values (?, ?, ?, ?, ?, ?)",
            (account_id, day, kind, amount, asset_id, movement_id),
        )
    run(
        "insert into snapshot (id, date, total_cents, invested_cents) "
        "values (1, '2026-09-30', 110000, 100000)"
    )
    run(
        "insert into snapshot_item "
        "(snapshot_id, asset_id, class_id, invested_cents, current_cents) "
        "values (1, 1, 1, 100000, 110000)"
    )


def prepare_safety_copy(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.execute("create table marcador (x integer)")
        conn.execute("insert into marcador values (7)")


def test_the_revision_chain_runs_from_the_first_revision_to_the_head():
    chain = revision_chain()
    assert chain[0] == "0001" and chain[-1] == head_revision()
    assert chain == sorted(chain) and len(set(chain)) == len(chain)


def test_inspect_accepts_an_older_revision_and_says_it_will_be_converted(client, tmp_path):
    old = legacy_backup(tmp_path, "0014", fill_rev_0014)

    body = client.post(f"{API}/backup/inspect", json=old).json()

    assert body["valid"] is True and body["compatible"] is True
    assert body["needs_conversion"] is True
    assert (body["schema_revision"], body["current_revision"]) == ("0014", head_revision())
    [notice] = body["problems"]
    assert "este backup é da versão 0014 e será convertido para a atual" in notice.lower()
    assert body["counts"]["asset"] == 2 and body["counts"]["snapshot"] == 1
    assert (body["snapshots_from"], body["snapshots_to"]) == ("2026-09-30", "2026-09-30")


def test_inspect_of_a_current_backup_needs_no_conversion(client):
    body = client.post(f"{API}/backup/inspect", json=export(client)).json()
    assert body["needs_conversion"] is False and body["problems"] == []


def test_inspect_still_flags_other_problems_in_an_older_backup(client, tmp_path):
    old = legacy_backup(tmp_path, "0014", fill_rev_0014)
    old["tables"]["tabela_estranha"] = []
    old["tables"]["asset"] = "nada"

    body = client.post(f"{API}/backup/inspect", json=old).json()

    assert body["valid"] is False and body["compatible"] is False
    assert body["needs_conversion"] is False
    joined = " ".join(body["problems"])
    assert "Tabelas desconhecidas" in joined and "malformado" in joined


def test_restore_converts_a_backup_from_revision_0014(
    client, tmp_path, isolated_database_file, monkeypatch
):
    old = legacy_backup(tmp_path, "0014", fill_rev_0014)
    assert "note" not in old["tables"]["asset_movement"][0]  # é mesmo um arquivo antigo
    prepare_safety_copy(isolated_database_file)
    temp_root = tmp_path / "temporarios"
    temp_root.mkdir()
    monkeypatch.setattr("tempfile.tempdir", str(temp_root))
    urls = []
    real_config = alembic_config

    def spy(url):
        urls.append(url)
        return real_config(url)

    monkeypatch.setattr("app.features.backup.convert.alembic_config", spy)

    response = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True})

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["converted_from_revision"] == "0014"
    assert result["counts"]["asset"] == 2 and result["counts"]["asset_valuation"] == 3
    # A cópia de segurança do arquivo real foi feita antes de substituir os dados.
    assert result["safety_backup"] and "antes-da-restauracao" in result["safety_backup"]
    with sqlite3.connect(result["safety_backup"]) as copy_db:
        assert copy_db.execute("select x from marcador").fetchone() == (7,)

    assets = {a["name"]: a for a in client.get(f"{API}/assets").json()}
    assert set(assets) == {"CDB Antigo", "Tesouro Antigo"}
    assert assets["CDB Antigo"]["current_cents"] == 131_000
    assert assets["CDB Antigo"]["invested_cents"] == 120_000
    assert client.get(f"{API}/portfolio/summary").json()["total_current_cents"] == 181_500
    assert [s["total_cents"] for s in client.get(f"{API}/snapshots").json()] == [110_000]
    # As colunas novas nascem com o padrão: sem observação e sem a marca "já no saldo".
    [movement] = client.get(f"{API}/movements").json()
    assert (movement["amount_cents"], movement["note"], movement["in_balance"]) == (
        20_000,
        None,
        False,
    )
    assert movement["initial"] is False
    statement = client.get(f"{API}/accounts/1/entries").json()
    assert statement["balance_cents"] == 480_000
    assert sorted(e["amount_cents"] for e in statement["entries"]) == [-20_000, 500_000]
    # O resultado é um backup comum da versão atual.
    again = export(client)
    assert again["schema_revision"] == head_revision()
    assert all(
        m["note"] is None and m["in_balance"] == 0 for m in again["tables"]["asset_movement"]
    )

    # O esquema foi montado só em arquivos temporários, nunca no banco do app, e apagados no fim.
    assert urls and all("investment-lab-conversao-" in url for url in urls)
    assert not any(url == f"sqlite:///{isolated_database_file.as_posix()}" for url in urls)
    assert list(temp_root.iterdir()) == []


def test_restore_of_an_older_backup_replaces_what_was_there(client, make_asset, tmp_path):
    make_asset(name="Será substituído")
    old = legacy_backup(tmp_path, "0014", fill_rev_0014)

    response = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True})

    assert response.status_code == 200, response.text
    assert {a["name"] for a in client.get(f"{API}/assets").json()} == {
        "CDB Antigo",
        "Tesouro Antigo",
    }


def test_restore_converts_a_backup_from_revision_0011_moving_the_hold_mark_to_the_asset(
    client, tmp_path
):
    # Na 0011 a marca "manter posição" era da categoria do plano ativo; a 0012 a passa aos ativos.
    def fill(conn):
        conn.execute("insert into institution (id, name) values (1, 'Banco')")
        for class_id, key in ((1, "renda_fixa"), (2, "cripto")):
            conn.execute(
                "insert into asset_class (id, key, name, color) values (?, ?, ?, '#222222')",
                (class_id, key, key),
            )
        for asset_id, class_id in ((1, 1), (2, 2)):
            conn.execute(
                "insert into asset (id, name, class_id, institution_id, archived) "
                "values (?, ?, ?, 1, 0)",
                (asset_id, f"Ativo {asset_id}", class_id),
            )
            conn.execute(
                "insert into asset_valuation (asset_id, date, invested_cents, current_cents) "
                "values (?, '2026-10-15', 1000, 1000)",
                (asset_id,),
            )
        conn.execute("insert into allocation_plan (id, name, is_active) values (1, 'Plano', 1)")
        conn.execute("insert into allocation_target values (1, 1, 6000, 0)")
        conn.execute("insert into allocation_target values (1, 2, 0, 1)")

    old = legacy_backup(tmp_path, "0011", fill)
    assert "hold_only" not in old["tables"]["asset"][0]
    assert old["tables"]["allocation_target"][1]["hold_only"] == 1

    response = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True})

    assert response.status_code == 200, response.text
    assert response.json()["converted_from_revision"] == "0011"
    assert {a["name"]: a["hold_only"] for a in client.get(f"{API}/assets").json()} == {
        "Ativo 1": False,
        "Ativo 2": True,
    }
    targets = export(client)["tables"]["allocation_target"]
    assert sorted(t["percent_bps"] for t in targets) == [0, 6000]  # as metas não mudam
    assert all("hold_only" not in t for t in targets)


def test_columns_that_the_old_revision_does_not_know_are_ignored(client, tmp_path):
    old = legacy_backup(tmp_path, "0014", fill_rev_0014)
    for row in old["tables"]["asset"]:
        row["coluna_do_futuro"] = "x"  # nem o app atual a conhece

    response = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True})

    assert response.status_code == 200, response.text
    assert len(client.get(f"{API}/assets").json()) == 2


@pytest.mark.parametrize("revision", ["9999", "0099", "", None, 15])
def test_backup_from_an_unknown_or_later_revision_is_refused_and_changes_nothing(
    client, make_asset, isolated_database_file, revision
):
    populate(client, make_asset)
    prepare_safety_copy(isolated_database_file)
    before = state(client)
    odd = copy.deepcopy(export(client))
    odd["schema_revision"] = revision

    inspection = client.post(f"{API}/backup/inspect", json=odd).json()
    assert inspection["valid"] is False and inspection["compatible"] is False
    assert inspection["needs_conversion"] is False
    assert "mesma versão do app" in " ".join(inspection["problems"])

    response = client.post(f"{API}/backup/restore", json={"backup": odd, "confirm": True})
    assert response.status_code == 422
    assert "mesma versão do app" in response.json()["detail"]
    assert state(client) == before
    assert not (isolated_database_file.parent / "backups").exists()  # nem cópia de segurança


@pytest.mark.parametrize(
    "corrupt, fragment",
    [
        (lambda t: t["asset_valuation"][0].update(date="não é data"), "nenhum dado foi alterado"),
        (lambda t: t["asset"].__setitem__(0, "linha torta"), "malformada"),
        (lambda t: t["snapshot"].append(dict(t["snapshot"][0])), "nenhum dado foi alterado"),
        (lambda t: t.update(tabela_nova_demais=[{"id": 1}]), "Tabelas desconhecidas"),
    ],
)
def test_a_corrupted_older_backup_changes_nothing(
    client, make_asset, tmp_path, isolated_database_file, corrupt, fragment
):
    populate(client, make_asset)
    prepare_safety_copy(isolated_database_file)
    before = state(client)
    old = legacy_backup(tmp_path, "0014", fill_rev_0014)
    corrupt(old["tables"])

    response = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True})

    assert response.status_code == 422
    assert fragment in response.json()["detail"]
    assert state(client) == before
    assert not (isolated_database_file.parent / "backups").exists()


def test_older_backup_with_data_that_breaks_a_foreign_key_rolls_back(client, make_asset, tmp_path):
    # A conversão passa (o banco temporário não confere chaves), mas a restauração real confere e
    # desfaz tudo, inclusive o apagamento dos dados atuais.
    populate(client, make_asset)
    before = state(client)
    old = legacy_backup(tmp_path, "0014", fill_rev_0014)
    old["tables"]["asset"][0]["institution_id"] = 9_999

    response = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True})

    assert response.status_code == 422
    assert "nenhum dado foi alterado" in response.json()["detail"]
    assert state(client) == before


def test_a_failing_migration_during_the_conversion_changes_nothing(
    client, make_asset, tmp_path, monkeypatch
):
    populate(client, make_asset)
    before = state(client)
    old = legacy_backup(tmp_path, "0014", fill_rev_0014)
    calls = []
    real_upgrade = command.upgrade

    def failing(config, target):
        calls.append(target)
        if target == "head":
            raise RuntimeError("migração quebrada")
        return real_upgrade(config, target)

    monkeypatch.setattr("app.features.backup.convert.command.upgrade", failing)

    response = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True})

    assert calls == ["0014", "head"]
    assert response.status_code == 422
    assert "converter o backup da versão 0014" in response.json()["detail"]
    assert "migração quebrada" in response.json()["detail"]
    assert state(client) == before


# ---- conferência dos valores e das mensagens ---------------------------------------------

BAD_VALUES = [
    ("snapshot", "total_cents", 100.5, "número inteiro"),  # o SQLite guardaria um real
    ("snapshot", "invested_cents", "abc", "número inteiro"),  # ... ou um texto
    ("snapshot", "total_cents", True, "número inteiro"),  # bool é int em Python
    ("snapshot", "reserve_cents", [1], "número inteiro"),
    ("asset", "archived", 5, "verdadeiro ou falso"),
    ("asset", "name", 123, "texto"),
    ("snapshot", "date", 20260930, "data em texto"),
    ("snapshot", "date", "30/09/2026", "data válida"),
]


@pytest.mark.parametrize("table, column, value, expected", BAD_VALUES)
def test_restore_rejects_a_value_of_the_wrong_type_naming_the_column_but_not_the_value(
    client, make_asset, table, column, value, expected
):
    populate(client, make_asset)
    before = state(client)
    broken = copy.deepcopy(export(client))
    broken["tables"][table][0][column] = value

    response = client.post(f"{API}/backup/restore", json={"backup": broken, "confirm": True})

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert f"tabela {table}, coluna {column}" in detail and expected in detail
    assert str(value) not in detail  # o valor financeiro não vai para a mensagem
    assert "nenhum dado foi alterado" in detail
    assert state(client) == before


def test_restore_accepts_true_false_and_zero_one_for_booleans_and_null_for_anything(
    client, make_asset
):
    make_asset(name="CDB")
    backup = copy.deepcopy(export(client))
    row = backup["tables"]["asset"][0]
    row["archived"] = 0  # arquivo gerado direto do SQLite
    row["hold_only"] = False
    row["ticker"] = None

    response = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True})

    assert response.status_code == 200, response.text


def test_the_type_check_also_applies_to_the_rows_of_an_older_backup(client, make_asset, tmp_path):
    populate(client, make_asset)
    before = state(client)
    old = legacy_backup(tmp_path, "0014", fill_rev_0014)
    old["tables"]["asset_valuation"][0]["current_cents"] = 110_000.5

    response = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True})

    assert response.status_code == 422
    assert "tabela asset_valuation, coluna current_cents" in response.json()["detail"]
    assert "110000.5" not in response.json()["detail"]
    assert state(client) == before


def test_integrity_check_refuses_rows_that_point_to_nothing():
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session

    from app.core.errors import InvalidInputError
    from app.features.backup.service import _check_integrity
    from app.registry import Base

    engine = create_engine("sqlite://")  # sem PRAGMA foreign_keys: deixa o dado torto entrar
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        _check_integrity(session)  # banco vazio e são
        session.execute(
            text(
                "insert into asset (name, class_id, institution_id, archived, hold_only, "
                "balance_is_net) values ('X', 1, 1, 0, 0, 0)"
            )
        )
        with pytest.raises(InvalidInputError, match="apontam para outros"):
            _check_integrity(session)


def test_restore_rolls_back_when_two_plans_are_active(client, make_asset):
    populate(client, make_asset)
    before = state(client)
    broken = copy.deepcopy(export(client))
    plans = broken["tables"]["allocation_plan"]
    plans.append({**plans[0], "id": plans[0]["id"] + 100, "name": "Outro", "is_active": True})
    assert plans[0]["is_active"] is True

    response = client.post(f"{API}/backup/restore", json={"backup": broken, "confirm": True})

    assert response.status_code == 422
    assert "nenhum dado foi alterado" in response.json()["detail"]
    assert state(client) == before


def test_restore_rolls_back_on_a_cash_entry_with_the_wrong_sign(client, make_asset):
    make_asset(name="CDB")
    account = client.get(f"{API}/accounts").json()[0]["id"]
    opening = {"date": "2026-09-01", "amount_cents": 5_000}
    client.post(f"{API}/accounts/{account}/opening-balance", json=opening)
    deposit = {"date": "2026-10-01", "amount_cents": 2_000}
    assert client.post(f"{API}/accounts/{account}/deposits", json=deposit).status_code < 300
    before = state(client)
    broken = copy.deepcopy(export(client))
    [entry] = [e for e in broken["tables"]["cash_entry"] if e["kind"] == "deposito"]
    entry["amount_cents"] = -2_000  # depósito precisa ser positivo

    response = client.post(f"{API}/backup/restore", json={"backup": broken, "confirm": True})

    assert response.status_code == 422
    assert "nenhum dado foi alterado" in response.json()["detail"]
    assert state(client) == before


def test_restore_errors_show_the_database_message_without_sql_or_values(client, make_asset):
    populate(client, make_asset)
    broken = copy.deepcopy(export(client))
    broken["tables"]["asset"][0]["institution_id"] = 9_999

    detail = client.post(f"{API}/backup/restore", json={"backup": broken, "confirm": True}).json()[
        "detail"
    ]

    assert "FOREIGN KEY constraint failed" in detail
    for leak in ("INSERT", "SQL", "parameters", "9999", "["):
        assert leak not in detail, leak


def test_a_failing_migration_message_is_summarized_to_one_line(client, tmp_path, monkeypatch):
    old = legacy_backup(tmp_path, "0014", fill_rev_0014)

    def failing(config, target):
        raise ValueError("INSERT INTO asset VALUES (123456, 'segredo')")

    monkeypatch.setattr("app.features.backup.convert.command.upgrade", failing)

    detail = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True}).json()[
        "detail"
    ]

    assert "INSERT" not in detail and "123456" not in detail and "segredo" not in detail
    assert "nenhum dado foi alterado" in detail


@pytest.mark.parametrize("version", [True, 1.0, "1"])
def test_format_version_must_be_exactly_the_integer_one(client, version):
    payload = copy.deepcopy(export(client))
    payload["format_version"] = version

    body = client.post(f"{API}/backup/inspect", json=payload).json()

    assert body["valid"] is False
    assert any("Formato de backup não suportado" in p for p in body["problems"])


@pytest.mark.parametrize("exported_at", [20261031, True, ["2026-10-31"], {"a": 1}])
def test_a_non_text_export_date_is_invalid(client, exported_at):
    payload = copy.deepcopy(export(client))
    payload["exported_at"] = exported_at

    body = client.post(f"{API}/backup/inspect", json=payload).json()

    assert body["valid"] is False and body["compatible"] is False
    assert any("data de exportação" in p for p in body["problems"])


# ---- conversão: pasta temporária, aviso de marcas e cópias de segurança -------------------


def test_the_temporary_folder_is_removed_when_the_conversion_fails_too(
    client, tmp_path, monkeypatch
):
    old = legacy_backup(tmp_path, "0014", fill_rev_0014)
    temp_root = tmp_path / "temporarios"
    temp_root.mkdir()
    monkeypatch.setattr("tempfile.tempdir", str(temp_root))
    real_upgrade = command.upgrade

    def failing(config, target):
        real_upgrade(config, target)  # o banco temporário existe, com a revisão do arquivo
        if target == "head":
            raise RuntimeError("migração quebrada")

    monkeypatch.setattr("app.features.backup.convert.command.upgrade", failing)

    response = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True})

    assert response.status_code == 422
    assert list(temp_root.iterdir()) == []


def test_the_temporary_folder_is_removed_when_the_data_is_refused_too(
    client, tmp_path, monkeypatch
):
    old = legacy_backup(tmp_path, "0014", fill_rev_0014)
    old["tables"]["asset"][0]["name"] = 42
    temp_root = tmp_path / "temporarios"
    temp_root.mkdir()
    monkeypatch.setattr("tempfile.tempdir", str(temp_root))

    response = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True})

    assert response.status_code == 422
    assert list(temp_root.iterdir()) == []


def test_the_folder_removal_is_retried_and_a_final_failure_is_logged_with_the_path(
    client, tmp_path, monkeypatch, caplog
):
    import shutil

    old = legacy_backup(tmp_path, "0014", fill_rev_0014)
    monkeypatch.setattr("time.sleep", lambda seconds: None)
    real_rmtree = shutil.rmtree
    attempts = []

    def stuck(path, *args, **kwargs):
        attempts.append(path)
        raise PermissionError("arquivo em uso")

    monkeypatch.setattr("shutil.rmtree", stuck)

    with caplog.at_level(logging.WARNING, logger="app.features.backup.convert"):
        response = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True})

    assert response.status_code == 200, response.text  # falha ao limpar não perde a restauração
    assert len(attempts) == 5 and len(set(attempts)) == 1
    assert any(attempts[0] in record.getMessage() for record in caplog.records)
    real_rmtree(attempts[0])  # limpeza do próprio teste

    # Presa só por um instante: a segunda tentativa apaga e nada é registrado.
    caplog.clear()
    flaky = {"calls": 0}

    def once(path, *args, **kwargs):
        flaky["calls"] += 1
        if flaky["calls"] == 1:
            raise PermissionError("arquivo em uso")
        real_rmtree(path, *args, **kwargs)

    monkeypatch.setattr("shutil.rmtree", once)
    with caplog.at_level(logging.WARNING, logger="app.features.backup.convert"):
        response = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True})
    assert response.status_code == 200 and flaky["calls"] == 2
    assert not caplog.records


def test_converting_never_creates_the_database_named_by_the_environment(
    client, tmp_path, monkeypatch
):
    from app.core.config import get_settings

    sentinel = tmp_path / "sentinela" / "investment.db"
    monkeypatch.setenv("INVESTMENT_DATABASE_URL", f"sqlite:///{sentinel.as_posix()}")
    get_settings.cache_clear()
    try:
        old = legacy_backup(tmp_path, "0014", fill_rev_0014)
        response = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True})
    finally:
        get_settings.cache_clear()

    assert response.status_code == 200, response.text
    assert not sentinel.exists() and not sentinel.parent.exists()


def test_inspect_warns_that_hold_marks_of_inactive_plans_may_be_lost_up_to_revision_0011(
    client, tmp_path
):
    def fill(conn):
        conn.execute("insert into institution (id, name) values (1, 'Banco')")

    for revision, warned in (("0011", True), ("0010", True), ("0012", False), ("0014", False)):
        old = legacy_backup(tmp_path, revision, fill)
        [notice] = client.post(f"{API}/backup/inspect", json=old).json()["problems"]
        assert ("manter posição" in notice) is warned, revision
        if warned:
            assert "planos inativos" in notice and "podem se perder" in notice


def test_two_restores_in_the_same_second_keep_both_safety_copies(
    client, make_asset, isolated_database_file, monkeypatch
):
    class Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 31, 12, 0, 0)

    monkeypatch.setattr("app.core.migrate.datetime", Frozen)
    populate(client, make_asset)
    backup = export(client)
    prepare_safety_copy(isolated_database_file)

    first = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True}).json()
    with sqlite3.connect(isolated_database_file) as conn:
        conn.execute("update marcador set x = 8")
    second = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True}).json()

    assert first["safety_backup"] != second["safety_backup"]
    with (
        sqlite3.connect(first["safety_backup"]) as one,
        sqlite3.connect(second["safety_backup"]) as two,
    ):
        assert one.execute("select x from marcador").fetchone() == (7,)  # a primeira foi preservada
        assert two.execute("select x from marcador").fetchone() == (8,)
    assert len(list((isolated_database_file.parent / "backups").iterdir())) == 2


def test_restore_and_reset_fail_cleanly_when_the_safety_copy_cannot_be_made(
    client, make_asset, monkeypatch
):
    populate(client, make_asset)
    backup = export(client)
    before = state(client)

    def broken(url, label):
        raise OSError("disco cheio")

    monkeypatch.setattr("app.features.backup.service.backup_database_file", broken)

    restore = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True})
    reset = client.post(f"{API}/backup/reset", json={"confirm": "APAGAR"})

    for response in (restore, reset):
        assert response.status_code == 422
        assert "cópia de segurança" in response.json()["detail"]
        assert "nenhum dado foi alterado" in response.json()["detail"]
    assert state(client) == before


# ---- grupos de categorias ----------------------------------------------------------------


def test_backup_carries_the_groups_and_the_category_membership_through_a_restore(
    client, make_asset
):
    make_asset(name="FII", class_key="renda_variavel", invested=1_000, current=1_100)
    classes = {c["key"]: c for c in client.get(f"{API}/asset-classes").json()}
    group = client.post(f"{API}/asset-groups", json={"name": "Bolsa", "color": "#112233"}).json()
    for key in ("renda_variavel", "acoes_etfs"):
        body = {k: classes[key][k] for k in ("name", "color", "archived")}
        client.put(
            f"{API}/asset-classes/{classes[key]['id']}", json=body | {"group_id": group["id"]}
        )
    # Lê as telas antes de exportar: ler a reserva cria a linha dela, que entra no arquivo.
    before = state(client) | {"groups": client.get(f"{API}/asset-groups").json()}
    backup = export(client)
    assert backup["tables"]["asset_group"] == [
        {"id": group["id"], "name": "Bolsa", "color": "#112233", "archived": False}
    ]
    assert {c["key"]: c["group_id"] for c in backup["tables"]["asset_class"]} == {
        "renda_fixa": None,
        "renda_variavel": group["id"],
        "acoes_etfs": group["id"],
        "cripto": None,
    }

    # Depois do backup o usuário arquiva o grupo (solta as categorias) e cria outro.
    client.put(f"{API}/asset-groups/{group['id']}", json={"archived": True})
    client.post(f"{API}/asset-groups", json={"name": "Outro"})

    response = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True})

    assert response.status_code == 200, response.text
    assert response.json()["counts"]["asset_group"] == 1
    assert state(client) | {"groups": client.get(f"{API}/asset-groups").json()} == before
    again = export(client)
    again["exported_at"] = backup["exported_at"]
    assert again == backup


def test_restore_converts_a_backup_from_revision_0015_without_groups(client, make_asset, tmp_path):
    make_asset(name="Será substituído")
    client.post(f"{API}/asset-groups", json={"name": "Some na restauração"})
    old = legacy_backup(tmp_path, "0015", fill_rev_0014)
    assert "asset_group" not in old["tables"] or old["tables"]["asset_group"] == []
    assert "group_id" not in old["tables"]["asset_class"][0]  # é mesmo um arquivo antigo

    inspected = client.post(f"{API}/backup/inspect", json=old).json()
    assert inspected["valid"] is True and inspected["needs_conversion"] is True

    response = client.post(f"{API}/backup/restore", json={"backup": old, "confirm": True})

    assert response.status_code == 200, response.text
    assert response.json()["converted_from_revision"] == "0015"
    assert client.get(f"{API}/asset-groups", params={"include_archived": 1}).json() == []
    classes = client.get(f"{API}/asset-classes").json()
    assert [(c["key"], c["group_id"]) for c in classes] == [("renda_fixa", None)]
    assert {a["name"] for a in client.get(f"{API}/assets").json()} == {
        "CDB Antigo",
        "Tesouro Antigo",
    }
    assert client.get(f"{API}/portfolio/summary").json()["by_group"] == []
    again = export(client)
    assert again["schema_revision"] == head_revision()
    assert again["tables"]["asset_group"] == []


def test_restore_rejects_a_category_pointing_to_a_group_the_backup_does_not_have(
    client, make_asset
):
    make_asset(name="CDB")
    before = state(client)
    backup = copy.deepcopy(export(client))
    backup["tables"]["asset_class"][0]["group_id"] = 99  # grupo que não existe

    response = client.post(f"{API}/backup/restore", json={"backup": backup, "confirm": True})

    assert response.status_code == 422
    assert state(client) == before
