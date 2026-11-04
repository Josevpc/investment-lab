"""Compra com o caixa, fechamento do mês com caixa, proventos e desfazer/editar movimentos."""

import pytest
from cash_helpers import (
    API,
    activate,
    balance,
    capital,
    day,
    entries,
    new_account,
)


@pytest.fixture
def account(client, institution):
    return client.get(f"{API}/accounts").json()[0]["id"]


def purchase(client, asset_id, **body):
    return client.post(f"{API}/purchases", json={"asset_id": asset_id, **body})


def provento(client, asset_id, cents, on=0, **extra):
    response = client.post(
        f"{API}/proventos",
        json={"asset_id": asset_id, "amount_cents": cents, "date": day(on)} | extra,
    )
    assert response.status_code == 201, response.text
    return response.json()


def close_month(client, asset_id, **body):
    return client.post(f"{API}/assets/{asset_id}/balance", json=body)


def asset_state(client, asset_id):
    body = client.get(f"{API}/assets/{asset_id}").json()
    return body["invested_cents"], body["current_cents"]


def kinds(client, account_id):
    return [(e["kind"], e["amount_cents"]) for e in reversed(entries(client, account_id))]


def movements(client):
    return client.get(f"{API}/movements").json()


# ---- compra --------------------------------------------------------------------------------


def test_buying_one_share_with_the_cash_from_a_provento_empties_the_cash(
    client, account, make_asset
):
    fii = make_asset("FII", invested=50_000, current=50_000)
    activate(client, account, 600)
    provento(client, fii["id"], 200)
    assert balance(client, account) == 800

    response = purchase(client, fii["id"], date=day(), quantity="1", unit_price_cents=800)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["movement"]["kind"] == "aporte"
    assert body["movement"]["amount_cents"] == 800
    assert (body["account_id"], body["deposit_cents"], body["cash_balance_cents"]) == (
        account,
        0,
        0,
    )
    assert balance(client, account) == 0
    assert capital(client)["contributed_cents"] == 0  # o dinheiro já era da conta
    assert asset_state(client, fii["id"]) == (50_800, 50_800)
    assert kinds(client, account) == [("saldo_inicial", 600), ("provento", 200), ("compra", -800)]


def test_purchase_leaves_the_change_in_the_cash(client, account, make_asset):
    fii = make_asset("FII")
    activate(client, account, 800)
    assert purchase(client, fii["id"], amount_cents=785).status_code == 201
    assert balance(client, account) == 15


def test_purchase_by_quantity_rounds_half_up(client, account, make_asset):
    cota = make_asset("Cota")
    activate(client, account, 10_000)
    response = purchase(client, cota["id"], quantity="0.5", unit_price_cents=801)  # 400,5
    assert response.json()["movement"]["amount_cents"] == 401
    assert balance(client, account) == 9_599


def test_purchase_above_the_cash_is_refused_with_the_shortfall_and_saves_nothing(
    client, account, make_asset
):
    fii = make_asset("FII", invested=50_000, current=60_000)
    activate(client, account, 800)
    before = asset_state(client, fii["id"])

    response = purchase(client, fii["id"], date=day(2), amount_cents=1_000)

    assert response.status_code == 422
    body = response.json()
    assert body["shortfall_cents"] == 200
    assert "R$ 2,00" in body["detail"]
    assert asset_state(client, fii["id"]) == before
    assert movements(client) == []
    assert len(client.get(f"{API}/assets/{fii['id']}/valuations").json()) == 1  # sem linha órfã
    assert kinds(client, account) == [("saldo_inicial", 800)]


