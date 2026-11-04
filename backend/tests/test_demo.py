import dataclasses
import datetime as dt
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_session, make_engine
from app.demo import ensure_not_real_database, seed_demo
from app.features.analytics.service import get_asset_performance
from app.features.benchmarks.models import BenchmarkDaily
from app.features.history.models import Snapshot
from app.main import create_app

API = "/api/v1"
TODAY = dt.date(2026, 10, 17)


def session_of(client):
    return next(client.app.dependency_overrides[get_session]())


def test_demo_seed_builds_a_complete_fictional_portfolio(client):
    session = session_of(client)
    assert seed_demo(session, TODAY) is True

    assets = client.get(f"{API}/assets").json()
    assert len(assets) == 9
    assert {a["institution_name"] for a in assets} == {
        "Banco Exemplo",
        "Corretora Exemplo",
        "Fintech Exemplo",
    }
    assert sum(1 for a in assets if a["purpose"] == "reserva") == 1
    assert len(session.scalars(select(Snapshot)).all()) == 6
    assert (
        session.scalars(select(BenchmarkDaily)).first() is not None
    )  # CDI sintético: funciona sem internet

    contributions = client.get(f"{API}/contributions").json()
    assert len(contributions) == 7  # seis meses fechados + o mês atual
    this_month = next(c for c in contributions if c["month"] == "2026-10")
    assert this_month["plan"] and this_month["reserve_cents"] == 9_750

    summary = client.get(f"{API}/portfolio/summary").json()
    assert summary["total_current_cents"] > 0
    assert client.get(f"{API}/reserve").json()["monthly_mode"] == "percent"


def test_demo_has_a_group_with_two_categories(client):
    seed_demo(session_of(client), TODAY)

    [group] = client.get(f"{API}/asset-groups").json()
    classes = {c["key"]: c for c in client.get(f"{API}/asset-classes").json()}
    assert group["name"] == "Bolsa e FIIs"
    assert group["class_ids"] == [classes["renda_variavel"]["id"], classes["acoes_etfs"]["id"]]
    assert classes["renda_fixa"]["group_id"] is None and classes["cripto"]["group_id"] is None
    comparison = client.get(f"{API}/allocation/comparison").json()
    [row] = comparison["groups"]
    assert row["class_keys"] == ["renda_variavel", "acoes_etfs"]
    assert row["current_cents"] == sum(
        i["current_cents"] for i in comparison["items"] if i["group_id"] == group["id"]
    )
    summary = client.get(f"{API}/portfolio/summary").json()
    assert [g["group_id"] for g in summary["by_group"]] == [group["id"]]


def test_demo_has_a_category_with_one_held_asset_and_one_that_receives(client):
    seed_demo(session_of(client), TODAY)

    marks = {a["name"]: a["hold_only"] for a in client.get(f"{API}/assets").json()}
    assert marks["FII Papel Exemplo"] is True
    assert sum(marks.values()) == 1
    rows = {i["class_key"]: i for i in client.get(f"{API}/allocation/comparison").json()["items"]}
    assert rows["renda_variavel"]["hold_status"] == "partial"
    assert [a["name"] for a in rows["renda_variavel"]["held_assets"]] == ["FII Papel Exemplo"]
    split = client.post(f"{API}/allocation/split", json={"amount_cents": 50_000}).json()
    rv = next(i for i in split["items"] if i["class_key"] == "renda_variavel")
    assert [a["name"] for a in rv["receiving_assets"]] == ["FII Tijolo Exemplo"]


def test_demo_shows_a_streak_and_goals(client, monkeypatch):
    monkeypatch.setattr("app.features.goals.service._today", lambda: TODAY)
    seed_demo(session_of(client), TODAY)

    progress = client.get(f"{API}/goals/progress").json()

    # Seis meses fechados e aportados conforme o plano; outubro ainda está em andamento.
    assert (progress["streak"]["current"], progress["streak"]["current_month_met"]) == (6, False)
    assert progress["net_worth"]["goal_cents"] > 0
    assert progress["year"]["status"] == "ok" and progress["year"]["goal_cents"] > 0


