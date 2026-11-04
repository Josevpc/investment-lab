"""Desempenho da carteira: Dietz modificado entre datas com saldo digitado e CDI diário composto."""

import random
from datetime import date, timedelta
from decimal import Decimal
from fractions import Fraction

import pytest

from app.features.analytics.performance import (
    Observation,
    ScopeFlow,
    cdi_returns,
    chained_returns,
    first_index_with_balance,
    to_bps,
)
from app.features.benchmarks import client as bcb
from app.features.portfolio.domain import return_bps

API = "/api/v1"
D = date
WEEK = timedelta(days=5)


def obs(*pairs):
    return [Observation(day, value) for day, value in pairs]


# ---- domínio: Dietz modificado -----------------------------------------------------------------


def test_without_flows_the_return_is_the_change_of_the_balance():
    result = chained_returns(obs((D(2026, 9, 1), 100_000), (D(2026, 9, 30), 110_000)), [])
    assert result.returns == [Fraction(0), Fraction(1, 10)]
    assert (result.flows_cents, result.gaps) == ([0, 0], 0)


def test_a_flow_is_weighted_by_the_days_it_stayed_invested():
    # Base em 31/08, aporte em 01/09: ficou 29 dos 30 dias do intervalo.
    result = chained_returns(
        obs((D(2026, 8, 31), 1_000_000), (D(2026, 9, 30), 1_111_000)),
        [ScopeFlow(D(2026, 9, 1), D(2026, 9, 30), 100_000)],
    )
    assert result.returns[1] == Fraction(11_000) / (
        Fraction(1_000_000) + Fraction(100_000) * 29 / 30
    )
    assert to_bps(result.returns[1]) == 100  # 110 / 10.966,67 = 1,003%
    assert result.flows_cents == [0, 100_000]


def test_a_flow_on_the_final_date_weighs_zero_and_one_on_the_base_date_is_already_in_the_balance():
    two = obs((D(2026, 9, 1), 1_000_000), (D(2026, 9, 30), 1_100_000))
    plain = chained_returns(two, []).returns[1]

    at_the_end = chained_returns(
        obs((D(2026, 9, 1), 1_000_000), (D(2026, 9, 30), 800_000)),
        [ScopeFlow(D(2026, 9, 30), D(2026, 9, 30), -300_000)],
    )
    at_the_start = chained_returns(
        obs((D(2026, 9, 1), 1_000_000), (D(2026, 9, 30), 1_100_000)),
        [ScopeFlow(D(2026, 9, 1), D(2026, 9, 1), 500_000)],  # fora de (t0, t1]
    )

    assert at_the_end.returns[1] == plain
    assert at_the_start.returns[1] == plain
    assert at_the_start.flows_cents == [0, 0]


def test_a_flow_the_balance_only_shows_later_weighs_from_the_start_of_that_interval():
    # O dinheiro entrou em 20/08, mas o ativo atrasado só o mostra no saldo de 30/09.
    result = chained_returns(
        obs((D(2026, 9, 1), 1_000_000), (D(2026, 9, 30), 1_100_000)),
        [ScopeFlow(D(2026, 8, 20), D(2026, 9, 30), 100_000)],
    )
    assert result.returns[1] == Fraction(0)


def test_intervals_are_chained():
    result = chained_returns(
        obs((D(2026, 1, 31), 100_000), (D(2026, 2, 28), 150_000), (D(2026, 3, 31), 156_560)),
        [ScopeFlow(D(2026, 2, 28), D(2026, 2, 28), 48_000)],  # aporte no último dia
    )
    # Fev: (150.000 - 100.000 - 48.000) / 100.000 = 2%. Mar: 156.560 / 150.000 = 4,3733...%.
    assert to_bps(result.returns[1]) == 200
    assert to_bps(result.returns[2]) == 646  # 1,02 x 1,043733 - 1


def test_a_contribution_alone_is_not_a_return():
    result = chained_returns(
        obs((D(2026, 1, 31), 100_000), (D(2026, 2, 28), 200_000)),
        [ScopeFlow(D(2026, 2, 28), D(2026, 2, 28), 100_000)],
    )
    assert to_bps(result.returns[1]) == 0


