"""Compra com o caixa gastando primeiro o dinheiro separado para a categoria."""

import pytest
from cash_helpers import API, activate, balance, capital, day, entries

from app.core.db import get_session
from app.features.cash.models import CashReservationUse
from app.features.portfolio.models import AssetMovement


@pytest.fixture
def account(client, institution):
    return client.get(f"{API}/accounts").json()[0]["id"]


@pytest.fixture
def classes(client):
    return {c["key"]: c["id"] for c in client.get(f"{API}/asset-classes").json()}


@pytest.fixture
def session(client):
    generator = client.app.dependency_overrides[get_session]()
    yield next(generator)
    generator.close()


@pytest.fixture
def stock(make_asset):
    """Ativo de Ações/ETF com histórico antigo, para aceitar compras e correções de data."""
    return make_asset(
        "Ação", class_key="acoes_etfs", invested=100_000, current=100_000, valuation_date=day(-100)
    )


@pytest.fixture
def separated(client, account, classes):
    """Caixa de R$ 10.000,00 e R$ 40,00 separados para Ações/ETF em três meses seguidos."""
    activate(client, account, 1_000_000, on=-120)
    for offset in (-90, -60, -30):
        separate(client, account, classes["acoes_etfs"], 4_000, date=day(offset))
    return account


def separate(client, account_id, class_id, cents, **body):
    response = client.post(
        f"{API}/accounts/{account_id}/reservations",
        json={"class_id": class_id, "amount_cents": cents, **body},
    )
    assert response.status_code == 201, response.text
    return response.json()


def buy(client, asset_id, cents, on=0, **body):
    return client.post(
        f"{API}/purchases",
        json={"asset_id": asset_id, "amount_cents": cents, "date": day(on), **body},
    )


def close_month(client, asset_id, **body):
    return client.post(f"{API}/assets/{asset_id}/balance", json=body)


def overview(client, account_id):
    response = client.get(
        f"{API}/accounts/{account_id}/reservations", params={"include_closed": True}
    )
    assert response.status_code == 200, response.text
    return response.json()


def slices(client, account_id):
    """(usado, restante) de cada separação, da mais antiga à mais nova."""
    rows = overview(client, account_id)["reservations"]
    return [(r["used_cents"], r["remaining_cents"]) for r in rows]


def cash_state(client, account_id):
    body = client.get(f"{API}/accounts/{account_id}").json()
    return body["balance_cents"], body["reserved_cents"], body["free_cents"]


def uses(session):
    session.expire_all()
    rows = session.query(CashReservationUse).order_by(CashReservationUse.id).all()
    return [(u.kind, u.amount_cents, u.date.isoformat()) for u in rows]


def asset_state(client, asset_id):
    body = client.get(f"{API}/assets/{asset_id}").json()
    return body["invested_cents"], body["current_cents"], body["gain_cents"]


def last_movement(client, asset_id):
    return next(m for m in client.get(f"{API}/movements").json() if m["asset_id"] == asset_id)


# ---- o exemplo e as variações de valor -----------------------------------------------------


def test_purchase_spends_the_oldest_separated_first_and_leaves_the_surplus_open(
    client, session, separated, stock
):
    response = buy(client, stock["id"], 10_000)  # 3 x R$ 40 separados, compra de R$ 100

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["from_reserved_cents"], body["from_free_cents"]) == (10_000, 0)
    assert body["reserved_left_cents"] == 2_000
    assert body["movement"]["from_reserved_cents"] == 10_000
    assert slices(client, separated) == [(4_000, 0), (4_000, 0), (2_000, 2_000)]
    assert uses(session) == [
        ("compra", 4_000, day()),
        ("compra", 4_000, day()),
        ("compra", 2_000, day()),
    ]
    # O caixa perdeu os R$ 100 e o separado que sobrou é R$ 20: o resto é caixa livre.
    assert cash_state(client, separated) == (990_000, 2_000, 988_000)