def test_purchase_with_an_explicit_deposit_records_both_and_capital_grows_by_the_deposit_only(
    client, account, make_asset
):
    fii = make_asset("FII", invested=50_000, current=50_000)
    activate(client, account, 800)

    too_little = purchase(client, fii["id"], amount_cents=1_000, deposit_cents=100)
    assert too_little.status_code == 422
    assert too_little.json()["shortfall_cents"] == 100
    assert kinds(client, account) == [("saldo_inicial", 800)]

    response = purchase(client, fii["id"], amount_cents=1_000, deposit_cents=200)

    assert response.status_code == 201, response.text
    assert response.json()["deposit_cents"] == 200
    assert kinds(client, account) == [
        ("saldo_inicial", 800),
        ("deposito", 200),
        ("compra", -1_000),
    ]
    assert balance(client, account) == 0
    assert capital(client)["contributed_cents"] == 200
    assert asset_state(client, fii["id"]) == (51_000, 51_000)


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"amount_cents": 100, "quantity": "1", "unit_price_cents": 100},
        {"quantity": "1"},
        {"unit_price_cents": 100},
        {"amount_cents": 0},
        {"amount_cents": -5},
        {"quantity": "abc", "unit_price_cents": 100},
        {"quantity": "-1", "unit_price_cents": 100},
        {"quantity": "NaN", "unit_price_cents": 100},
        {"quantity": "0.4", "unit_price_cents": 1},  # arredonda para R$ 0,00
        {"amount_cents": 100, "deposit_cents": 0},
    ],
)
def test_purchase_input_must_give_the_amount_one_way(client, account, make_asset, body):
    fii = make_asset("FII")
    activate(client, account, 10_000)
    assert purchase(client, fii["id"], **body).status_code == 422
    assert movements(client) == []


def test_purchase_needs_cash_activated_on_the_assets_account(client, account, make_asset):
    fii = make_asset("FII", invested=50_000, current=50_000)
    response = purchase(client, fii["id"], amount_cents=100)
    assert response.status_code == 422
    assert "caixa ativado" in response.json()["detail"]
    assert asset_state(client, fii["id"]) == (50_000, 50_000)
    assert movements(client) == []


def test_purchase_before_the_opening_or_the_last_valuation_is_refused(client, account, make_asset):
    fii = make_asset("FII", invested=50_000, current=50_000)  # valorização de hoje
    activate(client, account, 10_000, on=0)
    assert purchase(client, fii["id"], date=day(-1), amount_cents=100).status_code == 422
    assert movements(client) == []
    assert kinds(client, account) == [("saldo_inicial", 10_000)]


def test_purchase_is_counted_as_aporte_of_the_month(client, account, make_asset):
    fii = make_asset("FII")
    activate(client, account, 10_000)
    purchase(client, fii["id"], date=day(), amount_cents=3_000)
    month = day()[:7]
    summary = client.get(f"{API}/portfolio/month-summary", params={"month": month}).json()
    assert summary["total_cents"] == 3_000


def test_undoing_a_purchase_returns_the_money_and_restores_the_asset(client, account, make_asset):
    fii = make_asset("FII", invested=50_000, current=60_000)
    activate(client, account, 5_000)
    movement = purchase(client, fii["id"], date=day(3), amount_cents=2_000).json()["movement"]
    assert asset_state(client, fii["id"]) == (52_000, 62_000)
    assert balance(client, account, as_of=day(3)) == 3_000

    response = client.post(f"{API}/movements/{movement['id']}/undo")

    assert response.status_code == 200, response.text
    assert asset_state(client, fii["id"]) == (50_000, 60_000)  # inclusive a linha criada na compra
    assert balance(client, account, as_of=day(3)) == 5_000
    assert kinds(client, account) == [("saldo_inicial", 5_000)]
    assert movements_empty(client)


def movements_empty(client):
    return movements(client) == []


def test_undoing_a_purchase_keeps_an_explicit_deposit(client, account, make_asset):
    fii = make_asset("FII")
    activate(client, account, 0)
    movement = purchase(client, fii["id"], amount_cents=500, deposit_cents=500).json()["movement"]
    client.post(f"{API}/movements/{movement['id']}/undo")
    assert kinds(client, account) == [("saldo_inicial", 0), ("deposito", 500)]
    assert balance(client, account) == 500