def test_returns_start_at_the_first_date_with_balance():
    observations = obs((D(2026, 1, 31), 0), (D(2026, 2, 28), 100_000), (D(2026, 3, 31), 110_000))
    result = chained_returns(observations, [])
    assert result.returns[0] is None
    assert result.returns[1] == Decimal(0)
    assert to_bps(result.returns[2]) == 1_000
    assert first_index_with_balance(observations) == 1
    assert first_index_with_balance(obs((D(2026, 1, 31), 0))) is None


def test_an_interval_without_balance_at_the_start_cannot_be_measured():
    result = chained_returns(
        obs((D(2026, 1, 31), 100_000), (D(2026, 2, 28), 0), (D(2026, 3, 31), 50_000)), []
    )
    assert to_bps(result.returns[1]) == -10_000  # perdeu tudo
    assert result.returns[2] == result.returns[1]  # sem saldo no início do intervalo seguinte
    assert result.gaps == 1


def test_contradictory_data_does_not_move_the_series():
    # Entrou R$ 1.000 no último dia mas o saldo final é zero: perda maior que 100%, sem sentido.
    result = chained_returns(
        obs((D(2026, 1, 31), 10_000), (D(2026, 2, 28), 0)),
        [ScopeFlow(D(2026, 2, 28), D(2026, 2, 28), 100_000)],
    )
    assert result.returns[1] == Fraction(0)
    assert result.gaps == 1


def test_no_balance_at_all_gives_empty_series():
    result = chained_returns([], [])
    assert (result.returns, result.flows_cents, result.gaps) == ([], [], 0)


# ---- domínio: CDI diário -----------------------------------------------------------------------


def business_days(first, last, rate="0.0004"):
    out, day = [], first
    while day <= last:
        if day.weekday() < 5:
            out.append((day, Decimal(rate)))
        day += timedelta(days=1)
    return out


def through_of(days):
    return days[-1][0] if days else None


def test_cdi_compounds_each_business_day_after_the_base_date():
    dates = [D(2026, 9, 4), D(2026, 9, 11), D(2026, 9, 18)]  # sextas
    days = business_days(D(2026, 9, 7), D(2026, 9, 30))
    result = cdi_returns(dates, 0, days, WEEK, through_of(days))

    assert result[0] == Decimal(0)
    assert result[1] == Decimal("1.0004") ** 5 - 1  # 7, 8, 9, 10 e 11 (dia 4 é a base)
    assert result[2] == Decimal("1.0004") ** 10 - 1


def test_cdi_does_not_depend_on_the_month_of_the_dates():
    # 30/09 -> 01/10 vale um dia útil, não o mês inteiro.
    days = business_days(D(2026, 10, 1), D(2026, 10, 5))
    result = cdi_returns([D(2026, 9, 30), D(2026, 10, 1)], 0, days, WEEK, through_of(days))
    assert result[1] == Decimal("0.0004")


def test_cdi_leaves_the_points_without_coverage_empty():
    days = business_days(D(2026, 9, 7), D(2026, 9, 18))
    dates = [D(2026, 9, 4), D(2026, 9, 18), D(2026, 9, 30)]
    result = cdi_returns(dates, 0, days, WEEK, through_of(days))
    assert result[1] is not None and result[2] is None  # 30/09 está 12 dias além do que se tem

    late = business_days(D(2026, 9, 14), D(2026, 9, 30))
    assert cdi_returns(dates, 0, late, WEEK, through_of(late))[1:] == [None, None]  # sem o começo
    assert cdi_returns(dates, 0, [], WEEK, None) == [Decimal(0), None, None]  # nada baixado
    assert cdi_returns(dates, None, days, WEEK, through_of(days)) == [None, None, None]


def test_cdi_covers_the_carnival_gap():
    # Base na sexta 13/02/2026; segunda e terça são Carnaval; o primeiro CDI é de 18/02.
    holidays = {D(2026, 2, 16), D(2026, 2, 17)}
    days = [d for d in business_days(D(2026, 2, 14), D(2026, 3, 31)) if d[0] not in holidays]
    result = cdi_returns([D(2026, 2, 13), D(2026, 3, 31)], 0, days, WEEK, through_of(days))
    assert result[1] is not None


