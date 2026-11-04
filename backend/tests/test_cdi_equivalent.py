import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

import pytest

from app.features.analytics.cdi_equivalent import Flow, growth, simulate, solve_pct_of_cdi, to_bps
from app.features.benchmarks import client as bcb

API = "/api/v1"
RATE = Decimal("0.0004")  # 0,04% ao dia


def business_days(start: dt.date, end: dt.date) -> list[dt.date]:
    """Dias úteis (sem feriados) em (start, end]."""
    day, out = start + dt.timedelta(days=1), []
    while day <= end:
        if day.weekday() < 5:
            out.append(day)
        day += dt.timedelta(days=1)
    return out


def days_with(rate: Decimal, start: dt.date, end: dt.date):
    return [(d, rate) for d in business_days(start, end)]


def cents(value: Decimal) -> int:
    return int(value.to_integral_value(rounding=ROUND_HALF_UP))


# ---- funções puras -----------------------------------------------------------------------


def test_simulate_compounds_daily_at_the_given_percent_of_cdi():
    days = [(dt.date(2026, 10, d), RATE) for d in (1, 2, 5)]
    # 100.000 a 120% do CDI por três dias úteis: (1 + 1,2 x 0,0004)^3.
    expected = Decimal(100_000) * (1 + Decimal("1.2") * RATE) ** 3
    assert simulate(100_000, [], days, Decimal("1.2")) == expected


def test_an_aporte_only_earns_from_the_day_after_it_is_made():
    days = [(dt.date(2026, 10, d), RATE) for d in (1, 2, 5, 6)]
    on_the_2nd = simulate(0, [Flow(dt.date(2026, 10, 2), 10_000)], days, Decimal(1))
    # Entrou no dia 2, depois da taxa do dia 2: rende só os dias 5 e 6.
    assert on_the_2nd == Decimal(10_000) * (1 + RATE) ** 2
    on_the_last_day = simulate(0, [Flow(dt.date(2026, 10, 6), 10_000)], days, Decimal(1))
    assert on_the_last_day == Decimal(10_000)  # entrou no último dia: não rendeu nada


def test_growth_is_the_accumulated_factor():
    days = [(dt.date(2026, 10, d), RATE) for d in (1, 2)]
    assert growth(days, Decimal(1)) == (1 + RATE) ** 2


@pytest.mark.parametrize("pct", ["0.98", "1", "1.18", "1.2", "1.5"])
def test_solving_recovers_the_percent_that_produced_the_balance(pct):
    start, end = dt.date(2026, 9, 30), dt.date(2026, 10, 30)
    days = days_with(RATE, start, end)
    flows = [Flow(dt.date(2026, 10, 15), 10_000_00)]
    final = cents(simulate(100_000_00, flows, days, Decimal(pct)))

    found = solve_pct_of_cdi(100_000_00, flows, days, final)

    assert found is not None
    assert abs(found - Decimal(pct)) < Decimal("0.0005")


def test_user_example_started_the_month_with_1000_and_added_100_on_the_15th():
    start, end = dt.date(2026, 9, 30), dt.date(2026, 10, 31)
    days = days_with(RATE, start, end)
    flows = [Flow(dt.date(2026, 10, 15), 10_000)]
    final = cents(simulate(100_000, flows, days, Decimal("1.2")))  # o que 120% do CDI daria
    assert solve_pct_of_cdi(100_000, flows, days, final - 20) < Decimal("1.2")  # R$ 0,20 a menos
    assert solve_pct_of_cdi(100_000, flows, days, final + 20) > Decimal("1.2")


def test_ignoring_the_aporte_date_would_overstate_the_percent():
    start, end = dt.date(2026, 9, 30), dt.date(2026, 10, 30)
    days = days_with(RATE, start, end)
    final = cents(
        simulate(100_000_00, [Flow(dt.date(2026, 10, 15), 50_000_00)], days, Decimal("1.2"))
    )
    on_the_first_day = [Flow(dt.date(2026, 10, 1), 50_000_00)]
    assert solve_pct_of_cdi(100_000_00, on_the_first_day, days, final) < Decimal("1.2")


def test_nothing_to_measure_returns_none():
    days = days_with(RATE, dt.date(2026, 10, 1), dt.date(2026, 10, 9))
    assert solve_pct_of_cdi(0, [], days, 0) is None  # sem capital
    assert solve_pct_of_cdi(100, [], [], 100) is None  # sem CDI
    assert solve_pct_of_cdi(100_00, [], days, 10_000_000) is None  # fora do intervalo plausível