def test_editing_a_purchase_changes_the_cash_entry_too(client, account, make_asset):
    fii = make_asset("FII", invested=50_000, current=50_000)
    activate(client, account, 5_000)
    movement = purchase(client, fii["id"], date=day(), amount_cents=2_000).json()["movement"]

    response = client.patch(f"{API}/movements/{movement['id']}", json={"amount_cents": 3_500})

    assert response.status_code == 200, response.text
    assert asset_state(client, fii["id"]) == (53_500, 53_500)
    assert kinds(client, account)[-1] == ("compra", -3_500)
    assert balance(client, account) == 1_500


def test_editing_a_purchase_above_the_cash_is_refused_and_changes_nothing(
    client, account, make_asset
):
    fii = make_asset("FII", invested=50_000, current=50_000)
    activate(client, account, 5_000)
    movement = purchase(client, fii["id"], date=day(), amount_cents=2_000).json()["movement"]

    response = client.patch(f"{API}/movements/{movement['id']}", json={"amount_cents": 6_000})

    assert response.status_code == 409
    assert response.json()["shortfall_cents"] == 1_000
    assert asset_state(client, fii["id"]) == (52_000, 52_000)
    assert kinds(client, account)[-1] == ("compra", -2_000)
    assert [m["amount_cents"] for m in movements(client)] == [2_000]


def test_purchase_entries_cannot_be_deleted_by_hand(client, account, make_asset):
    fii = make_asset("FII")
    activate(client, account, 5_000)
    purchase(client, fii["id"], amount_cents=2_000)
    bought = entries(client, account)[0]
    assert bought["kind"] == "compra" and bought["deletable"] is False
    assert client.delete(f"{API}/cash/entries/{bought['id']}").status_code == 409
    assert balance(client, account) == 3_000


# ---- fechamento do mês (record_balance) ----------------------------------------------------


def test_account_without_cash_closes_the_month_exactly_as_before(client, account, make_asset):
    cdb = make_asset("CDB", invested=100_000, current=100_000)
    response = close_month(
        client, cdb["id"], date=day(1), balance_cents=151_200, contribution_cents=50_000
    )
    assert response.status_code == 200
    assert asset_state(client, cdb["id"]) == (150_000, 151_200)
    assert entries(client, account) == []
    assert balance(client, account) == 0
    assert [m["amount_cents"] for m in movements(client)] == [50_000]


def test_new_money_by_default_records_a_deposit_and_the_purchase_together(
    client, account, make_asset
):
    cdb = make_asset("CDB", invested=100_000, current=100_000)
    activate(client, account, 7_000)

    response = close_month(
        client, cdb["id"], date=day(1), balance_cents=151_200, contribution_cents=50_000
    )

    assert response.status_code == 200, response.text
    assert asset_state(client, cdb["id"]) == (150_000, 151_200)
    assert kinds(client, account) == [
        ("saldo_inicial", 7_000),
        ("deposito", 50_000),
        ("compra", -50_000),
    ]
    assert balance(client, account, as_of=day(1)) == 7_000  # o caixa não mudou: o dinheiro era novo
    assert capital(client, as_of=day(1))["contributed_cents"] == 50_000


def test_use_cash_takes_the_contribution_from_the_cash(client, account, make_asset):
    cdb = make_asset("CDB", invested=100_000, current=100_000)
    activate(client, account, 80_000)

    response = close_month(
        client,
        cdb["id"],
        date=day(1),
        balance_cents=151_200,
        contribution_cents=50_000,
        use_cash=True,
    )

    assert response.status_code == 200, response.text
    assert kinds(client, account) == [("saldo_inicial", 80_000), ("compra", -50_000)]
    assert balance(client, account, as_of=day(1)) == 30_000
    assert capital(client)["contributed_cents"] == 0
    assert asset_state(client, cdb["id"]) == (150_000, 151_200)