def test_two_dates_with_no_business_day_between_them_have_zero_cdi():
    # Sexta e sábado, com CDI baixado depois: não houve dia útil, o CDI do intervalo é 0%.
    later = business_days(D(2026, 9, 7), D(2026, 9, 30))
    result = cdi_returns([D(2026, 9, 4), D(2026, 9, 5)], 0, [], WEEK, through_of(later))
    assert result == [Decimal(0), Decimal(0)]


# ---- domínio: uma só regra de arredondamento ----------------------------------------------------


@pytest.mark.parametrize(
    ("invested", "current", "expected"),
    [(20_000, 20_001, 1), (20_000, 19_999, 0), (20_000, 19_997, -1), (20_000, 20_002, 1)],
)
def test_half_a_basis_point_rounds_up_for_positive_and_negative_returns(
    invested, current, expected
):
    result = chained_returns(obs((D(2026, 1, 1), invested), (D(2026, 2, 1), current)), [])
    assert to_bps(result.returns[1]) == return_bps(invested, current) == expected


@pytest.mark.parametrize("seed", range(10))
def test_one_asset_without_flows_matches_the_asset_return_through_any_number_of_steps(seed):
    rng = random.Random(seed)
    for _ in range(200):
        start = rng.randint(1, 5_000) * 20_000  # múltiplo de 20.000: cai em meio ponto-base
        end = start + start * (rng.randint(-5_000, 5_000) * 2 + 1) // 20_000
        middle = [rng.randint(start // 3, start * 3) for _ in range(rng.randint(0, 20))]
        values = [start, *middle, end]
        observations = [
            Observation(D(2020, 1, 1) + timedelta(days=i), v) for i, v in enumerate(values)
        ]
        assert to_bps(chained_returns(observations, []).returns[-1]) == return_bps(start, end)


# ---- API ---------------------------------------------------------------------------------------


def load_cdi(client, monkeypatch, first, last, e9=400_000, ibovespa=()):
    """CDI diário de 0,04% em cada dia útil de `first` a `last`; devolve os dias carregados."""
    rows = [
        (first + timedelta(days=i), e9)
        for i in range((last - first).days + 1)
        if (first + timedelta(days=i)).weekday() < 5
    ]
    monkeypatch.setattr(bcb, "fetch_series", lambda series, start, end: [])
    monkeypatch.setattr(bcb, "fetch_daily_cdi", lambda start, end: rows)
    monkeypatch.setattr(bcb, "fetch_ibovespa", lambda start, end: list(ibovespa))
    assert client.post(f"{API}/benchmarks/refresh").status_code == 200
    return rows


def expected_cdi_bps(rows, after, through):
    """CDI composto calculado de novo, sem passar pelo código do app."""
    factor = Decimal(1)
    for day, e9 in rows:
        if after < day <= through:
            factor *= 1 + Decimal(e9) / 10**9
    return to_bps(factor - 1)


def typed(client, asset, day, balance, **extra):
    body = {"date": day, "balance_cents": balance, **extra}
    response = client.post(f"{API}/assets/{asset['id']}/balance", json=body)
    assert response.status_code == 200, response.text


def performance(client, **params):
    response = client.get(f"{API}/analytics/performance", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_cdi_is_the_product_of_the_business_days_between_the_dates(client, make_asset, monkeypatch):
    rows = load_cdi(client, monkeypatch, D(2026, 9, 1), D(2026, 10, 5))
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-09-05")
    typed(client, asset, "2026-09-30", 1_005_000)

    body = performance(client)

    days_between = [d for d, _ in rows if D(2026, 9, 5) < d <= D(2026, 9, 30)]
    assert len(days_between) == 18  # 05/09 é sábado: de 07/09 a 30/09
    assert [p["cdi_bps"] for p in body["points"]] == [
        0,
        expected_cdi_bps(rows, D(2026, 9, 5), D(2026, 9, 30)),
    ]
    assert body["points"][1]["cdi_bps"] == 72  # 1,0004^18 - 1
    assert body["summary"]["cdi_bps"] == 72
    assert body["summary"]["vs_cdi_bps"] == 50 - 72
    assert body["cdi_covered_through"] == "2026-10-05"


def test_the_next_day_across_a_month_boundary_gets_one_business_day_of_cdi(
    client, make_asset, monkeypatch
):
    rows = load_cdi(client, monkeypatch, D(2026, 9, 1), D(2026, 10, 5))
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-09-30")
    typed(client, asset, "2026-10-01", 1_000_400)

    points = performance(client)["points"]

    assert [p["date"] for p in points] == ["2026-09-30", "2026-10-01"]
    assert points[1]["cdi_bps"] == expected_cdi_bps(rows, D(2026, 9, 30), D(2026, 10, 1)) == 4
    assert points[1]["portfolio_bps"] == 4


def test_a_contribution_on_the_balance_date_is_already_in_the_balance(client, make_asset):
    # R$ 10.000 em 01/09 e, no mesmo dia, mais R$ 1.000 no saldo; em 30/09, R$ 11.110.
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-09-01")
    typed(client, asset, "2026-09-01", 1_100_000, contribution_cents=100_000)
    typed(client, asset, "2026-09-30", 1_111_000)

    body = performance(client)

    # O método antigo (aporte no fim do intervalo) dava 1,11%; o certo é 1.110 / 111.000.
    assert [p["portfolio_bps"] for p in body["points"]] == [0, 100]
    assert body["summary"]["flows_cents"] == 0


def test_a_contribution_inside_the_interval_is_weighted_by_the_days(client, make_asset):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-08-31")
    typed(
        client,
        asset,
        "2026-09-30",
        1_111_000,
        contribution_cents=100_000,
        contribution_date="2026-09-01",
    )

    body = performance(client)

    exact = Decimal(11_000) / (Decimal(1_000_000) + Decimal(100_000) * 29 / 30)
    assert body["points"][1]["portfolio_bps"] == to_bps(exact) == 100
    assert body["points"][1]["flows_cents"] == 100_000
    assert body["points"][1]["value_cents"] == 1_111_000
    assert body["summary"]["flows_cents"] == 100_000


def test_a_single_fixed_income_asset_without_flows_returns_what_the_asset_returns(
    client, make_asset
):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-09-01")
    typed(client, asset, "2026-09-15", 1_006_000)
    typed(client, asset, "2026-09-30", 1_012_345)

    body = performance(client)

    expected = client.get(f"{API}/assets/{asset['id']}").json()["return_bps"]
    assert expected == 123
    assert body["summary"]["portfolio_bps"] == expected
    assert [p["portfolio_bps"] for p in body["points"]] == [0, 60, 123]


def test_a_redemption_on_the_final_date_does_not_change_the_return(client, make_asset):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-09-01")
    typed(client, asset, "2026-09-30", 1_100_000)
    redemption = {"asset_id": asset["id"], "amount_cents": 300_000, "date": "2026-09-30"}
    assert client.post(f"{API}/redemptions", json=redemption).status_code == 201

    body = performance(client)

    assert body["points"][1]["value_cents"] == 800_000
    assert body["points"][1]["flows_cents"] == -300_000
    assert body["points"][1]["portfolio_bps"] == 1_000


def test_a_redemption_inside_the_interval_leaves_the_invested_capital_smaller(client, make_asset):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-09-01")
    redemption = {"asset_id": asset["id"], "amount_cents": 300_000, "date": "2026-09-16"}
    assert client.post(f"{API}/redemptions", json=redemption).status_code == 201
    typed(client, asset, "2026-09-30", 735_000)

    points = performance(client)["points"]

    exact = Decimal(35_000) / (Decimal(1_000_000) - Decimal(300_000) * 14 / 29)
    assert points[1]["portfolio_bps"] == to_bps(exact)
    assert points[1]["flows_cents"] == -300_000


def reserve_and_investment(client, make_asset, investment_final):
    reserve = make_asset(
        name="Reserva",
        invested=1_000_000,
        current=1_000_000,
        valuation_date="2026-09-01",
        purpose="reserva",
    )
    investment = make_asset(
        name="Fundo", invested=1_000_000, current=1_000_000, valuation_date="2026-09-01"
    )
    body = {
        "from_asset_id": reserve["id"],
        "to_asset_id": investment["id"],
        "amount_cents": 300_000,
        "date": "2026-09-15",
    }
    assert client.post(f"{API}/transfers", json=body).status_code == 201
    typed(client, reserve, "2026-09-30", 700_000)
    typed(client, investment, "2026-09-30", investment_final)


def test_a_transfer_from_the_reserve_is_a_flow_without_it_and_neutral_with_it(client, make_asset):
    reserve_and_investment(client, make_asset, 1_310_000)

    without = performance(client)
    with_reserve = performance(client, include_reserve=True)

    exact = Decimal(10_000) / (Decimal(1_000_000) + Decimal(300_000) * 15 / 29)
    assert without["points"][1]["flows_cents"] == 300_000
    assert without["points"][1]["portfolio_bps"] == to_bps(exact)
    assert with_reserve["points"][1]["flows_cents"] == 0
    assert with_reserve["points"][1]["portfolio_bps"] == 50  # 10.000 sobre 2.000.000
    assert with_reserve["include_reserve"] is True


def test_moving_money_out_of_the_reserve_alone_is_not_a_return(client, make_asset):
    reserve_and_investment(client, make_asset, 1_300_000)

    assert performance(client)["points"][1]["portfolio_bps"] == 0
    assert performance(client, include_reserve=True)["points"][1]["portfolio_bps"] == 0


@pytest.mark.parametrize("as_new_investment", [False, True])
def test_registering_an_asset_does_not_create_return(client, make_asset, as_new_investment):
    old = make_asset(
        name="Antigo", invested=1_000_000, current=1_000_000, valuation_date="2026-09-01"
    )
    new = make_asset(
        name="Novo",
        invested=500_000,
        current=600_000,
        valuation_date="2026-09-15",
        is_new_investment=as_new_investment,
    )
    typed(client, old, "2026-09-30", 1_000_000)
    typed(client, new, "2026-09-30", 600_000)

    body = performance(client)

    assert [p["date"] for p in body["points"]] == ["2026-09-01", "2026-09-15", "2026-09-30"]
    assert [p["portfolio_bps"] for p in body["points"]] == [0, 0, 0]
    assert [p["flows_cents"] for p in body["points"]] == [0, 600_000, 0]


def test_an_archived_asset_keeps_its_history_in_the_period(client, make_asset):
    old = make_asset(
        name="Velho", invested=1_000_000, current=1_000_000, valuation_date="2026-09-01"
    )
    new = make_asset(
        name="Novo", invested=1_000_000, current=1_000_000, valuation_date="2026-09-01"
    )
    move = {"from_asset_id": old["id"], "to_asset_id": new["id"], "amount_cents": 1_000_000}
    assert client.post(f"{API}/transfers", json=move | {"date": "2026-09-15"}).status_code == 201
    archive = {"name": "Velho", "class_key": "renda_fixa", "institution_id": old["institution_id"]}
    assert (
        client.put(f"{API}/assets/{old['id']}", json=archive | {"archived": True}).status_code
        == 200
    )
    typed(client, new, "2026-09-30", 2_100_000)

    body = performance(client)

    # Os R$ 20.000 do começo contam inteiros, mesmo com o ativo velho arquivado depois.
    assert [p["value_cents"] for p in body["points"]] == [2_000_000, 2_100_000]
    assert body["points"][1]["portfolio_bps"] == 500
    assert body["stale_assets"] == []  # arquivado não vira aviso


def test_an_asset_without_a_recent_balance_keeps_the_last_one_and_is_flagged(client, make_asset):
    late = make_asset(
        name="Atrasado", invested=500_000, current=500_000, valuation_date="2026-09-01"
    )
    near = make_asset(name="Quase", invested=500_000, current=500_000, valuation_date="2026-09-01")
    current = make_asset(
        name="Em dia",
        class_key="cripto",
        invested=500_000,
        current=500_000,
        valuation_date="2026-09-01",
    )
    typed(client, near, "2026-09-02", 500_000)  # 10 dias até a data final: ainda não passa
    typed(client, current, "2026-09-12", 505_000)

    body = performance(client)

    assert [p["value_cents"] for p in body["points"]] == [1_500_000, 1_500_000, 1_505_000]
    assert body["stale_assets"] == [
        {
            "asset_id": late["id"],
            "asset_name": "Atrasado",
            "last_observed_date": "2026-09-01",
            "days": 11,
        }
    ]
    # O aviso por ativo vem só em `stale_assets`: a tela não o mostra duas vezes.
    assert not any("dado de" in w for w in body["warnings"])
    # Só o que está no escopo escolhido é avisado.
    crypto = performance(client, scope="cripto")
    assert crypto["stale_assets"] == []
    assert not any("Atrasado" in w for w in crypto["warnings"])


def test_performance_by_category_scope(client, make_asset):
    rf = make_asset(
        name="CDB",
        class_key="renda_fixa",
        invested=1_000_000,
        current=1_000_000,
        valuation_date="2026-09-01",
    )
    btc = make_asset(
        name="BTC",
        class_key="cripto",
        invested=1_000_000,
        current=1_000_000,
        valuation_date="2026-09-01",
    )
    typed(client, rf, "2026-09-30", 1_010_000)
    typed(client, btc, "2026-09-30", 1_500_000)

    cripto = performance(client, scope="cripto")
    assert cripto["scope_label"] == "Criptomoedas"
    assert [p["portfolio_bps"] for p in cripto["points"]] == [0, 5_000]
    assert [p["portfolio_bps"] for p in performance(client, scope="renda_fixa")["points"]] == [
        0,
        100,
    ]
    assert [p["portfolio_bps"] for p in performance(client)["points"]] == [0, 2_550]
    assert client.get(f"{API}/analytics/performance", params={"scope": "ouro"}).status_code == 404


def test_a_date_with_only_the_reserve_updated_is_not_a_point_without_the_reserve(
    client, make_asset
):
    fund = make_asset(
        name="Fundo", invested=1_000_000, current=1_000_000, valuation_date="2026-09-01"
    )
    reserve = make_asset(
        name="Reserva",
        invested=1_000_000,
        current=1_000_000,
        valuation_date="2026-09-01",
        purpose="reserva",
    )
    typed(client, reserve, "2026-09-10", 1_001_000)
    typed(client, fund, "2026-09-30", 1_010_000)

    without = performance(client)
    with_reserve = performance(client, include_reserve=True)

    assert [p["date"] for p in without["points"]] == ["2026-09-01", "2026-09-30"]
    assert without["observations_count"] == 2
    assert [p["date"] for p in with_reserve["points"]] == ["2026-09-01", "2026-09-10", "2026-09-30"]
    assert with_reserve["observations_count"] == 3


def test_the_period_filter_restarts_the_series_and_counts_only_its_dates(client, make_asset):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-09-01")
    typed(client, asset, "2026-09-15", 1_100_000)
    typed(client, asset, "2026-09-30", 1_155_000)

    whole = performance(client)
    cut = performance(client, **{"from": "2026-09-10", "to": "2026-09-30"})

    assert whole["observations_count"] == 3
    assert [p["portfolio_bps"] for p in whole["points"]] == [0, 1_000, 1_550]
    assert [p["date"] for p in cut["points"]] == ["2026-09-15", "2026-09-30"]
    assert [p["portfolio_bps"] for p in cut["points"]] == [0, 500]
    assert cut["observations_count"] == 2
    assert cut["summary"]["start_date"] == "2026-09-15"
    assert cut["points"][0]["flows_cents"] == 0


def test_not_enough_dates_warns_and_shows_what_exists(client, make_asset):
    empty = performance(client)
    assert empty["points"] == [] and empty["observations_count"] == 0
    assert empty["warnings"] == [
        "Ainda faltam saldos em duas datas diferentes neste intervalo para comparar o desempenho."
    ]

    make_asset(valuation_date="2026-09-01")
    one = performance(client)
    assert len(one["points"]) == 1 and one["points"][0]["portfolio_bps"] == 0
    assert any("duas datas" in w for w in one["warnings"])


def test_without_daily_cdi_the_portfolio_series_stays_and_the_comparison_is_empty(
    client, make_asset
):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-09-01")
    typed(client, asset, "2026-09-30", 1_010_000)

    body = performance(client)

    assert [p["portfolio_bps"] for p in body["points"]] == [0, 100]
    assert [p["cdi_bps"] for p in body["points"]] == [0, None]
    assert body["summary"]["vs_cdi_bps"] is None
    assert any("Ainda não há CDI diário" in w for w in body["warnings"])
    assert body["cdi_covered_through"] is None


def test_cdi_that_stops_before_the_last_date_warns_and_leaves_the_late_points_empty(
    client, make_asset, monkeypatch
):
    load_cdi(client, monkeypatch, D(2026, 9, 1), D(2026, 9, 18))
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-09-01")
    typed(client, asset, "2026-09-18", 1_005_000)
    typed(client, asset, "2026-09-30", 1_010_000)

    body = performance(client)

    assert body["points"][1]["cdi_bps"] is not None and body["points"][2]["cdi_bps"] is None
    assert body["cdi_covered_through"] == "2026-09-18"
    assert any(
        "O CDI guardado vai até 18/09/2026 e não cobre todo o período" in w
        for w in body["warnings"]
    )


def test_a_weekend_after_the_last_cdi_day_is_not_a_missing_day(client, make_asset, monkeypatch):
    load_cdi(client, monkeypatch, D(2026, 9, 1), D(2026, 9, 25))  # sexta
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-09-01")
    typed(client, asset, "2026-09-27", 1_005_000)  # domingo

    body = performance(client)

    assert body["points"][1]["cdi_bps"] is not None
    assert not any("CDI" in w for w in body["warnings"])


def test_the_response_has_no_selic_and_no_snapshot_counter(client, make_asset):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-09-01")
    typed(client, asset, "2026-09-30", 1_010_000)

    body = performance(client)

    for gone in ("snapshots_count", "benchmark_covered_through"):
        assert gone not in body
    for gone in ("selic_bps", "vs_selic_bps"):
        assert gone not in body["summary"] and gone not in body["points"][0]
    assert {"observations_count", "stale_assets", "cdi_covered_through"} <= set(body)
    assert "Dietz" in body["method"] and "dia útil a dia útil" in body["method"]


def test_snapshots_do_not_change_the_performance(client, make_asset):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-09-01")
    typed(client, asset, "2026-09-30", 1_010_000)
    before = performance(client)

    foto = {
        "date": "2026-09-15",
        "items": [{"class_key": "cripto", "invested_cents": 1, "current_cents": 999}],
    }
    assert client.post(f"{API}/snapshots", json=foto).status_code == 201

    assert performance(client) == before


def test_a_credited_provento_is_return_for_the_total_and_for_the_payer(client, make_asset):
    fii = make_asset(
        name="FII",
        class_key="renda_variavel",
        asset_type="fii",
        fii_segment="papel",
        invested=1_000_000,
        current=1_000_000,
        valuation_date="2026-09-01",
    )
    conta = make_asset(name="Conta", invested=100_000, current=100_000, valuation_date="2026-09-01")
    credited = {
        "asset_id": fii["id"],
        "credited_asset_id": conta["id"],
        "amount_cents": 8_000,
        "date": "2026-09-10",
    }
    assert client.post(f"{API}/proventos", json=credited).status_code == 201
    typed(client, fii, "2026-09-30", 1_000_000)
    typed(client, conta, "2026-09-30", 108_000)

    total = performance(client)["points"][1]
    payer = performance(client, scope="renda_variavel")["points"][1]
    receiver = performance(client, scope="renda_fixa")["points"][1]

    # O dividendo creditado é rendimento da carteira: 8.000 sobre 1.100.000, e não zero.
    assert total["portfolio_bps"] == 73
    assert total["flows_cents"] == 0
    # Para quem pagou ele saiu do ativo, e o retorno conta o que foi distribuído.
    exact = Fraction(8_000) / (Fraction(1_000_000) - Fraction(8_000 * 20, 29))
    assert payer["portfolio_bps"] == to_bps(exact) == 80
    # Para quem recebeu é dinheiro de fora: neutro.
    assert receiver["portfolio_bps"] == 0


def archived_with_balance(client, make_asset):
    old = make_asset(name="Velho", invested=500_000, current=500_000, valuation_date="2026-09-01")
    fund = make_asset(
        name="Fundo", invested=1_000_000, current=1_000_000, valuation_date="2026-09-01"
    )
    archive = {"name": "Velho", "class_key": "renda_fixa", "institution_id": old["institution_id"]}
    assert (
        client.put(f"{API}/assets/{old['id']}", json=archive | {"archived": True}).status_code
        == 200
    )
    typed(client, fund, "2026-09-30", 1_010_000)
    typed(client, fund, "2026-10-31", 1_020_100)
    return old, fund


def test_an_archived_asset_with_a_balance_stops_adding_up_after_its_last_value(client, make_asset):
    archived_with_balance(client, make_asset)

    evolution = client.get(f"{API}/history/evolution").json()
    summary = client.get(f"{API}/portfolio/summary").json()
    body = performance(client)

    # O patrimônio da última data é o da Visão geral: o arquivado não fica congelado nele.
    assert evolution["points"][-1]["total_cents"] == summary["total_current_cents"] == 1_020_100
    assert [p["value_cents"] for p in body["points"]] == [1_500_000, 1_010_000, 1_020_100]
    # A saída é neutra: ele conta, parado, até a última data em que apareceu.
    assert body["points"][1]["flows_cents"] == -500_000
    assert body["points"][1]["portfolio_bps"] == 67  # 10.000 sobre 1.500.000
    assert body["points"][2]["flows_cents"] == 0
    assert body["points"][2]["portfolio_bps"] == 167  # 1,006667 x 1,01 - 1


def test_the_year_goal_does_not_keep_an_archived_balance(client, make_asset, monkeypatch):
    monkeypatch.setattr("app.features.goals.service._today", lambda: D(2026, 10, 31))
    archived_with_balance(client, make_asset)

    year = client.get(f"{API}/goals/progress").json()["year"]

    assert year["accumulated_cents"] == 1_020_100 - 1_500_000
    # O arquivado saiu do patrimônio sem ser prejuízo: a valorização do ano soma a saída de volta.
    assert year["status"] == "ok"
    assert year["archived_out_cents"] == 500_000
    assert year["appreciation_cents"] == 1_020_100 - 1_500_000 + 500_000


def test_cdi_one_business_day_short_inside_the_tolerance_is_shown_without_a_warning(
    client, make_asset, monkeypatch
):
    load_cdi(client, monkeypatch, D(2026, 9, 1), D(2026, 9, 24))  # quinta; falta a sexta 25
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-09-01")
    typed(client, asset, "2026-09-28", 1_005_000)  # segunda: 4 dias depois

    body = performance(client)

    assert body["points"][1]["cdi_bps"] is not None
    assert not any("CDI" in w for w in body["warnings"])


def test_the_carnival_gap_does_not_hide_the_cdi(client, make_asset, monkeypatch):
    rows = load_cdi(client, monkeypatch, D(2026, 2, 18), D(2026, 3, 31))  # sem 16 e 17/02
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-02-13")
    typed(client, asset, "2026-03-31", 1_010_000)

    body = performance(client)

    assert body["points"][1]["cdi_bps"] == expected_cdi_bps(rows, D(2026, 2, 13), D(2026, 3, 31))
    assert not any("Faltam dias de CDI" in w for w in body["warnings"])


def test_friday_to_saturday_has_zero_cdi_and_no_warning(client, make_asset, monkeypatch):
    load_cdi(client, monkeypatch, D(2026, 9, 1), D(2026, 10, 5))
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-09-04")
    typed(client, asset, "2026-09-05", 1_000_100)

    body = performance(client)

    assert [p["cdi_bps"] for p in body["points"]] == [0, 0]
    assert not any("CDI" in w for w in body["warnings"])
