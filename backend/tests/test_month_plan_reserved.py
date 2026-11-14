"""Plano do mês, divisão do aporte e metas com o dinheiro separado por categoria.

O separado conta na meta da categoria no mês em que foi separado; a compra paga com ele não conta de
novo no mês da compra. Datas fixas no passado: o separado não pode ser futuro e os meses precisam
ser distintos.
"""

import datetime as dt

import pytest

API = "/api/v1"
FEB, MAR, APR, MAY = "2026-02", "2026-03", "2026-04", "2026-05"


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


@pytest.fixture
def stock(make_asset):
    return make_asset(
        "Ação",
        class_key="acoes_etfs",
        invested=100_000,
        current=100_000,
        valuation_date="2026-01-31",
    )


@pytest.fixture
def three_months(client, cash, classes):
    """R$ 40,00 separados para Ações/ETF em cada um de fevereiro, março e abril."""
    for month in (FEB, MAR, APR):
        separate(client, cash, classes["acoes_etfs"], 4_000, f"{month}-10")
    return cash


def separate(client, account_id, class_id, cents, on):
    response = client.post(
        f"{API}/accounts/{account_id}/reservations",
        json={"class_id": class_id, "amount_cents": cents, "date": on},
    )
    assert response.status_code == 201, response.text
    return response.json()


def buy(client, asset, cents, on, **body):
    response = client.post(
        f"{API}/purchases",
        json={"asset_id": asset["id"], "amount_cents": cents, "date": on, **body},
    )
    assert response.status_code == 201, response.text
    return response.json()


def summary(client, month):
    response = client.get(f"{API}/portfolio/month-summary", params={"month": month})
    assert response.status_code == 200, response.text
    return response.json()


def of_class(client, month, key="acoes_etfs"):
    [row] = [c for c in summary(client, month)["by_class"] if c["class_key"] == key]
    return row


def figures(row):
    return (
        row["amount_cents"],
        row["goal_cents"],
        row["reserved_cents"],
        row["from_reserved_cents"],
    )


def goal_total(body):
    return body["reserve_goal_cents"] + sum(c["goal_cents"] for c in body["by_class"])


# ---- o que foi separado conta no mês em que foi separado -------------------------------------


def test_the_separated_counts_in_the_goal_of_the_month_it_was_separated(
    client, three_months, stock
):
    for month in (FEB, MAR, APR):
        body = summary(client, month)
        assert figures(of_class(client, month)) == (4_000, 4_000, 4_000, 0)
        assert body["reserved_cents"] == 4_000
        assert body["total_cents"] == 4_000
        assert (body["registered_cents"], body["new_assets_cents"]) == (0, 0)
    assert figures(of_class(client, MAY)) == (0, 0, 0, 0)


def test_the_example_the_purchase_paid_with_the_separated_counts_zero_in_its_month(
    client, three_months, stock
):
    body = buy(client, stock, 10_000, "2026-05-10")
    assert (body["from_reserved_cents"], body["from_free_cents"]) == (10_000, 0)

    may = summary(client, MAY)
    assert figures(of_class(client, MAY)) == (0, 0, 0, 10_000)  # tirou os R$ 100 do amount_cents
    assert (may["total_cents"], may["registered_cents"], may["off_goal_cents"]) == (0, 0, 0)
    # Cada mês separado continua contando o que separou, mesmo depois de gasto (R$ 40, 40, e a
    # sobra de R$ 20 do último continua em aberto e dentro dos R$ 40 de abril).
    for month in (FEB, MAR, APR):
        assert figures(of_class(client, month)) == (4_000, 4_000, 4_000, 0)
    left = client.get(f"{API}/accounts/{three_months}/reservations").json()
    assert left["reserved_cents"] == 2_000


def test_a_purchase_bigger_than_the_separated_counts_only_what_came_from_free_cash(
    client, three_months, stock
):
    buy(client, stock, 15_000, "2026-05-10")  # R$ 120 separados + R$ 30 do caixa livre

    assert figures(of_class(client, MAY)) == (3_000, 3_000, 0, 12_000)
    may = summary(client, MAY)
    assert (may["total_cents"], may["registered_cents"]) == (3_000, 3_000)


def test_a_purchase_without_separated_keeps_counting_in_full(client, cash, stock):
    buy(client, stock, 10_000, "2026-05-10")

    assert figures(of_class(client, MAY)) == (10_000, 10_000, 0, 0)
    may = summary(client, MAY)
    assert (may["total_cents"], may["registered_cents"], may["reserved_cents"]) == (
        10_000,
        10_000,
        0,
    )


def test_a_separation_and_a_purchase_in_the_same_month_count_once(client, cash, classes, stock):
    separate(client, cash, classes["acoes_etfs"], 10_000, "2026-05-02")
    buy(client, stock, 10_000, "2026-05-10")

    assert figures(of_class(client, MAY)) == (10_000, 10_000, 10_000, 10_000)
    assert summary(client, MAY)["total_cents"] == 10_000