def test_to_bps_rounds_half_up():
    assert to_bps(Decimal("0.0118")) == 118
    assert to_bps(Decimal("0.01185")) == 119  # 118,5 sobe


# ---- cliente do Banco Central ------------------------------------------------------------


def test_parse_daily_keeps_the_six_decimals_exact():
    rows = bcb.parse_daily([{"data": "02/01/2026", "valor": "0.043739"}])
    assert rows == [(dt.date(2026, 1, 2), 437_390)]
    assert bcb.percent_to_e9("0.055131") == 551_310


# ---- ponta a ponta -----------------------------------------------------------------------


def seed_cdi(client, monkeypatch, start: dt.date, end: dt.date):
    rows = [(d, 437_390) for d in business_days(start, end)]
    monkeypatch.setattr(bcb, "fetch_series", lambda series, s, e: [("2026-10", 10_000)])
    monkeypatch.setattr(bcb, "fetch_daily_cdi", lambda s, e: rows)
    monkeypatch.setattr(bcb, "fetch_ibovespa", lambda s, e: [])
    assert client.post(f"{API}/benchmarks/refresh").status_code == 200
    return Decimal(437_390) / Decimal(10**9)


def test_asset_performance_reports_the_percent_of_cdi(client, make_asset, monkeypatch):
    rate = seed_cdi(client, monkeypatch, dt.date(2026, 9, 1), dt.date(2026, 10, 30))
    asset = make_asset(
        name="Conta 120% CDI",
        invested=100_000_00,
        current=100_000_00,
        indexer="CDI",
        rate_bps=12_000,
        valuation_date="2026-09-30",
    )
    days = [(d, rate) for d in business_days(dt.date(2026, 9, 30), dt.date(2026, 10, 30))]
    aporte = Flow(dt.date(2026, 10, 15), 10_000_00)
    final = cents(simulate(100_000_00, [aporte], days, Decimal("1.18")))  # rendeu 118%

    saved = client.post(
        f"{API}/assets/{asset['id']}/balance",
        json={
            "date": "2026-10-30",
            "balance_cents": final,
            "contribution_cents": aporte.cents,
            "contribution_date": "2026-10-15",
        },
    )
    assert saved.status_code in (200, 201), saved.text

    body = client.get(f"{API}/analytics/assets/{asset['id']}/vs-cdi").json()
    assert body["start_date"] == "2026-09-30"
    assert body["end_date"] == "2026-10-30"
    assert body["flows"] == [{"date": "2026-10-15", "kind": "aporte", "cents": 10_000_00}]
    assert body["yield_cents"] == final - 100_000_00 - 10_000_00
    assert abs(body["pct_of_cdi_bps"] - 11_800) <= 10
    assert body["contracted_pct_bps"] == 12_000
    assert body["vs_contracted_bps"] < 0  # abaixo dos 120% contratados
    assert body["cdi_bps"] > 0
    assert len(body["steps"]) == 1