def test_smaller_purchase_spends_only_what_it_needs(client, separated, stock):
    body = buy(client, stock["id"], 3_000).json()

    assert (body["from_reserved_cents"], body["from_free_cents"]) == (3_000, 0)
    assert body["reserved_left_cents"] == 9_000
    assert slices(client, separated) == [(3_000, 1_000), (0, 4_000), (0, 4_000)]


def test_purchase_bigger_than_the_separated_takes_the_surplus_from_the_free_cash(
    client, separated, stock
):
    body = buy(client, stock["id"], 15_000).json()

    assert (body["from_reserved_cents"], body["from_free_cents"]) == (12_000, 3_000)
    assert body["reserved_left_cents"] == 0
    assert slices(client, separated) == [(4_000, 0)] * 3
    assert cash_state(client, separated) == (985_000, 0, 985_000)


def test_separated_money_only_changes_the_cash_never_the_wealth(
    client, separated, stock, make_asset
):
    """Comprar com o separado e comprar do caixa livre deixam a carteira exatamente igual."""
    plain = make_asset("CDB", invested=100_000, current=100_000, valuation_date=day(-100))
    before = client.get(f"{API}/portfolio/summary").json()

    assert buy(client, stock["id"], 10_000).status_code == 201
    assert buy(client, plain["id"], 10_000).status_code == 201

    assert (
        asset_state(client, stock["id"])
        == asset_state(client, plain["id"])
        == (
            110_000,
            110_000,
            0,
        )
    )
    after = client.get(f"{API}/portfolio/summary").json()
    assert after["total_invested_cents"] == before["total_invested_cents"] + 20_000
    assert after["total_current_cents"] == before["total_current_cents"] + 20_000
    assert after["return_bps"] == before["return_bps"]
    assert capital(client)["contributed_cents"] == 0  # nada de dinheiro novo


# ---- fechamento do mês com o caixa ---------------------------------------------------------