def test_an_off_goal_purchase_does_not_spend_the_separated_and_stays_out_of_the_goal(
    client, three_months, stock
):
    buy(client, stock, 10_000, "2026-05-10", off_goal=True)

    assert figures(of_class(client, MAY)) == (10_000, 0, 0, 0)
    may = summary(client, MAY)
    assert (may["off_goal_cents"], may["total_cents"]) == (10_000, 10_000)
    assert client.get(f"{API}/accounts/{three_months}/reservations").json()["reserved_cents"] == (
        12_000
    )


def test_releasing_the_separated_does_not_rewrite_the_month_it_was_separated(
    client, three_months, stock
):
    reservation = client.get(f"{API}/accounts/{three_months}/reservations").json()["reservations"][
        0
    ]
    released = client.post(
        f"{API}/cash/reservations/{reservation['id']}/release", json={"date": "2026-05-05"}
    )
    assert released.status_code == 200, released.text

    assert figures(of_class(client, FEB)) == (4_000, 4_000, 4_000, 0)
    assert figures(of_class(client, MAY)) == (0, 0, 0, 0)


def test_undoing_the_purchase_gives_the_separated_back_and_the_month_empties(
    client, three_months, stock
):
    buy(client, stock, 10_000, "2026-05-10")
    [purchase] = client.get(f"{API}/movements", params={"kind": "aporte"}).json()

    assert client.post(f"{API}/movements/{purchase['id']}/undo").status_code == 200

    assert figures(of_class(client, MAY)) == (0, 0, 0, 0)
    assert client.get(f"{API}/accounts/{three_months}/reservations").json()["reserved_cents"] == (
        12_000
    )


def test_the_month_summary_totals_stay_consistent(client, three_months, classes, make_asset, stock):
    reserve = make_asset(
        "Cofrinho", invested=100, current=100, purpose="reserva", valuation_date="2026-01-31"
    )
    separate(client, three_months, classes["acoes_etfs"], 6_000, "2026-05-02")
    buy(client, stock, 15_000, "2026-05-10")  # separado + caixa livre
    buy(client, stock, 2_500, "2026-05-12", off_goal=True)
    closing = client.post(
        f"{API}/assets/{reserve['id']}/balance",
        json={"date": "2026-05-20", "balance_cents": 3_100, "contribution_cents": 3_000},
    )
    assert closing.status_code == 200, closing.text
    closing = client.post(
        f"{API}/assets/{reserve['id']}/balance",
        json={
            "date": "2026-05-25",
            "balance_cents": 5_200,
            "contribution_cents": 2_000,
            "off_goal": True,
        },
    )
    assert closing.status_code == 200, closing.text

    for month in (FEB, MAR, APR, MAY, "2026-06"):
        body = summary(client, month)
        assert body["total_cents"] == goal_total(body) + body["off_goal_cents"], month
        assert body["total_cents"] == (
            body["registered_cents"] + body["new_assets_cents"] + body["reserved_cents"]
        ), month
        assert body["reserved_cents"] == sum(c["reserved_cents"] for c in body["by_class"])
        assert all(c["goal_cents"] <= c["amount_cents"] for c in body["by_class"])
    may = summary(client, MAY)
    assert (may["reserve_cents"], may["reserve_goal_cents"]) == (5_000, 3_000)
    assert may["off_goal_cents"] == 2_500 + 2_000


# ---- divisão do aporte ------------------------------------------------------------------------


@pytest.fixture
def plan(client):
    body = {
        "name": "Plano",
        "targets": [
            {"class_key": "renda_fixa", "percent_bps": 5_000},
            {"class_key": "renda_variavel", "percent_bps": 0},
            {"class_key": "acoes_etfs", "percent_bps": 5_000},
            {"class_key": "cripto", "percent_bps": 0},
        ],
    }
    created = client.post(f"{API}/allocation/plans", json=body)
    assert created.status_code == 201, created.text
    assert client.post(f"{API}/allocation/plans/{created.json()['id']}/activate").status_code == 200


def split(client, month=None):
    response = client.post(
        f"{API}/allocation/split",
        json={"amount_cents": 100_000, "mode": "rebalance", **({"month": month} if month else {})},
    )
    assert response.status_code == 200, response.text
    return {i["class_key"]: i for i in response.json()["items"]}


@pytest.fixture
def balanced(make_asset, stock):
    """Renda fixa e Ações/ETF com R$ 1.000,00 cada: o rebalanceamento divide meio a meio."""
    return make_asset("CDB", invested=100_000, current=100_000, valuation_date="2026-01-31")


def test_the_next_contribution_sees_the_separated_as_already_in_the_class(
    client, cash, classes, plan, balanced
):
    before = split(client)
    assert before["acoes_etfs"]["amount_cents"] == before["renda_fixa"]["amount_cents"] == 50_000

    separate(client, cash, classes["acoes_etfs"], 40_000, "2026-03-10")
    after = split(client)

    assert after["acoes_etfs"]["current_cents"] == 140_000  # R$ 1.000 investidos + R$ 400 separados
    assert after["renda_fixa"]["current_cents"] == 100_000
    # Carteira de R$ 3.400 depois do aporte: R$ 1.700 para cada, então Ações recebe só R$ 300.
    assert (after["acoes_etfs"]["amount_cents"], after["renda_fixa"]["amount_cents"]) == (
        30_000,
        70_000,
    )


