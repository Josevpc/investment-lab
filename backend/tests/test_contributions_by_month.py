"""Aportes por mês (GET /history/contributions-by-month): a série do gráfico de colunas.

O aporte de cada mês é o mesmo total do resumo do mês: dinheiro separado conta no mês da
separação, a compra paga com ele não conta de novo, "fora da meta" entra no total com o valor à
parte. O saldo de ativos antigos fica em coluna própria. Datas fixas no passado e "hoje" fixado em
junho de 2026, para o mês atual não depender do relógio.
"""

import datetime as dt

import pytest

from app.features.history import router as history_router
from app.features.history.domain import MAX_MONTHS, month_name, month_span, parse_month

API = "/api/v1"
URL = f"{API}/history/contributions-by-month"
TODAY = dt.date(2026, 6, 15)
JAN, FEB, MAR, APR, MAY, JUN = (f"2026-{m:02d}" for m in range(1, 7))


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr(history_router, "_today", lambda: TODAY)


@pytest.fixture
def account(client, institution):
    return client.get(f"{API}/accounts").json()[0]["id"]


@pytest.fixture
def classes(client):
    return {c["key"]: c["id"] for c in client.get(f"{API}/asset-classes").json()}


@pytest.fixture
def cash(client, account):
    """Caixa de R$ 10.000,00 ativado em janeiro."""
    response = client.post(
        f"{API}/accounts/{account}/opening-balance",
        json={"date": "2026-01-01", "amount_cents": 1_000_000},
    )
    assert response.status_code == 201, response.text
    return account