def test_demo_shows_earnings_with_gains_a_losing_month_pace_and_a_milestone(client, monkeypatch):
    monkeypatch.setattr("app.features.earnings.service._today", lambda: TODAY)
    seed_demo(session_of(client), TODAY)

    body = client.get(f"{API}/earnings").json()

    complete = [m for m in body["months"] if not m["partial"] and m["has_update"]]
    assert len(complete) == 6
    assert sum(1 for m in complete if m["earned_cents"] > 0) >= 4
    assert sum(1 for m in complete if m["earned_cents"] < 0) == 1
    assert body["total"]["uncredited_proventos_cents"] > 0
    assert body["pace"] is not None and body["pace"]["per_day_cents"] > 0
    assert body["salary"] is not None and body["vs_salary"] is not None
    assert any(m["achieved_month"] for m in body["milestones"])
    assert body["next_milestone"] is not None


def test_demo_cdi_assets_show_the_configured_percent_of_cdi(client):
    session = session_of(client)
    seed_demo(session, TODAY)
    by_name = {a["name"]: a for a in client.get(f"{API}/assets").json()}

    conta = get_asset_performance(session, by_name["Conta Exemplo 120% do CDI"]["id"])
    assert conta.pct_of_cdi_bps is not None
    assert abs(conta.pct_of_cdi_bps - 11_800) <= 30  # o exemplo foi montado a 118% do CDI
    assert conta.contracted_pct_bps == 12_000
    assert conta.vs_contracted_bps is not None and conta.vs_contracted_bps < 0
    assert len(conta.steps) == 7  # seis meses fechados e o saldo de hoje
    assert all(step.pct_of_cdi_bps is not None for step in conta.steps)

    cdb = get_asset_performance(session, by_name["CDB Exemplo 110% do CDI"]["id"])
    assert cdb.pct_of_cdi_bps is not None and abs(cdb.pct_of_cdi_bps - 11_000) <= 30


def test_demo_has_one_fixed_income_asset_with_a_net_balance(client):
    seed_demo(session_of(client), TODAY)

    net = {a["name"] for a in client.get(f"{API}/assets").json() if a["balance_is_net"]}
    # Mostra, na tabela de renda fixa, o aviso de que líquido e bruto não se comparam.
    assert net == {"Conta Exemplo 120% do CDI"}


def test_demo_has_a_fictional_ibovespa_for_the_comparison(client):
    session = session_of(client)
    seed_demo(session, TODAY)

    body = client.get(f"{API}/analytics/performance").json()

    assert body["ibovespa_covered_through"] == "2026-10-16"  # último dia útil até a data de hoje
    assert len(body["points"]) == 9  # saldo inicial, seis fins de mês, cadastros e hoje
    assert all(p["ibovespa_bps"] is not None for p in body["points"])
    assert body["summary"]["vs_ibovespa_bps"] is not None
    assert not any("Ibovespa" in w for w in body["warnings"])


def test_demo_without_any_snapshot_still_shows_performance_evolution_and_year_goal(
    client, monkeypatch
):
    monkeypatch.setattr("app.features.goals.service._today", lambda: TODAY)
    session = session_of(client)
    seed_demo(session, TODAY)
    session.query(Snapshot).delete()  # os fechamentos são opcionais: nada disso depende deles
    session.commit()
    assert client.get(f"{API}/snapshots").json() == []

    performance = client.get(f"{API}/analytics/performance").json()
    evolution = client.get(f"{API}/history/evolution").json()
    year = client.get(f"{API}/goals/progress").json()["year"]

    assert performance["observations_count"] >= 2
    assert all(
        p["portfolio_bps"] is not None and p["cdi_bps"] is not None for p in performance["points"]
    )
    assert performance["summary"]["vs_cdi_bps"] is not None
    assert performance["cdi_covered_through"] == "2026-10-16"  # TODAY é sábado
    assert performance["stale_assets"] == []  # a demonstração tem os saldos de hoje
    assert len(evolution["points"]) >= 2 and evolution["summary"]["change_cents"] > 0
    assert year["status"] == "ok" and year["accumulated_cents"] > 0


def test_demo_seed_does_not_touch_a_portfolio_that_already_has_assets(client, make_asset):
    make_asset(name="Meu ativo")
    assert seed_demo(session_of(client), TODAY) is False
    assert [a["name"] for a in client.get(f"{API}/assets").json()] == ["Meu ativo"]


def test_demo_seed_is_idempotent(client):
    session = session_of(client)
    assert seed_demo(session, TODAY) is True
    assert seed_demo(session, TODAY) is False
    assert len(client.get(f"{API}/assets").json()) == 9