def test_splitting_inside_the_month_of_the_separation_does_not_count_it_twice(
    client, cash, classes, plan, balanced
):
    before = split(client, "2026-03")

    separate(client, cash, classes["acoes_etfs"], 40_000, "2026-03-10")
    after = split(client, "2026-03")

    # O separado do mês sai da carteira antes do cálculo, como qualquer aporte do mês: salvar de
    # novo a divisão do mês dá o mesmo resultado.
    assert after == before


def test_splitting_after_a_purchase_with_the_separated_keeps_the_position_of_the_month(
    client, cash, classes, plan, balanced, stock
):
    separate(client, cash, classes["acoes_etfs"], 40_000, "2026-03-10")
    in_april = split(client, "2026-04")

    buy(client, stock, 40_000, "2026-04-10")  # o dinheiro separado vira ação
    after_purchase = split(client, "2026-04")

    # A compra paga com o separado não conta em abril (já contou em março): a posição de antes dos
    # aportes de abril é a mesma, com o dinheiro separado ou já investido.
    assert after_purchase == in_april
    assert after_purchase["acoes_etfs"]["current_cents"] == 140_000
    assert sum(i["amount_cents"] for i in after_purchase.values()) == 100_000


# ---- sequência de meses cumpridos e ritmo ------------------------------------------------------


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr("app.features.goals.service._today", lambda: dt.date(2026, 10, 17))


def plan_month(client, month, cents):
    response = client.put(
        f"{API}/contributions/{month}",
        json={"salary_cents": 1_000_000, "percent_bps": 1_000, "final_cents": cents},
    )
    assert response.status_code in (200, 201), response.text


def streak(client):
    return client.get(f"{API}/goals/progress").json()["streak"]


def test_the_separated_fulfils_the_plan_of_its_month_but_the_purchase_that_spends_it_does_not(
    client, cash, classes, stock
):
    for month in ("2026-07", "2026-08", "2026-09", "2026-10"):
        plan_month(client, month, 4_000)
    for month in ("2026-07", "2026-08", "2026-09"):
        separate(client, cash, classes["acoes_etfs"], 4_000, f"{month}-10")

    # Nenhum aporte lançado: só o separado cumpre julho, agosto e setembro.
    states = {m["month"]: m["state"] for m in streak(client)["months"]}
    assert states == {"2026-07": "met", "2026-08": "met", "2026-09": "met", "2026-10": "open"}

    buy(client, stock, 10_000, "2026-10-10")  # R$ 100 pagos com o separado dos meses anteriores

    after = streak(client)
    assert (after["current"], after["current_month_met"]) == (3, False)
    assert {m["month"]: m["state"] for m in after["months"]}["2026-10"] == "open"
    assert goal_total(summary(client, "2026-10")) == 0


def test_the_streak_agrees_with_the_month_plan_month_by_month(client, cash, classes, stock):
    for month in ("2026-07", "2026-08", "2026-09"):
        plan_month(client, month, 4_000)
    separate(client, cash, classes["acoes_etfs"], 4_000, "2026-07-10")
    separate(client, cash, classes["acoes_etfs"], 3_999, "2026-08-10")  # um centavo abaixo do plano
    separate(client, cash, classes["acoes_etfs"], 4_000, "2026-09-10")
    buy(client, stock, 3_000, "2026-09-20")  # paga com o separado de setembro: não soma de novo

    states = {m["month"]: m["state"] for m in streak(client)["months"]}

    for month, planned in (("2026-07", 4_000), ("2026-08", 4_000), ("2026-09", 4_000)):
        met = goal_total(summary(client, month)) >= planned
        assert (states[month] == "met") is met, month
    assert states == {
        "2026-07": "met",
        "2026-08": "missed",
        "2026-09": "met",
        "2026-10": "open",
    }


def test_a_purchase_with_free_cash_still_fulfils_the_plan(client, cash, stock):
    plan_month(client, "2026-09", 4_000)
    buy(client, stock, 4_000, "2026-09-10")

    assert {m["month"]: m["state"] for m in streak(client)["months"]}["2026-09"] == "met"


def test_the_pace_counts_the_separated_once_and_not_the_purchase_that_spends_it(
    client, cash, classes, stock
):
    separate(client, cash, classes["acoes_etfs"], 4_000, "2026-07-10")
    separate(client, cash, classes["acoes_etfs"], 4_000, "2026-08-10")
    buy(client, stock, 10_000, "2026-09-10")  # R$ 80 separados + R$ 20 do caixa livre

    pace = client.get(f"{API}/goals/progress").json()["contribution_pace"]

    window = {w["months"]: w for w in pace["windows"]}[3]
    assert pace["reference_month"] == "2026-09"
    assert (window["months_with_data"], window["average_cents"]) == (3, 3_333)  # 4000+4000+2000