def test_asset_performance_warns_when_there_is_no_daily_cdi(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-09-30")
    client.post(
        f"{API}/assets/{asset['id']}/balance", json={"date": "2026-10-30", "balance_cents": 101_000}
    )
    body = client.get(f"{API}/analytics/assets/{asset['id']}/vs-cdi").json()
    assert body["pct_of_cdi_bps"] is None
    assert any("CDI diário" in w for w in body["warnings"])


def test_asset_with_one_balance_has_nothing_to_compare(client, make_asset):
    asset = make_asset()
    body = client.get(f"{API}/analytics/assets/{asset['id']}/vs-cdi").json()
    assert body["pct_of_cdi_bps"] is None
    assert body["warnings"]


def test_free_period_snaps_to_the_nearest_observed_balances(client, make_asset, monkeypatch):
    seed_cdi(client, monkeypatch, dt.date(2026, 8, 1), dt.date(2026, 10, 30))
    asset = make_asset(invested=100_000_00, current=100_000_00, valuation_date="2026-08-31")
    for date, balance in (("2026-09-30", 101_000_00), ("2026-10-30", 102_000_00)):
        client.post(
            f"{API}/assets/{asset['id']}/balance", json={"date": date, "balance_cents": balance}
        )

    whole = client.get(f"{API}/analytics/assets/{asset['id']}/vs-cdi").json()
    part = client.get(
        f"{API}/analytics/assets/{asset['id']}/vs-cdi?from=2026-09-28&to=2026-10-30"
    ).json()

    assert whole["start_date"] == "2026-08-31" and len(whole["steps"]) == 2  # padrão: período total
    assert part["start_date"] == "2026-09-30"  # 28/09 -> saldo observado mais próximo
    assert part["start_cents"] == 101_000_00
    assert len(part["steps"]) == 1


def test_transfer_rows_are_not_used_as_observed_balances(client, make_asset, monkeypatch):
    seed_cdi(client, monkeypatch, dt.date(2026, 8, 1), dt.date(2026, 10, 30))
    source = make_asset(
        name="Origem", invested=100_000, current=100_000, valuation_date="2026-08-31"
    )
    target = make_asset(
        name="Destino", invested=100_000, current=100_000, valuation_date="2026-08-31"
    )
    client.post(
        f"{API}/transfers",
        json={
            "from_asset_id": source["id"],
            "to_asset_id": target["id"],
            "amount_cents": 10_000,
            "date": "2026-09-15",
        },
    )
    body = client.get(f"{API}/analytics/assets/{target['id']}/vs-cdi").json()
    assert body["dates"] == [
        "2026-08-31"
    ]  # a linha criada pela transferência não é um saldo digitado
    assert body["warnings"]


def test_contribution_date_must_fall_between_the_last_balance_and_the_balance_date(
    client, make_asset
):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-09-30")
    url = f"{API}/assets/{asset['id']}/balance"
    too_early = client.post(
        url,
        json={
            "date": "2026-10-30",
            "balance_cents": 111_000,
            "contribution_cents": 10_000,
            "contribution_date": "2026-09-30",
        },
    )
    assert too_early.status_code == 422
    too_late = client.post(
        url,
        json={
            "date": "2026-10-30",
            "balance_cents": 111_000,
            "contribution_cents": 10_000,
            "contribution_date": "2026-11-02",
        },
    )
    assert too_late.status_code == 422
    ok = client.post(
        url,
        json={
            "date": "2026-10-30",
            "balance_cents": 111_000,
            "contribution_cents": 10_000,
            "contribution_date": "2026-10-15",
        },
    )
    assert ok.status_code in (200, 201)
    movements = client.get(f"{API}/movements").json()
    assert [m["date"] for m in movements if m["kind"] == "aporte"] == ["2026-10-15"]


def test_variable_income_reports_class_return_and_proventos_in_the_period(
    client, make_asset, monkeypatch
):
    seed_cdi(client, monkeypatch, dt.date(2026, 8, 1), dt.date(2026, 10, 30))
    fii = make_asset(
        name="FII",
        class_key="renda_variavel",
        asset_type="fii",
        fii_segment="papel",
        invested=100_000_00,
        current=100_000_00,
        valuation_date="2026-09-30",
    )
    client.post(
        f"{API}/proventos",
        json={"asset_id": fii["id"], "amount_cents": 80_00, "date": "2026-10-10"},
    )
    client.post(
        f"{API}/assets/{fii['id']}/balance",
        json={"date": "2026-10-30", "balance_cents": 102_000_00},
    )

    body = client.get(f"{API}/analytics/assets/{fii['id']}/vs-cdi").json()

    assert body["class_key"] == "renda_variavel"
    assert body["asset_type"] == "fii"
    assert body["proventos_cents"] == 80_00  # o provento não entra no saldo, só é informado
    assert body["yield_cents"] == 2_000_00  # variação de preço do período
    assert body["return_bps"] is not None and body["cdi_bps"] is not None


def test_performance_tells_whether_the_balances_are_net_of_tax(client, make_asset):
    gross = make_asset(
        name="Tesouro", invested=100_000, current=100_000, valuation_date="2026-09-30"
    )
    net = make_asset(
        name="Caixinha",
        invested=100_000,
        current=100_000,
        valuation_date="2026-09-30",
        balance_is_net=True,
    )
    for asset in (gross, net):
        client.post(
            f"{API}/assets/{asset['id']}/balance",
            json={"date": "2026-10-30", "balance_cents": 101_000},
        )

    flags = [
        client.get(f"{API}/analytics/assets/{a['id']}/vs-cdi").json()["balance_is_net"]
        for a in (gross, net)
    ]
    assert flags == [False, True]
    listed = client.get(f"{API}/analytics/assets-vs-cdi").json()
    assert {r["asset_name"]: r["balance_is_net"] for r in listed} == {
        "Tesouro": False,
        "Caixinha": True,
    }


def test_performance_of_an_asset_without_enough_balances_still_tells_net_or_gross(
    client, make_asset
):
    net = make_asset(balance_is_net=True)
    body = client.get(f"{API}/analytics/assets/{net['id']}/vs-cdi").json()
    assert body["pct_of_cdi_bps"] is None
    assert body["balance_is_net"] is True