def test_use_cash_above_the_cash_is_refused_and_the_close_is_not_saved(client, account, make_asset):
    cdb = make_asset("CDB", invested=100_000, current=100_000)
    activate(client, account, 20_000)

    response = close_month(
        client,
        cdb["id"],
        date=day(1),
        balance_cents=151_200,
        contribution_cents=50_000,
        use_cash=True,
    )

    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 30_000
    assert asset_state(client, cdb["id"]) == (100_000, 100_000)
    assert movements(client) == []
    assert len(client.get(f"{API}/assets/{cdb['id']}/valuations").json()) == 1
    assert kinds(client, account) == [("saldo_inicial", 20_000)]


def test_use_cash_on_an_account_without_cash_is_refused(client, account, make_asset):
    cdb = make_asset("CDB", invested=100_000, current=100_000)
    response = close_month(
        client,
        cdb["id"],
        date=day(1),
        balance_cents=150_000,
        contribution_cents=50_000,
        use_cash=True,
    )
    assert response.status_code == 422
    assert asset_state(client, cdb["id"]) == (100_000, 100_000)


def test_contribution_dated_before_the_opening_stays_out_of_the_ledger(client, account, make_asset):
    cdb = make_asset("CDB", invested=100_000, current=100_000, valuation_date=day(-20))
    activate(client, account, 7_000, on=0)  # caixa só a partir de hoje
    closing = {"balance_cents": 150_000, "contribution_cents": 50_000, "contribution_date": day(-5)}

    # O aporte é anterior ao corte: o histórico fica como era, fora do ledger.
    ok = close_month(client, cdb["id"], date=day(1), **closing)
    assert ok.status_code == 200, ok.text
    assert asset_state(client, cdb["id"]) == (150_000, 150_000)
    assert kinds(client, account) == [("saldo_inicial", 7_000)]

    # Usar o caixa para um aporte anterior ao saldo inicial não faz sentido: recusa e não grava.
    other = make_asset("Outro", invested=100_000, current=100_000, valuation_date=day(-20))
    refused = close_month(client, other["id"], date=day(1), use_cash=True, **closing)
    assert refused.status_code == 422
    assert "saldo inicial" in refused.json()["detail"]
    assert asset_state(client, other["id"]) == (100_000, 100_000)
    assert [m["asset_id"] for m in movements(client)] == [cdb["id"]]


def test_undoing_a_closing_contribution_removes_its_cash_entries(client, account, make_asset):
    cdb = make_asset("CDB", invested=100_000, current=100_000)
    activate(client, account, 7_000)
    close_month(client, cdb["id"], date=day(1), balance_cents=151_200, contribution_cents=50_000)
    movement = movements(client)[0]

    response = client.post(f"{API}/movements/{movement['id']}/undo")

    assert response.status_code == 200, response.text
    assert kinds(client, account) == [("saldo_inicial", 7_000)]
    assert capital(client)["contributed_cents"] == 0
    assert asset_state(client, cdb["id"]) == (100_000, 101_200)


def test_undoing_a_use_cash_contribution_returns_the_money(client, account, make_asset):
    cdb = make_asset("CDB", invested=100_000, current=100_000)
    activate(client, account, 80_000)
    close_month(
        client,
        cdb["id"],
        date=day(1),
        balance_cents=150_000,
        contribution_cents=50_000,
        use_cash=True,
    )
    client.post(f"{API}/movements/{movements(client)[0]['id']}/undo")
    assert balance(client, account) == 80_000


def test_editing_a_closing_contribution_moves_both_cash_entries(client, account, make_asset):
    cdb = make_asset("CDB", invested=100_000, current=100_000)
    activate(client, account, 7_000)
    close_month(client, cdb["id"], date=day(1), balance_cents=151_200, contribution_cents=50_000)
    movement = movements(client)[0]

    response = client.patch(f"{API}/movements/{movement['id']}", json={"amount_cents": 40_000})

    assert response.status_code == 200, response.text
    assert kinds(client, account) == [
        ("saldo_inicial", 7_000),
        ("deposito", 40_000),
        ("compra", -40_000),
    ]
    assert capital(client, as_of=day(1))["contributed_cents"] == 40_000