def series(client, **params):
    response = client.get(URL, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def by_month(client, **params):
    return {row["month"]: row for row in series(client, **params)["months"]}


def summary(client, month):
    response = client.get(f"{API}/portfolio/month-summary", params={"month": month})
    assert response.status_code == 200, response.text
    return response.json()


def separate(client, account_id, class_id, cents, on):
    response = client.post(
        f"{API}/accounts/{account_id}/reservations",
        json={"class_id": class_id, "amount_cents": cents, "date": on},
    )
    assert response.status_code == 201, response.text


def buy(client, asset, cents, on, **body):
    response = client.post(
        f"{API}/purchases",
        json={"asset_id": asset["id"], "amount_cents": cents, "date": on, **body},
    )
    assert response.status_code == 201, response.text


def close(client, asset, on, balance_cents, contribution, **extra):
    response = client.post(
        f"{API}/assets/{asset['id']}/balance",
        json={
            "date": on,
            "balance_cents": balance_cents,
            "contribution_cents": contribution,
            **extra,
        },
    )
    assert response.status_code == 200, response.text


def plan(client, month, salary_cents, percent_bps=1_000):
    response = client.put(
        f"{API}/contributions/{month}",
        json={"salary_cents": salary_cents, "percent_bps": percent_bps},
    )
    assert response.status_code in (200, 201), response.text
    return response.json()["final_cents"]


# ---- domínio ----------------------------------------------------------------------------------


def test_month_helpers_walk_across_years():
    assert month_span("2025-11", "2026-02") == ["2025-11", "2025-12", "2026-01", "2026-02"]
    assert month_span("2026-03", "2026-03") == ["2026-03"]
    assert month_span("2026-03", "2026-02") == []
    assert month_name(2026 * 12 + 11) == "2026-12"
    assert parse_month("2026-12") == (2026, 12)
    assert parse_month("2026-01") == (2026, 1)
    invalid = ("2026-13", "2026-00", "2026-3", "26-03", "", "2026-03\n", "2026-03 ", "\n2026-03")
    assert all(parse_month(bad) is None for bad in invalid)


# ---- sem dados --------------------------------------------------------------------------------


def test_without_any_data_the_series_is_empty(client):
    body = series(client)

    assert body["months"] == []
    assert body["current_month"] == JUN
    assert (body["from_month"], body["to_month"]) == (JUN, JUN)


def test_an_explicit_range_without_data_is_all_zeros(client):
    months = series(client, **{"from": MAR, "to": MAY})["months"]

    assert [m["month"] for m in months] == [MAR, APR, MAY]
    for row in months:
        assert (row["contributed_cents"], row["goal_cents"], row["off_goal_cents"]) == (0, 0, 0)
        assert row["carried_in_cents"] == 0
        assert row["planned_cents"] is None
        assert row["in_progress"] is False


# ---- aporte do mês = total do resumo do mês --------------------------------------------------


def test_each_month_matches_the_month_summary_total(client, cash, classes, make_asset):
    stock = make_asset(
        "Ação",
        class_key="acoes_etfs",
        invested=100_000,
        current=100_000,
        valuation_date="2026-01-31",
    )
    cdb = make_asset("CDB", invested=100_000, current=100_000, valuation_date="2026-01-31")
    separate(client, cash, classes["acoes_etfs"], 4_000, "2026-02-10")
    separate(client, cash, classes["acoes_etfs"], 6_000, "2026-03-10")
    close(client, cdb, "2026-03-20", 130_000, 20_000)
    close(client, cdb, "2026-04-20", 160_000, 30_000, off_goal=True)
    buy(client, stock, 10_000, "2026-05-10")
    make_asset(
        "Novo", invested=70_000, current=75_000, valuation_date="2026-05-31", is_new_investment=True
    )

    rows = by_month(client, **{"from": JAN, "to": JUN})

    assert list(rows) == [JAN, FEB, MAR, APR, MAY, JUN]
    for month, row in rows.items():
        expected = summary(client, month)
        assert row["contributed_cents"] == expected["total_cents"], month
        assert row["off_goal_cents"] == expected["off_goal_cents"], month
        assert row["goal_cents"] + row["off_goal_cents"] == row["contributed_cents"], month
    assert rows[MAR]["contributed_cents"] == 26_000  # R$ 60 separados + R$ 200 do aporte
    assert rows[MAY]["contributed_cents"] == 70_000  # a compra paga com separado não conta


def test_integer_cents_in_every_field(client, make_asset):
    cdb = make_asset(invested=100_000, current=100_000, valuation_date="2026-01-31")
    close(client, cdb, "2026-02-10", 110_001, 10_001)

    row = by_month(client, **{"from": FEB, "to": FEB})[FEB]

    for key in ("contributed_cents", "goal_cents", "off_goal_cents", "carried_in_cents"):
        assert type(row[key]) is int
    assert row["contributed_cents"] == 10_001


# ---- separado e compra paga com separado ------------------------------------------------------


def test_the_separated_counts_once_and_the_purchase_paid_with_it_counts_zero(
    client, cash, classes, make_asset
):
    stock = make_asset(
        "Ação",
        class_key="acoes_etfs",
        invested=100_000,
        current=100_000,
        valuation_date="2026-01-31",
    )
    for month in (FEB, MAR, APR):
        separate(client, cash, classes["acoes_etfs"], 4_000, f"{month}-10")
    buy(client, stock, 10_000, "2026-05-10")

    rows = by_month(client, **{"from": FEB, "to": MAY})

    assert [rows[m]["contributed_cents"] for m in (FEB, MAR, APR)] == [4_000, 4_000, 4_000]
    assert rows[MAY]["contributed_cents"] == 0
    # R$ 120 separados, R$ 100 gastos na compra: nunca os R$ 220 de contar os dois lados.
    assert sum(r["contributed_cents"] for r in rows.values()) == 12_000


def test_a_purchase_paid_with_free_cash_counts_in_its_own_month(client, cash, make_asset):
    stock = make_asset(
        "Ação",
        class_key="acoes_etfs",
        invested=100_000,
        current=100_000,
        valuation_date="2026-01-31",
    )
    buy(client, stock, 10_000, "2026-05-10")

    rows = by_month(client, **{"from": APR, "to": MAY})

    assert (rows[APR]["contributed_cents"], rows[MAY]["contributed_cents"]) == (0, 10_000)
    assert rows[MAY]["goal_cents"] == 10_000


# ---- fora da meta -----------------------------------------------------------------------------


def test_off_goal_counts_in_the_total_and_shows_apart(client, make_asset):
    cdb = make_asset(invested=100_000, current=100_000, valuation_date="2026-01-31")
    close(client, cdb, "2026-03-10", 130_000, 30_000)
    close(client, cdb, "2026-04-10", 190_000, 50_000, off_goal=True)

    rows = by_month(client, **{"from": MAR, "to": APR})

    assert (rows[MAR]["contributed_cents"], rows[MAR]["goal_cents"]) == (30_000, 30_000)
    assert rows[MAR]["off_goal_cents"] == 0
    assert rows[APR]["contributed_cents"] == 50_000
    assert (rows[APR]["goal_cents"], rows[APR]["off_goal_cents"]) == (0, 50_000)


# ---- ativo novo x ativo antigo ----------------------------------------------------------------


def test_a_new_asset_is_a_contribution_and_an_old_one_is_carried_in(client, make_asset):
    make_asset(
        "Novo", invested=80_000, current=90_000, valuation_date="2026-02-28", is_new_investment=True
    )
    make_asset("Antigo", invested=60_000, current=65_000, valuation_date="2026-03-31")

    rows = by_month(client, **{"from": FEB, "to": MAR})

    assert (rows[FEB]["contributed_cents"], rows[FEB]["carried_in_cents"]) == (80_000, 0)
    assert (rows[MAR]["contributed_cents"], rows[MAR]["carried_in_cents"]) == (0, 60_000)


def test_carried_in_never_enters_the_contributed_total(client, make_asset):
    make_asset("Antigo", invested=60_000, current=65_000, valuation_date="2026-03-31")

    row = by_month(client, **{"from": MAR, "to": MAR})[MAR]

    assert row["contributed_cents"] == 0
    assert row["goal_cents"] + row["off_goal_cents"] == 0
    assert row["carried_in_cents"] == 60_000
    assert summary(client, MAR)["total_cents"] == 0


def test_carried_in_leaves_out_contributions_already_in_the_diary(client, make_asset):
    old = make_asset("Antigo", invested=80_000, current=80_000, valuation_date="2026-03-31")
    close(client, old, "2026-03-31", 120_000, 20_000)  # R$ 200 de aporte no dia do cadastro

    row = by_month(client, **{"from": MAR, "to": MAR})[MAR]

    # Os R$ 1.000 investidos já têm os R$ 200 do aporte: cada centavo aparece uma vez só.
    assert row["contributed_cents"] == 20_000
    assert row["carried_in_cents"] == 80_000


def test_a_redemption_does_not_take_anything_away(client, make_asset):
    cdb = make_asset(invested=100_000, current=100_000, valuation_date="2026-01-31")
    close(client, cdb, "2026-03-10", 130_000, 30_000)
    response = client.post(
        f"{API}/redemptions",
        json={"asset_id": cdb["id"], "amount_cents": 20_000, "date": "2026-04-10"},
    )
    assert response.status_code == 201, response.text

    rows = by_month(client, **{"from": MAR, "to": APR})

    assert rows[MAR]["contributed_cents"] == 30_000
    assert rows[APR]["contributed_cents"] == 0


# ---- planejado, meses vazios e mês atual -----------------------------------------------------


def test_the_planned_amount_comes_from_the_contribution_of_the_month(client):
    planned = plan(client, MAR, 500_000)

    rows = by_month(client, **{"from": FEB, "to": APR})

    assert planned > 0
    assert rows[MAR]["planned_cents"] == planned
    assert rows[FEB]["planned_cents"] is None
    assert rows[APR]["planned_cents"] is None


def test_months_without_movement_come_with_zeros_and_only_the_current_is_in_progress(
    client, make_asset
):
    cdb = make_asset(invested=100_000, current=100_000, valuation_date="2026-01-31")
    close(client, cdb, "2026-03-10", 130_000, 30_000)

    body = series(client, **{"from": FEB, "to": "2026-08"})

    assert [m["month"] for m in body["months"]] == [
        FEB,
        MAR,
        APR,
        MAY,
        JUN,
        "2026-07",
        "2026-08",
    ]  # meses futuros também vêm, em zero
    assert [m["month"] for m in body["months"] if m["in_progress"]] == [JUN]
    assert body["current_month"] == JUN
    rows = {m["month"]: m for m in body["months"]}
    assert rows[APR]["contributed_cents"] == 0
    assert rows[JUN]["contributed_cents"] == 0
    assert rows[MAR]["in_progress"] is False


def test_the_planned_shows_for_the_current_month_even_with_nothing_contributed_yet(client):
    planned = plan(client, JUN, 500_000)

    rows = by_month(client, **{"from": MAY, "to": JUN})

    assert rows[JUN]["in_progress"] is True
    assert rows[JUN]["contributed_cents"] == 0
    assert rows[JUN]["planned_cents"] == planned


# ---- intervalo padrão -------------------------------------------------------------------------


def test_without_from_it_starts_at_the_first_month_with_anything(client, make_asset):
    cdb = make_asset(invested=100_000, current=100_000, valuation_date="2026-02-28")
    close(client, cdb, "2026-04-10", 130_000, 30_000)

    body = series(client)

    # O 1º mês com dado é o do saldo trazido (cadastro do ativo antigo).
    assert (body["from_month"], body["to_month"]) == (FEB, JUN)
    assert [m["month"] for m in body["months"]] == [FEB, MAR, APR, MAY, JUN]


def test_the_plan_alone_also_starts_the_series(client):
    plan(client, "2026-03", 500_000)

    body = series(client)

    assert body["from_month"] == MAR


def test_without_from_a_very_old_history_is_cut_to_the_last_120_months(client):
    plan(client, "2010-01", 500_000)

    body = series(client)

    assert len(body["months"]) == MAX_MONTHS
    assert body["months"][0]["month"] == "2016-07"
    assert body["months"][-1]["month"] == JUN


def test_only_to_limits_the_end_of_the_series(client, make_asset):
    cdb = make_asset(invested=100_000, current=100_000, valuation_date="2026-01-31")
    close(client, cdb, "2026-05-10", 130_000, 30_000)

    body = series(client, to=MAR)

    assert (body["from_month"], body["to_month"]) == (JAN, MAR)
    assert all(m["contributed_cents"] == 0 for m in body["months"])


# ---- erros ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    # Quebra de linha e espaço no fim: o `$` de uma regex aceitaria a quebra.
    ["2026-13", "2026-00", "2026-3", "26-03", "março", "2026-03-01", "2026-03\n", "2026-03 "],
)
@pytest.mark.parametrize("name", ["from", "to"])
def test_a_bad_month_format_is_refused_in_portuguese(client, name, bad):
    response = client.get(URL, params={name: bad})

    assert response.status_code == 422
    assert "AAAA-MM" in response.json()["detail"]


def test_from_after_to_is_refused(client):
    response = client.get(URL, params={"from": MAY, "to": MAR})

    assert response.status_code == 422
    assert response.json()["detail"] == "O mês inicial não pode ser depois do mês final."


def test_from_after_the_current_month_without_to_is_refused(client):
    response = client.get(URL, params={"from": "2026-09"})

    assert response.status_code == 422


def test_a_range_of_more_than_120_months_is_refused_and_exactly_120_is_fine(client):
    refused = client.get(URL, params={"from": "2016-06", "to": JUN})
    allowed = client.get(URL, params={"from": "2016-07", "to": JUN})

    assert refused.status_code == 422
    assert refused.json()["detail"] == "O intervalo pode ter no máximo 120 meses."
    assert allowed.status_code == 200
    assert len(allowed.json()["months"]) == 120