def test_system_status_reports_demo_mode_off_by_default(client):
    assert client.get(f"{API}/system/status").json()["demo"] is False


def test_demo_has_two_new_assets_this_month_that_count_in_the_month_sums(client):
    seed_demo(session_of(client), TODAY)

    assets = {a["name"]: a for a in client.get(f"{API}/assets").json()}
    new = {name for name, a in assets.items() if a["is_new_investment"]}
    summary = client.get(f"{API}/portfolio/month-summary", params={"month": "2026-10"}).json()

    assert new == {"CDB Novo Exemplo", "Ação Nova Exemplo"}
    assert summary["new_assets_cents"] == 35_000
    assert {item["asset_name"] for item in summary["new_assets"]} == new
    assert summary["registered_cents"] == 12_000  # o aporte lançado na cripto
    assert summary["total_cents"] == 47_000


# ---- trava: a demonstração nunca abre o banco real ---------------------------------------


@pytest.fixture
def fake_real_database(tmp_path, monkeypatch):
    """Um arquivo temporário faz o papel do banco real; o de verdade nunca entra no teste."""
    path = tmp_path / "real" / "investment.db"
    monkeypatch.setattr("app.demo.REAL_DATABASE_PATH", path)
    return path


def test_demo_refuses_the_real_database_path(fake_real_database):
    with pytest.raises(RuntimeError, match="banco real"):
        ensure_not_real_database(str(fake_real_database))
    # Outro caminho que resolve para o mesmo arquivo também é recusado.
    with pytest.raises(RuntimeError):
        ensure_not_real_database(str(fake_real_database.parent / ".." / "real" / "investment.db"))


def test_demo_refuses_disguised_paths_to_the_real_database(fake_real_database):
    fake_real_database.parent.mkdir(parents=True)
    fake_real_database.write_bytes(b"")
    link = fake_real_database.parent / "atalho.db"
    os.link(fake_real_database, link)  # mesmo arquivo, outro caminho
    for disguised in (
        str(link),
        f"/{fake_real_database.as_posix()}" if fake_real_database.drive else "",
        f"file:{fake_real_database.as_posix()}",
    ):
        if disguised:
            with pytest.raises(RuntimeError, match="banco real"):
                ensure_not_real_database(disguised)


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on"])
def test_demo_flag_accepts_the_usual_spellings(monkeypatch, value):
    monkeypatch.setenv("INVESTMENT_DEMO", value)
    get_settings.cache_clear()
    try:
        assert get_settings().demo is True
    finally:
        get_settings.cache_clear()


def test_demo_accepts_other_databases(fake_real_database, tmp_path):
    ensure_not_real_database(str(tmp_path / "demo" / "investment-demo.db"))
    ensure_not_real_database(None)  # banco em memória


def test_seed_demo_does_not_touch_a_session_on_the_real_database(fake_real_database):
    engine = make_engine(f"sqlite:///{fake_real_database.as_posix()}")
    with Session(engine) as session, pytest.raises(RuntimeError, match="banco real"):
        seed_demo(session, TODAY)
    assert not fake_real_database.exists()  # nem criou o arquivo


def test_app_in_demo_mode_does_not_start_on_the_real_database(fake_real_database, monkeypatch):
    settings = dataclasses.replace(
        get_settings(),
        demo=True,
        auto_migrate=True,
        benchmarks_auto=False,
        database_url=f"sqlite:///{fake_real_database.as_posix()}",
    )
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    with pytest.raises(RuntimeError, match="banco real"), TestClient(create_app(static_dir=None)):
        pass
    assert not fake_real_database.exists()  # a migração nem chegou a rodar


def test_demo_has_a_redemption_from_the_reserve_with_a_note(client):
    seed_demo(session_of(client), TODAY)

    [redemption] = client.get(f"{API}/movements", params={"kind": "resgate"}).json()
    summary = client.get(f"{API}/portfolio/month-summary", params={"month": "2026-10"}).json()

    assert redemption["asset_name"] == "Reserva Exemplo"
    assert redemption["note"] == "Conserto do carro (exemplo)"
    assert redemption["amount_cents"] == 50_000 and redemption["cost_cents"] > 0
    assert summary["redemptions_cents"] == 50_000
