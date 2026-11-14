"""Patrimônio com o dinheiro separado para comprar: resumo da carteira, evolução e meta.

Cenário (datas relativas a hoje, valores em centavos): uma ação de R$ 1.000,00 e R$ 10.000,00 de
caixa. R$ 400,00 são separados para Ações/ETF, R$ 300,00 são gastos numa compra e R$ 40,00 são
liberados. A valorização da ação (R$ 160,00) é a mesma com ou sem o separado.
"""

import pytest
from cash_helpers import API, activate, day

START = 100_000  # a ação no primeiro ponto
SEPARATED = 40_000
PURCHASE = 30_000
RELEASED = 4_000
APPRECIATION = 16_000  # 10.000 + 2.000 + 3.000 + 1.000, dos saldos digitados
INVESTED = START + PURCHASE


@pytest.fixture
def account(client, institution):
    return client.get(f"{API}/accounts").json()[0]["id"]


@pytest.fixture
def classes(client):
    return {c["key"]: c["id"] for c in client.get(f"{API}/asset-classes").json()}


def balance(client, asset_id, on, cents):
    response = client.post(
        f"{API}/assets/{asset_id}/balance", json={"date": day(on), "balance_cents": cents}
    )
    assert response.status_code == 200, response.text


def run_scenario(client, make_asset, account, classes, *, separate):
    """Roda a história inteira; `separate` falso faz a mesma compra só com o caixa livre."""
    stock = make_asset(
        "Ação", class_key="acoes_etfs", invested=START, current=START, valuation_date=day(-100)
    )
    activate(client, account, 1_000_000, on=-120)
    balance(client, stock["id"], -60, 110_000)
    reservation = None
    if separate:
        response = client.post(
            f"{API}/accounts/{account}/reservations",
            json={
                "class_id": classes["acoes_etfs"],
                "amount_cents": SEPARATED,
                "date": day(-40),
            },
        )
        assert response.status_code == 201, response.text
        reservation = response.json()
    balance(client, stock["id"], -20, 112_000)
    response = client.post(
        f"{API}/purchases",
        json={"asset_id": stock["id"], "amount_cents": PURCHASE, "date": day(-10)},
    )
    assert response.status_code == 201, response.text
    balance(client, stock["id"], -5, 145_000)
    if separate:
        response = client.post(
            f"{API}/cash/reservations/{reservation['id']}/release",
            json={"amount_cents": RELEASED, "date": day(-3)},
        )
        assert response.status_code == 200, response.text
    balance(client, stock["id"], -1, 146_000)
    return stock


def evolution(client):
    return client.get(f"{API}/history/evolution").json()


def summary(client):
    return client.get(f"{API}/portfolio/summary").json()


# ---- regressão: o separado não mexe na rentabilidade nem na valorização --------------------


@pytest.mark.parametrize("separate", [False, True], ids=["sem_separado", "com_separado"])
def test_return_and_appreciation_do_not_change_with_reserved(
    client, make_asset, account, classes, separate
):
    run_scenario(client, make_asset, account, classes, separate=separate)

    body = summary(client)
    assert body["total_current_cents"] == 146_000
    assert body["total_invested_cents"] == INVESTED
    assert body["return_bps"] == 1231  # 160,00 sobre 1.300,00
    assert evolution(client)["summary"]["appreciation_cents"] == APPRECIATION


# ---- resumo da carteira --------------------------------------------------------------------


def test_summary_adds_the_open_reserved_to_net_worth_but_not_the_free_cash(
    client, make_asset, account, classes
):
    run_scenario(client, make_asset, account, classes, separate=True)

    body = summary(client)

    left = SEPARATED - PURCHASE - RELEASED
    assert body["reserved_cents"] == left == 6_000
    assert body["reserved_by_class"] == [{"class_key": "acoes_etfs", "reserved_cents": left}]
    assert body["net_worth_cents"] == body["total_current_cents"] + left
    # O caixa continua à parte: o total com caixa é o de antes, e o livre é o que sobra do separado.
    cash = 1_000_000 - PURCHASE
    assert body["cash_cents"] == cash
    assert body["free_cash_cents"] == cash - left
    assert body["total_with_cash_cents"] == body["total_current_cents"] + cash
    assert body["net_worth_cents"] < body["total_with_cash_cents"]


def test_summary_without_reserved_has_net_worth_equal_to_the_total(
    client, make_asset, account, classes
):
    run_scenario(client, make_asset, account, classes, separate=False)

    body = summary(client)

    assert body["reserved_cents"] == 0
    assert body["reserved_by_class"] == []
    assert body["net_worth_cents"] == body["total_current_cents"]
    assert body["free_cash_cents"] == body["cash_cents"] == 1_000_000 - PURCHASE