# ---- proventos -----------------------------------------------------------------------------


def test_provento_goes_to_the_cash_of_an_account_with_cash_activated(client, account, make_asset):
    fii = make_asset("FII")
    activate(client, account, 600)
    movement = provento(client, fii["id"], 200)
    assert balance(client, account) == 800
    assert kinds(client, account) == [("saldo_inicial", 600), ("provento", 200)]
    assert entries(client, account)[0]["movement_id"] == movement["id"]
    assert capital(client)["contributed_cents"] == 0


def test_provento_without_cash_or_before_the_opening_or_credited_leaves_the_ledger_alone(
    client, account, make_asset
):
    fii = make_asset("FII")
    other = make_asset("Conta Corretora")
    provento(client, fii["id"], 200)  # caixa não ativado
    activate(client, account, 600, on=0)
    provento(client, fii["id"], 300, on=-3)  # antes do saldo inicial
    provento(client, fii["id"], 400, on=1, credited_asset_id=other["id"])  # caminho antigo
    assert kinds(client, account) == [("saldo_inicial", 600)]
    assert balance(client, account) == 600


def test_deleting_a_provento_removes_its_cash_entry(client, account, make_asset):
    fii = make_asset("FII")
    activate(client, account, 600)
    movement = provento(client, fii["id"], 200)
    assert client.delete(f"{API}/movements/{movement['id']}").status_code == 204
    assert balance(client, account) == 600
    assert kinds(client, account) == [("saldo_inicial", 600)]


def test_provento_already_spent_cannot_be_removed_or_reduced(client, account, make_asset):
    fii = make_asset("FII")
    activate(client, account, 0)
    movement = provento(client, fii["id"], 200)
    purchase(client, fii["id"], amount_cents=200)

    for response in (
        client.delete(f"{API}/movements/{movement['id']}"),
        client.post(f"{API}/movements/{movement['id']}/undo"),
        client.patch(f"{API}/movements/{movement['id']}", json={"amount_cents": 100}),
    ):
        assert response.status_code == 409, response.text
        assert response.json()["shortfall_cents"] > 0
    assert balance(client, account) == 0
    assert [m["kind"] for m in movements(client)] == ["aporte", "provento"]


def test_editing_a_provento_changes_the_cash_entry(client, account, make_asset):
    fii = make_asset("FII")
    activate(client, account, 600)
    movement = provento(client, fii["id"], 200)
    response = client.patch(f"{API}/movements/{movement['id']}", json={"amount_cents": 250})
    assert response.status_code == 200
    assert balance(client, account) == 850


# ---- contas ---------------------------------------------------------------------------------


def test_asset_cannot_change_account_after_using_the_cash(client, institution, account, make_asset):
    fii = make_asset("FII")
    other = new_account(client, "Conta C", institution["id"])
    activate(client, account, 5_000)
    purchase(client, fii["id"], amount_cents=100)

    body = {
        "name": "FII",
        "class_key": "renda_fixa",
        "institution_id": institution["id"],
        "account_id": other["id"],
    }
    assert client.put(f"{API}/assets/{fii['id']}", json=body).status_code == 409
    # Sem uso do caixa, a troca é livre.
    free = make_asset("Livre")
    changed = client.put(f"{API}/assets/{free['id']}", json=body | {"name": "Livre"})
    assert changed.status_code == 200
    assert changed.json()["account_id"] == other["id"]
    # Editar sem informar a conta mantém a atual.
    kept = client.put(
        f"{API}/assets/{free['id']}", json={k: v for k, v in body.items() if k != "account_id"}
    )
    assert kept.json()["account_id"] == other["id"]