def test_closing_the_month_with_the_cash_also_spends_the_separated(client, separated, stock):
    response = close_month(
        client,
        stock["id"],
        date=day(),
        balance_cents=115_000,
        contribution_cents=15_000,
        use_cash=True,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["current_cents"] == 115_000  # a resposta continua sendo o ativo
    assert (body["from_reserved_cents"], body["from_free_cents"]) == (12_000, 3_000)
    assert body["reserved_left_cents"] == 0
    assert slices(client, separated) == [(4_000, 0)] * 3
    assert balance(client, separated) == 985_000


def test_default_contribution_is_new_money_and_leaves_the_separated_alone(
    client, session, separated, stock
):
    response = close_month(
        client, stock["id"], date=day(), balance_cents=110_000, contribution_cents=10_000
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["from_reserved_cents"], body["from_free_cents"]) == (None, None)
    assert slices(client, separated) == [(0, 4_000)] * 3
    assert uses(session) == []
    assert cash_state(client, separated) == (1_000_000, 12_000, 988_000)
    assert capital(client)["contributed_cents"] == 10_000


def test_closing_without_a_contribution_has_nothing_to_report(client, separated, stock):
    body = close_month(client, stock["id"], date=day(), balance_cents=101_000, use_cash=True).json()
    assert (body["from_reserved_cents"], body["reserved_left_cents"]) == (None, None)


# ---- o que não pode gastar o separado ------------------------------------------------------


def test_purchase_of_another_category_cannot_touch_the_separated(
    client, account, classes, make_asset
):
    activate(client, account, 100_000, on=-30)
    separate(client, account, classes["acoes_etfs"], 80_000)
    cdb = make_asset("CDB", invested=100_000, current=100_000)

    response = buy(client, cdb["id"], 50_000)

    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 30_000  # sobram R$ 200 de caixa livre
    assert cash_state(client, account) == (100_000, 80_000, 20_000)


def test_purchase_of_the_category_is_allowed_where_the_free_cash_alone_would_not_cover(
    client, account, classes, stock
):
    """A trava continua valendo, mas enxerga o separado que a compra gasta."""
    activate(client, account, 100_000, on=-30)
    separate(client, account, classes["acoes_etfs"], 80_000)

    response = buy(client, stock["id"], 50_000)

    assert response.status_code == 201, response.text
    assert cash_state(client, account) == (50_000, 30_000, 20_000)


def test_purchase_beyond_the_free_cash_and_the_separated_is_still_refused(
    client, session, account, classes, stock
):
    activate(client, account, 100_000, on=-30)
    separate(client, account, classes["acoes_etfs"], 80_000)
    separate(client, account, classes["cripto"], 15_000)

    # Os R$ 800 de ações cobrem parte dos R$ 900; os R$ 100 restantes só cabem comendo R$ 50 do que
    # está separado para cripto (o livre era R$ 50).
    response = buy(client, stock["id"], 90_000)

    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 5_000
    assert uses(session) == []
    assert cash_state(client, account) == (100_000, 95_000, 5_000)


def test_off_goal_purchase_is_paid_only_with_the_free_cash(client, session, separated, stock):
    body = buy(client, stock["id"], 10_000, off_goal=True).json()

    assert (body["from_reserved_cents"], body["from_free_cents"]) == (0, 10_000)
    assert body["reserved_left_cents"] == 12_000
    assert uses(session) == []
    assert cash_state(client, separated) == (990_000, 12_000, 978_000)


def test_off_goal_purchase_is_refused_when_only_the_separated_would_cover_it(
    client, account, classes, stock
):
    activate(client, account, 100_000, on=-30)
    separate(client, account, classes["acoes_etfs"], 80_000)

    response = buy(client, stock["id"], 50_000, off_goal=True)

    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 30_000
    assert "libere antes" in response.json()["detail"]


def test_emergency_reserve_assets_do_not_spend_the_separated(
    client, session, separated, make_asset
):
    reserve = make_asset(
        "Reserva",
        class_key="acoes_etfs",
        purpose="reserva",
        invested=100_000,
        current=100_000,
        valuation_date=day(-100),
    )

    body = buy(client, reserve["id"], 10_000).json()

    assert (body["from_reserved_cents"], body["from_free_cents"]) == (0, 10_000)
    assert uses(session) == []


# ---- desfazer ------------------------------------------------------------------------------


def test_undoing_the_purchase_gives_the_separated_back_exactly_as_it_was(
    client, session, separated, stock
):
    state_before = (cash_state(client, separated), slices(client, separated))
    purchase = buy(client, stock["id"], 10_000).json()

    response = client.post(f"{API}/movements/{purchase['movement']['id']}/undo")

    assert response.status_code == 200, response.text
    assert response.json()["from_reserved_cents"] == 10_000  # o que voltou a ficar separado
    assert (cash_state(client, separated), slices(client, separated)) == state_before
    assert uses(session) == []
    assert asset_state(client, stock["id"]) == (100_000, 100_000, 0)


def test_undoing_a_mixed_purchase_restores_the_cash_and_the_separated(
    client, session, separated, stock
):
    state_before = (cash_state(client, separated), slices(client, separated))
    purchase = buy(client, stock["id"], 15_000).json()  # R$ 120 do separado e R$ 30 do livre

    response = client.post(f"{API}/movements/{purchase['movement']['id']}/undo")

    assert response.status_code == 200, response.text
    assert response.json()["from_reserved_cents"] == 12_000
    assert (cash_state(client, separated), slices(client, separated)) == state_before
    assert uses(session) == []
    assert session.query(AssetMovement).count() == 0


def test_undoing_a_purchase_leaves_other_purchases_uses_alone(client, session, separated, stock):
    first = buy(client, stock["id"], 3_000, on=-5).json()["movement"]
    second = buy(client, stock["id"], 2_000, on=-1).json()["movement"]
    assert slices(client, separated) == [(4_000, 0), (1_000, 3_000), (0, 4_000)]

    assert client.post(f"{API}/movements/{first['id']}/undo").status_code == 200

    # A baixa da outra compra continua onde estava: só a primeira foi devolvida.
    assert uses(session) == [("compra", 1_000, day(-1)), ("compra", 1_000, day(-1))]
    assert slices(client, separated) == [(1_000, 3_000), (1_000, 3_000), (0, 4_000)]
    assert client.get(f"{API}/movements").json()[0]["id"] == second["id"]


# ---- corrigir valor, data e "fora da meta" -------------------------------------------------


def test_editing_the_amount_redoes_the_consumption(client, session, separated, stock):
    purchase = buy(client, stock["id"], 10_000).json()["movement"]

    smaller = client.patch(f"{API}/movements/{purchase['id']}", json={"amount_cents": 5_000})

    assert smaller.status_code == 200, smaller.text
    assert smaller.json()["from_reserved_cents"] == 5_000
    assert slices(client, separated) == [(4_000, 0), (1_000, 3_000), (0, 4_000)]
    assert uses(session) == [("compra", 4_000, day()), ("compra", 1_000, day())]

    bigger = client.patch(f"{API}/movements/{purchase['id']}", json={"amount_cents": 15_000})

    assert bigger.status_code == 200, bigger.text
    assert bigger.json()["from_reserved_cents"] == 12_000  # os R$ 30 restantes saem do livre
    assert slices(client, separated) == [(4_000, 0)] * 3
    assert cash_state(client, separated) == (985_000, 0, 985_000)
    assert [m for m in client.get(f"{API}/movements").json() if m["id"] == purchase["id"]][0][
        "from_reserved_cents"
    ] == 12_000


def test_editing_the_date_only_spends_what_was_separated_by_then(client, separated, stock):
    purchase = buy(client, stock["id"], 10_000, on=-10).json()["movement"]
    assert slices(client, separated) == [(4_000, 0), (4_000, 0), (2_000, 2_000)]

    response = client.patch(f"{API}/movements/{purchase['id']}", json={"date": day(-50)})

    assert response.status_code == 200, response.text
    # Em -50 só existiam as separações de -90 e -60: o resto da compra sai do caixa livre.
    assert response.json()["from_reserved_cents"] == 8_000
    assert slices(client, separated) == [(4_000, 0), (4_000, 0), (0, 4_000)]
    assert balance(client, separated) == 990_000


def test_edit_that_fails_midway_changes_nothing(client, session, account, classes, stock):
    activate(client, account, 20_000, on=-120)
    for offset in (-90, -60, -30):
        separate(client, account, classes["acoes_etfs"], 4_000, date=day(offset))
    purchase = buy(client, stock["id"], 10_000).json()["movement"]
    before = (uses(session), cash_state(client, account), asset_state(client, stock["id"]))

    # R$ 250 não cabem: o caixa só tem R$ 100 depois da compra. As baixas já tinham sido refeitas
    # dentro da operação, e a recusa tem de desfazer tudo.
    response = client.patch(f"{API}/movements/{purchase['id']}", json={"amount_cents": 25_000})

    assert response.status_code == 409, response.text
    assert (uses(session), cash_state(client, account), asset_state(client, stock["id"])) == before
    assert last_movement(client, stock["id"])["amount_cents"] == 10_000


def test_editing_a_new_money_contribution_does_not_start_spending_the_separated(
    client, session, separated, stock
):
    close_month(client, stock["id"], date=day(), balance_cents=110_000, contribution_cents=10_000)
    movement = last_movement(client, stock["id"])

    response = client.patch(f"{API}/movements/{movement['id']}", json={"amount_cents": 20_000})

    assert response.status_code == 200, response.text
    assert uses(session) == []
    assert slices(client, separated) == [(0, 4_000)] * 3


def test_marking_a_purchase_off_goal_gives_the_separated_back(client, session, separated, stock):
    purchase = buy(client, stock["id"], 10_000).json()["movement"]

    marked = client.patch(f"{API}/movements/{purchase['id']}", json={"off_goal": True})

    assert marked.status_code == 200, marked.text
    assert (marked.json()["off_goal"], marked.json()["from_reserved_cents"]) == (True, 0)
    assert uses(session) == []
    assert cash_state(client, separated) == (990_000, 12_000, 978_000)

    unmarked = client.patch(f"{API}/movements/{purchase['id']}", json={"off_goal": False})

    assert unmarked.json()["from_reserved_cents"] == 10_000
    assert slices(client, separated) == [(4_000, 0), (4_000, 0), (2_000, 2_000)]


# ---- travas --------------------------------------------------------------------------------


def test_failure_after_spending_the_separated_saves_nothing(
    client, session, account, classes, stock
):
    activate(client, account, 15_000, on=-30)
    separate(client, account, classes["acoes_etfs"], 12_000)

    # Gasta os R$ 120 separados, mas faltam R$ 50 no caixa: nada fica gravado.
    response = buy(client, stock["id"], 20_000)

    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 5_000
    assert uses(session) == []
    assert client.get(f"{API}/movements").json() == []
    assert asset_state(client, stock["id"]) == (100_000, 100_000, 0)
    assert len(entries(client, account)) == 1
    assert cash_state(client, account) == (15_000, 12_000, 3_000)


def test_closing_the_month_that_fails_midway_saves_nothing(
    client, session, account, classes, stock
):
    activate(client, account, 15_000, on=-30)
    separate(client, account, classes["acoes_etfs"], 12_000)

    response = close_month(
        client,
        stock["id"],
        date=day(),
        balance_cents=120_000,
        contribution_cents=20_000,
        use_cash=True,
    )

    assert response.status_code == 422
    assert uses(session) == []
    assert client.get(f"{API}/movements").json() == []
    assert asset_state(client, stock["id"]) == (100_000, 100_000, 0)


def test_purchase_older_than_a_recorded_use_that_would_overspend_is_refused(
    client, session, account, classes, stock, make_asset
):
    activate(client, account, 1_000_000, on=-120)
    separate(client, account, classes["acoes_etfs"], 4_000, date=day(-30))
    assert buy(client, stock["id"], 3_000, on=-1).status_code == 201
    other = make_asset(
        "Outra Ação",
        class_key="acoes_etfs",
        invested=100_000,
        current=100_000,
        valuation_date=day(-100),
    )

    # Em -2 a baixa de -1 ainda não existia, então a compra enxergaria os R$ 40 inteiros; somadas,
    # as duas passariam do que foi separado.
    response = buy(client, other["id"], 4_000, on=-2)

    assert response.status_code == 422
    assert "passa do que ainda está separado" in response.json()["detail"]
    assert uses(session) == [("compra", 3_000, day(-1))]
    assert asset_state(client, other["id"]) == (100_000, 100_000, 0)


# ---- arquivar a categoria ------------------------------------------------------------------


def _archive(client, class_id, archived=True):
    current = next(c for c in client.get(f"{API}/asset-classes").json() if c["id"] == class_id)
    return client.put(
        f"{API}/asset-classes/{class_id}",
        json={"name": current["name"], "color": current["color"], "archived": archived},
    )


def test_class_with_open_separated_money_cannot_be_archived(client, account, classes):
    activate(client, account, 100_000, on=-30)
    created = separate(client, account, classes["cripto"], 25_000)

    response = _archive(client, classes["cripto"])

    assert response.status_code == 409
    assert response.json()["reserved_cents"] == 25_000
    assert "R$ 250,00 separados" in response.json()["detail"]
    assert "libere esse dinheiro" in response.json()["detail"]

    released = client.post(f"{API}/cash/reservations/{created['id']}/release", json={})
    assert released.status_code == 200, released.text
    assert _archive(client, classes["cripto"]).status_code == 200


def test_class_with_only_closed_reservations_can_be_archived(client, account, classes):
    activate(client, account, 100_000, on=-30)
    created = separate(client, account, classes["cripto"], 25_000)
    client.post(f"{API}/cash/reservations/{created['id']}/release", json={"amount_cents": 25_000})

    assert _archive(client, classes["cripto"]).status_code == 200