# ---- evolução ------------------------------------------------------------------------------


def test_evolution_shows_the_reserved_only_from_the_day_it_was_separated(
    client, make_asset, account, classes
):
    run_scenario(client, make_asset, account, classes, separate=True)

    points = {p["date"]: p for p in evolution(client)["points"]}

    before = points[day(-60)]  # a separação é de 40 dias atrás
    assert (before["reserved_cents"], before["reserved_by_class"]) == (0, {})
    assert before["net_worth_cents"] == before["total_cents"] == 110_000
    after = points[day(-20)]
    assert after["reserved_cents"] == SEPARATED
    assert after["reserved_by_class"] == {"acoes_etfs": SEPARATED}
    assert after["net_worth_cents"] == 112_000 + SEPARATED
    # O separado não entra nos valores dos ativos nem por categoria.
    assert after["total_cents"] == 112_000
    assert after["by_class"]["acoes_etfs"] == 112_000


def test_net_worth_is_assets_plus_reserved_in_every_point(client, make_asset, account, classes):
    run_scenario(client, make_asset, account, classes, separate=True)

    points = evolution(client)["points"]

    assert len(points) == 5
    for point in points:
        assert point["net_worth_cents"] == point["total_cents"] + point["reserved_cents"]
        assert sum(point["reserved_by_class"].values()) == point["reserved_cents"]


def test_purchase_with_reserved_is_not_counted_twice_in_net_worth(
    client, make_asset, account, classes
):
    run_scenario(client, make_asset, account, classes, separate=True)

    points = {p["date"]: p for p in evolution(client)["points"]}

    before, after = points[day(-20)], points[day(-5)]
    # Os R$ 300,00 saíram do separado e viraram valor da ação: só a valorização (R$ 30,00) sobra.
    assert before["reserved_cents"] - after["reserved_cents"] == PURCHASE
    assert after["total_cents"] - before["total_cents"] == PURCHASE + 3_000
    assert after["net_worth_cents"] - before["net_worth_cents"] == 3_000
    assert after["invested_cents"] - before["invested_cents"] == PURCHASE


def test_evolution_summary_counts_separations_and_leaves_the_purchase_out_of_the_contributions(
    client, make_asset, account, classes
):
    run_scenario(client, make_asset, account, classes, separate=True)

    body = evolution(client)["summary"]

    assert body["start_total_cents"] == START
    assert body["end_total_cents"] == 146_000 + (SEPARATED - PURCHASE - RELEASED)
    assert body["change_cents"] == body["end_total_cents"] - START
    # Aporte da compra (300) + separado (400) - o que a compra gastou do separado (300).
    assert body["contributions_cents"] == SEPARATED
    assert body["contributions_source"] == "diario"


def test_partial_release_is_a_withdrawal_and_not_a_loss(client, make_asset, account, classes):
    run_scenario(client, make_asset, account, classes, separate=True)

    body = evolution(client)["summary"]

    assert body["released_cents"] == RELEASED
    assert body["withdrawals_cents"] == 0
    # Sem somar a liberação de volta, a valorização apareceria R$ 40,00 menor.
    assert body["appreciation_cents"] == APPRECIATION
    assert (
        body["change_cents"]
        - body["contributions_cents"]
        + body["withdrawals_cents"]
        + body["released_cents"]
        + body["archived_out_cents"]
        == APPRECIATION
    )


def test_evolution_without_reserved_keeps_the_old_numbers(client, make_asset, account, classes):
    run_scenario(client, make_asset, account, classes, separate=False)

    body = evolution(client)

    assert all(p["reserved_cents"] == 0 for p in body["points"])
    assert all(p["net_worth_cents"] == p["total_cents"] for p in body["points"])
    assert body["summary"]["released_cents"] == 0
    assert body["summary"]["start_total_cents"] == START
    assert body["summary"]["end_total_cents"] == 146_000
    assert body["summary"]["contributions_cents"] == PURCHASE


# ---- meta de patrimônio --------------------------------------------------------------------


def test_net_worth_goal_progress_uses_the_net_worth(client, make_asset, account, classes):
    run_scenario(client, make_asset, account, classes, separate=True)

    settings = client.get(f"{API}/goals/settings").json()
    response = client.put(
        f"{API}/goals/settings", json=settings | {"net_worth_goal_cents": 304_000}
    )
    assert response.status_code == 200, response.text
    progress = client.get(f"{API}/goals/progress").json()["net_worth"]

    assert progress["current_cents"] == summary(client)["net_worth_cents"] == 152_000
    assert progress["progress_bps"] == 5_000
