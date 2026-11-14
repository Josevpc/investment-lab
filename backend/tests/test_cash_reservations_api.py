"""Dinheiro separado para comprar: API, travas do caixa e consumo na compra."""

from datetime import date
from types import SimpleNamespace

import pytest
from cash_helpers import API, activate, balance, capital, day, entries, new_account, post

from app.core.db import get_session
from app.core.errors import InvalidInputError
from app.features.cash import service
from app.features.cash.models import CashReservationUse
from app.features.portfolio.models import AssetMovement


@pytest.fixture
def account(client, institution):
    return client.get(f"{API}/accounts").json()[0]["id"]


@pytest.fixture
def classes(client):
    """Categorias iniciais por chave: renda_fixa, renda_variavel, acoes_etfs, cripto."""
    return {c["key"]: c["id"] for c in client.get(f"{API}/asset-classes").json()}


@pytest.fixture
def session(client):
    """Uma sessão no mesmo banco em memória do cliente, para chamar o service direto."""
    generator = client.app.dependency_overrides[get_session]()
    yield next(generator)
    generator.close()


def separate(client, account_id, class_id, cents, **body):
    return client.post(
        f"{API}/accounts/{account_id}/reservations",
        json={"class_id": class_id, "amount_cents": cents, **body},
    )


def release(client, reservation_id, **body):
    return client.post(f"{API}/cash/reservations/{reservation_id}/release", json=body)


def overview(client, account_id, **params):
    response = client.get(f"{API}/accounts/{account_id}/reservations", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def account_state(client, account_id):
    body = client.get(f"{API}/accounts/{account_id}").json()
    assert body["balance_cents"] == body["reserved_cents"] + body["free_cents"]
    return body["balance_cents"], body["reserved_cents"], body["free_cents"]


def withdraw(client, account_id, cents, on=0):
    return post(client, account_id, "withdrawals", date=day(on), amount_cents=cents)


@pytest.fixture
def funded(client, account):
    """Conta com R$ 1.000,00 de caixa desde 30 dias atrás."""
    activate(client, account, 100_000)
    return account


# ---- separar -------------------------------------------------------------------------------


def test_separating_does_not_move_the_balance_only_splits_it(client, funded, classes):
    response = separate(client, funded, classes["acoes_etfs"], 40_000, date=day(-10))

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["class_id"] == classes["acoes_etfs"]
    assert body["class_name"] == "Ações/ETF"
    assert body["date"] == day(-10)
    assert (body["amount_cents"], body["used_cents"], body["released_cents"]) == (40_000, 0, 0)
    assert (body["remaining_cents"], body["deletable"]) == (40_000, True)
    assert (body["balance_cents"], body["reserved_cents"], body["free_cents"]) == (
        100_000,
        40_000,
        60_000,
    )
    assert balance(client, funded) == 100_000
    assert len(entries(client, funded)) == 1  # só o saldo inicial: nada foi lançado no extrato
    assert capital(client)["contributed_cents"] == 0


def test_separated_cash_shows_up_in_every_cash_view(client, funded, classes):
    separate(client, funded, classes["cripto"], 25_000)

    assert account_state(client, funded) == (100_000, 25_000, 75_000)
    listed = next(a for a in client.get(f"{API}/accounts").json() if a["id"] == funded)
    assert (listed["reserved_cents"], listed["free_cents"]) == (25_000, 75_000)
    one = client.get(f"{API}/accounts/{funded}/balance").json()
    assert (one["balance_cents"], one["reserved_cents"], one["free_cents"]) == (
        100_000,
        25_000,
        75_000,
    )
    consolidated = client.get(f"{API}/cash/balance").json()
    assert consolidated["total_cents"] == 100_000
    row = next(a for a in consolidated["accounts"] if a["account_id"] == funded)
    assert (row["reserved_cents"], row["free_cents"]) == (25_000, 75_000)
    # Olhando para trás, antes da separação, nada estava separado.
    before = client.get(f"{API}/accounts/{funded}/balance", params={"as_of": day(-1)}).json()
    assert (before["reserved_cents"], before["free_cents"]) == (0, 100_000)


def test_account_without_reservations_has_everything_free(client, funded):
    assert account_state(client, funded) == (100_000, 0, 100_000)
    assert overview(client, funded) == {
        "reserved_cents": 0,
        "free_cents": 100_000,
        "by_class": [],
        "reservations": [],
    }


def test_separating_with_deposit_records_a_plain_deposit_and_keeps_the_free_cash(
    client, funded, classes
):
    response = separate(client, funded, classes["acoes_etfs"], 30_000, deposit=True, date=day(-2))

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["balance_cents"], body["reserved_cents"], body["free_cents"]) == (
        130_000,
        30_000,
        100_000,
    )
    deposit = entries(client, funded)[0]
    assert (deposit["kind"], deposit["amount_cents"], deposit["date"]) == (
        "deposito",
        30_000,
        day(-2),
    )
    assert deposit["asset_id"] is None and deposit["movement_id"] is None  # avulso
    assert capital(client)["contributed_cents"] == 30_000


def test_separating_with_deposit_also_works_when_the_free_cash_is_not_enough(
    client, account, classes
):
    activate(client, account, 1_000)

    response = separate(client, account, classes["renda_fixa"], 50_000, deposit=True)

    assert response.status_code == 201, response.text
    assert account_state(client, account) == (51_000, 50_000, 1_000)


def test_separating_more_than_the_free_cash_is_refused_with_the_shortfall(client, funded, classes):
    separate(client, funded, classes["acoes_etfs"], 70_000)

    response = separate(client, funded, classes["cripto"], 50_000)

    assert response.status_code == 422
    body = response.json()
    assert body["shortfall_cents"] == 20_000
    assert "R$ 200,00" in body["detail"] and "Depositar agora e separar" in body["detail"]
    assert overview(client, funded)["reserved_cents"] == 70_000  # nada novo foi gravado


def test_separating_exactly_the_free_cash_is_allowed(client, funded, classes):
    assert separate(client, funded, classes["acoes_etfs"], 100_000).status_code == 201
    assert account_state(client, funded) == (100_000, 100_000, 0)


def test_separation_is_checked_against_later_withdrawals(client, funded, classes):
    withdraw(client, funded, 80_000, on=-1)  # o caixa cai a R$ 200 antes de hoje

    response = separate(client, funded, classes["acoes_etfs"], 50_000, date=day(-10))

    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 30_000


# ---- separar: erros do contrato ------------------------------------------------------------


def test_unknown_class_is_refused(client, funded):
    response = separate(client, funded, 9999, 1_000)
    assert response.status_code == 422
    assert "Categoria não encontrada" in response.json()["detail"]


def test_archived_class_is_refused(client, funded, classes):
    cripto = next(c for c in client.get(f"{API}/asset-classes").json() if c["key"] == "cripto")
    archived = client.put(
        f"{API}/asset-classes/{cripto['id']}",
        json={"name": cripto["name"], "color": cripto["color"], "archived": True},
    )
    assert archived.status_code == 200, archived.text
    response = separate(client, funded, classes["cripto"], 1_000)
    assert response.status_code == 422
    assert "arquivada" in response.json()["detail"]


def test_emergency_reserve_class_is_refused(client, funded, classes, make_asset):
    make_asset("Reserva", class_key="cripto", purpose="reserva")
    response = separate(client, funded, classes["cripto"], 1_000)
    assert response.status_code == 422
    assert "reserva de emergência" in response.json()["detail"]


def test_class_with_all_assets_held_is_refused(client, funded, classes, make_asset):
    make_asset("Mantido", class_key="cripto", hold_only=True)
    response = separate(client, funded, classes["cripto"], 1_000)
    assert response.status_code == 422
    assert "manter posição" in response.json()["detail"]


def test_class_with_some_assets_held_is_accepted(client, funded, classes, make_asset):
    make_asset("Mantido", class_key="cripto", hold_only=True)
    make_asset("Recebe", class_key="cripto")
    assert separate(client, funded, classes["cripto"], 1_000).status_code == 201


def test_class_with_a_reserve_asset_and_a_regular_one_is_accepted(
    client, funded, classes, make_asset
):
    make_asset("Reserva", class_key="renda_fixa", purpose="reserva")
    make_asset("CDB", class_key="renda_fixa")
    assert separate(client, funded, classes["renda_fixa"], 1_000).status_code == 201


def test_account_without_cash_is_refused_with_guidance(client, account, classes):
    response = separate(client, account, classes["cripto"], 1_000)
    assert response.status_code == 422
    assert "ainda não tem caixa ativado" in response.json()["detail"]


def test_date_before_the_opening_balance_is_refused(client, funded, classes):
    response = separate(client, funded, classes["cripto"], 1_000, date=day(-31))
    assert response.status_code == 422
    assert "só tem caixa a partir de" in response.json()["detail"]


def test_future_date_is_refused(client, funded, classes):
    response = separate(client, funded, classes["cripto"], 1_000, date=day(1))
    assert response.status_code == 422
    assert "futuro" in response.json()["detail"]


@pytest.mark.parametrize("cents", [0, -5])
def test_amount_must_be_positive(client, funded, classes, cents):
    assert separate(client, funded, classes["cripto"], cents).status_code == 422


def test_unknown_account_is_404(client, classes):
    assert separate(client, 9999, classes["cripto"], 1_000).status_code == 404
    assert client.get(f"{API}/accounts/9999/reservations").status_code == 404


# ---- listar --------------------------------------------------------------------------------


def test_overview_groups_the_remaining_by_class_and_lists_oldest_first(client, funded, classes):
    separate(client, funded, classes["acoes_etfs"], 10_000, date=day(-5))
    separate(client, funded, classes["cripto"], 20_000, date=day(-9))
    separate(client, funded, classes["acoes_etfs"], 5_000, date=day(-1))

    body = overview(client, funded)

    assert (body["reserved_cents"], body["free_cents"]) == (35_000, 65_000)
    assert [(c["class_name"], c["remaining_cents"]) for c in body["by_class"]] == [
        ("Ações/ETF", 15_000),
        ("Criptomoedas", 20_000),
    ]
    assert all(c["color"].startswith("#") for c in body["by_class"])
    assert [r["amount_cents"] for r in body["reservations"]] == [20_000, 10_000, 5_000]


def test_closed_reservations_only_come_with_include_closed(client, funded, classes):
    done = separate(client, funded, classes["cripto"], 8_000).json()
    separate(client, funded, classes["cripto"], 2_000)
    release(client, done["id"])

    assert [r["amount_cents"] for r in overview(client, funded)["reservations"]] == [2_000]
    everything = overview(client, funded, include_closed=True)["reservations"]
    assert [r["amount_cents"] for r in everything] == [8_000, 2_000]
    assert everything[0]["remaining_cents"] == 0


# ---- liberar -------------------------------------------------------------------------------


def test_partial_release_returns_cash_to_free_and_keeps_the_original_untouched(
    client, funded, classes
):
    created = separate(client, funded, classes["acoes_etfs"], 40_000, date=day(-10)).json()

    response = release(client, created["id"], amount_cents=15_000)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["amount_cents"], body["date"]) == (40_000, day(-10))  # o mês de origem fica
    assert (body["released_cents"], body["used_cents"], body["remaining_cents"]) == (
        15_000,
        0,
        25_000,
    )
    assert body["deletable"] is False
    assert (body["balance_cents"], body["reserved_cents"], body["free_cents"]) == (
        100_000,
        25_000,
        75_000,
    )


def test_release_without_amount_frees_everything_that_is_left(client, funded, classes):
    created = separate(client, funded, classes["acoes_etfs"], 40_000).json()
    release(client, created["id"], amount_cents=10_000)

    body = release(client, created["id"]).json()

    assert (body["released_cents"], body["remaining_cents"]) == (40_000, 0)
    assert (body["reserved_cents"], body["free_cents"]) == (0, 100_000)
    assert overview(client, funded)["by_class"] == []


def test_release_is_a_separate_record_of_kind_liberacao(client, session, funded, classes):
    created = separate(client, funded, classes["acoes_etfs"], 40_000, date=day(-3)).json()
    release(client, created["id"], amount_cents=5_000, date=day(-1))

    [use] = session.query(CashReservationUse).all()
    assert (use.reservation_id, use.kind, use.amount_cents, use.movement_id) == (
        created["id"],
        "liberacao",
        5_000,
        None,
    )
    assert use.date.isoformat() == day(-1)


def test_release_above_the_remaining_is_refused(client, funded, classes):
    created = separate(client, funded, classes["acoes_etfs"], 40_000).json()
    release(client, created["id"], amount_cents=30_000)

    response = release(client, created["id"], amount_cents=10_001)

    assert response.status_code == 422
    assert response.json()["remaining_cents"] == 10_000
    assert "R$ 100,00" in response.json()["detail"]
    assert overview(client, funded)["reserved_cents"] == 10_000


def test_release_of_a_closed_reservation_is_refused(client, funded, classes):
    created = separate(client, funded, classes["acoes_etfs"], 1_000).json()
    release(client, created["id"])

    for body in ({}, {"amount_cents": 1}):
        response = release(client, created["id"], **body)
        assert response.status_code == 422
        assert "por inteiro" in response.json()["detail"]


def test_release_before_the_reservation_date_is_refused(client, funded, classes):
    created = separate(client, funded, classes["acoes_etfs"], 1_000, date=day(-5)).json()
    response = release(client, created["id"], date=day(-6))
    assert response.status_code == 422
    assert "anterior à separação" in response.json()["detail"]
    assert overview(client, funded)["reserved_cents"] == 1_000


def test_release_in_the_future_is_refused(client, funded, classes):
    created = separate(client, funded, classes["acoes_etfs"], 1_000).json()
    assert release(client, created["id"], date=day(1)).status_code == 422


@pytest.mark.parametrize("cents", [0, -1])
def test_release_amount_must_be_positive(client, funded, classes, cents):
    created = separate(client, funded, classes["acoes_etfs"], 1_000).json()
    assert release(client, created["id"], amount_cents=cents).status_code == 422


def test_release_of_unknown_reservation_is_404(client):
    assert release(client, 9999).status_code == 404


def test_released_cash_can_be_spent_again(client, funded, classes):
    created = separate(client, funded, classes["acoes_etfs"], 100_000).json()
    assert withdraw(client, funded, 10_000).status_code == 422
    release(client, created["id"], amount_cents=10_000)
    assert withdraw(client, funded, 10_000).status_code == 201


# ---- excluir -------------------------------------------------------------------------------


def test_reservation_without_use_can_be_deleted(client, funded, classes):
    created = separate(client, funded, classes["acoes_etfs"], 40_000).json()

    assert client.delete(f"{API}/cash/reservations/{created['id']}").status_code == 204

    assert overview(client, funded, include_closed=True)["reservations"] == []
    assert account_state(client, funded) == (100_000, 0, 100_000)


def test_reservation_with_a_release_cannot_be_deleted(client, funded, classes):
    created = separate(client, funded, classes["acoes_etfs"], 40_000).json()
    release(client, created["id"], amount_cents=1_000)

    response = client.delete(f"{API}/cash/reservations/{created['id']}")

    assert response.status_code == 409
    assert "libere o restante" in response.json()["detail"]
    assert overview(client, funded)["reserved_cents"] == 39_000


def test_deleting_unknown_reservation_is_404(client):
    assert client.delete(f"{API}/cash/reservations/9999").status_code == 404


# ---- o caixa nunca deixa o livre negativo --------------------------------------------------


def test_new_entry_that_eats_into_the_separated_is_refused_with_422(client, funded, classes):
    separate(client, funded, classes["acoes_etfs"], 40_000)

    assert withdraw(client, funded, 60_000).status_code == 201  # o livre inteiro, pode
    response = withdraw(client, funded, 1)

    assert response.status_code == 422
    body = response.json()
    assert body["shortfall_cents"] == 1
    assert "R$ 0,01 está separado para Ações/ETF; libere antes" in body["detail"]


@pytest.mark.parametrize("path", ["withdrawals", "fees"])
def test_withdrawals_and_fees_respect_the_separated(client, funded, classes, path):
    separate(client, funded, classes["acoes_etfs"], 90_000)
    response = post(client, funded, path, date=day(), amount_cents=20_000)
    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 10_000


def test_negative_adjustment_respects_the_separated(client, funded, classes):
    separate(client, funded, classes["acoes_etfs"], 90_000)
    response = post(client, funded, "adjustments", date=day(), amount_cents=-20_000)
    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 10_000


def test_reconciliation_adjustment_respects_the_separated(client, funded, classes):
    separate(client, funded, classes["acoes_etfs"], 90_000)

    response = post(client, funded, "reconcile/adjustment", real_cents=50_000, confirm=True)

    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 40_000
    assert balance(client, funded) == 100_000


def test_transfer_out_of_separated_cash_is_refused_and_saves_nothing(
    client, institution, funded, classes
):
    other = new_account(client, "Outra Conta", institution["id"])["id"]
    activate(client, other, 0)
    separate(client, funded, classes["acoes_etfs"], 80_000)

    response = client.post(
        f"{API}/cash/transfers",
        json={"from_account_id": funded, "to_account_id": other, "amount_cents": 30_000},
    )

    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 10_000
    assert (balance(client, funded), balance(client, other)) == (100_000, 0)


def test_transfer_of_the_free_part_is_allowed(client, institution, funded, classes):
    other = new_account(client, "Outra Conta", institution["id"])["id"]
    activate(client, other, 0)
    separate(client, funded, classes["acoes_etfs"], 80_000)

    response = client.post(
        f"{API}/cash/transfers",
        json={"from_account_id": funded, "to_account_id": other, "amount_cents": 20_000},
    )

    assert response.status_code == 201, response.text
    assert account_state(client, funded) == (80_000, 80_000, 0)


def test_reservation_is_per_account(client, institution, funded, classes):
    other = new_account(client, "Outra Conta", institution["id"])["id"]
    activate(client, other, 50_000)
    separate(client, funded, classes["acoes_etfs"], 100_000)

    assert withdraw(client, other, 50_000).status_code == 201  # o separado é da outra conta


def test_removing_an_entry_that_funds_the_separated_is_refused_with_409(client, funded, classes):
    deposit = post(client, funded, "deposits", date=day(-5), amount_cents=20_000).json()
    separate(client, funded, classes["acoes_etfs"], 110_000)

    response = client.delete(f"{API}/cash/entries/{deposit['id']}")

    assert response.status_code == 409
    body = response.json()
    assert body["shortfall_cents"] == 10_000
    assert "R$ 100,00 está separado para Ações/ETF; libere antes" in body["detail"]
    assert balance(client, funded) == 120_000


def test_removal_is_allowed_once_the_separated_is_released(client, funded, classes):
    deposit = post(client, funded, "deposits", date=day(-5), amount_cents=20_000).json()
    created = separate(client, funded, classes["acoes_etfs"], 110_000).json()
    release(client, created["id"], amount_cents=10_000)

    assert client.delete(f"{API}/cash/entries/{deposit['id']}").status_code == 204


def test_message_names_every_category_that_holds_cash(client, funded, classes):
    separate(client, funded, classes["cripto"], 30_000)
    separate(client, funded, classes["acoes_etfs"], 30_000)
    separate(client, funded, classes["renda_fixa"], 30_000)

    detail = withdraw(client, funded, 20_000).json()["detail"]

    assert "Ações/ETF, Criptomoedas e Renda Fixa" in detail


def test_changing_a_movement_into_separated_cash_is_refused_with_409(
    client, funded, classes, make_asset
):
    cdb = make_asset("CDB", invested=100_000, current=100_000)
    client.post(
        f"{API}/assets/{cdb['id']}/balance",
        json={
            "date": day(1),
            "balance_cents": 150_000,
            "contribution_cents": 50_000,
            "use_cash": True,
        },
    )
    separate(client, funded, classes["acoes_etfs"], 30_000)  # sobram R$ 200 de caixa livre
    movement = client.get(f"{API}/movements").json()[0]

    response = client.patch(f"{API}/movements/{movement['id']}", json={"amount_cents": 80_000})

    assert response.status_code == 409, response.text
    assert response.json()["shortfall_cents"] == 10_000
    assert "R$ 100,00 está separado para Ações/ETF; libere antes" in response.json()["detail"]
    assert balance(client, funded, as_of=day(1)) == 50_000


def test_use_cash_purchase_of_another_category_cannot_touch_the_separated(
    client, funded, classes, make_asset
):
    """O separado é da categoria: o CDB (renda fixa) não gasta o de Ações/ETF, e a trava recusa."""
    cdb = make_asset("CDB", invested=100_000, current=100_000)
    separate(client, funded, classes["acoes_etfs"], 80_000)

    response = client.post(
        f"{API}/assets/{cdb['id']}/balance",
        json={
            "date": day(),
            "balance_cents": 150_000,
            "contribution_cents": 50_000,
            "use_cash": True,
        },
    )

    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 30_000
    assert balance(client, funded) == 100_000


# ---- consumo do separado (a ligação com as compras está em test_cash_reservation_purchase) -


@pytest.fixture
def purchase_movement(client, session, institution, make_asset):
    """Cria um aporte de verdade e devolve uma função que o relê datado.

    O ativo fica numa conta sem caixa ativado, para o aporte não lançar nada no caixa da conta que
    separa o dinheiro.
    """
    no_cash = new_account(client, "Sem Caixa", institution["id"])["id"]

    def _make(on, cents):
        asset = make_asset(
            f"Ativo {on}",
            invested=100_000,
            current=100_000,
            account_id=no_cash,
            valuation_date=day(-90),
        )
        client.post(
            f"{API}/assets/{asset['id']}/balance",
            json={"date": day(on), "balance_cents": 100_000 + cents, "contribution_cents": cents},
        )
        movement = next(
            m for m in client.get(f"{API}/movements").json() if m["asset_id"] == asset["id"]
        )
        return session.get(AssetMovement, movement["id"])

    return _make


def three_months_of_40(client, account, class_id):
    activate(client, account, 1_000_000, on=-60)
    for offset in (-30, -20, -10):
        separate(client, account, class_id, 4_000, date=day(offset))


def test_purchase_eats_the_oldest_reservations_first_and_leaves_the_rest_open(
    client, session, account, classes, purchase_movement
):
    three_months_of_40(client, account, classes["acoes_etfs"])
    movement = purchase_movement(-1, 10_000)

    consumed = service.stage_consume_reservations(session, account, classes["acoes_etfs"], movement)
    session.commit()

    assert consumed == 10_000
    listed = overview(client, account, include_closed=True)["reservations"]
    assert [(r["used_cents"], r["remaining_cents"]) for r in listed] == [
        (4_000, 0),
        (4_000, 0),
        (2_000, 2_000),
    ]
    assert overview(client, account)["by_class"][0]["remaining_cents"] == 2_000
    uses = session.query(CashReservationUse).order_by(CashReservationUse.id).all()
    assert [(u.kind, u.amount_cents, u.movement_id, u.date.isoformat()) for u in uses] == [
        ("compra", 4_000, movement.id, day(-1)),
        ("compra", 4_000, movement.id, day(-1)),
        ("compra", 2_000, movement.id, day(-1)),
    ]
    assert listed[0]["deletable"] is False  # a separação consumida não se exclui mais


def test_purchase_bigger_than_the_separated_takes_only_what_is_separated(
    client, session, account, classes, purchase_movement
):
    three_months_of_40(client, account, classes["acoes_etfs"])

    consumed = service.stage_consume_reservations(
        session, account, classes["acoes_etfs"], purchase_movement(-1, 15_000)
    )

    assert consumed == 12_000  # os R$ 30 que faltam saem do caixa livre
    assert sum(r["remaining_cents"] for r in overview(client, account)["reservations"]) == 0


def test_purchase_only_touches_the_reservations_of_its_own_class_and_account(
    client, session, institution, account, classes, purchase_movement
):
    activate(client, account, 1_000_000, on=-60)
    separate(client, account, classes["cripto"], 5_000, date=day(-20))
    other = new_account(client, "Outra Conta", institution["id"])["id"]
    activate(client, other, 100_000, on=-60)
    separate(client, other, classes["acoes_etfs"], 5_000, date=day(-20))

    consumed = service.stage_consume_reservations(
        session, account, classes["acoes_etfs"], purchase_movement(-1, 3_000)
    )

    assert consumed == 0
    assert overview(client, account)["reserved_cents"] == 5_000
    assert overview(client, other)["reserved_cents"] == 5_000
    assert session.query(CashReservationUse).count() == 0


def test_backdated_purchase_ignores_reservations_made_after_it(
    client, session, account, classes, purchase_movement
):
    three_months_of_40(client, account, classes["acoes_etfs"])  # dias -30, -20 e -10

    consumed = service.stage_consume_reservations(
        session, account, classes["acoes_etfs"], purchase_movement(-25, 10_000)
    )

    assert consumed == 4_000  # só a de 30 dias atrás já existia
    listed = overview(client, account)["reservations"]
    assert [r["date"] for r in listed] == [day(-20), day(-10)]


def test_consuming_never_uses_more_than_a_reservation_holds(
    client, session, account, classes, purchase_movement
):
    activate(client, account, 1_000_000, on=-60)
    separate(client, account, classes["acoes_etfs"], 4_000, date=day(-30))
    first = purchase_movement(-1, 3_000)
    assert (
        service.stage_consume_reservations(session, account, classes["acoes_etfs"], first) == 3_000
    )
    session.commit()

    # Uma compra mais antiga que a baixa já gravada enxergaria os R$ 40 inteiros: somados,
    # passariam do valor separado, e a baixa é recusada.
    older = purchase_movement(-2, 4_000)
    with pytest.raises(InvalidInputError, match="passa do que ainda está separado"):
        service.stage_consume_reservations(session, account, classes["acoes_etfs"], older)
    session.rollback()

    assert session.query(CashReservationUse).count() == 1


def test_stage_consume_does_not_commit(client, session, account, classes):
    activate(client, account, 1_000_000, on=-60)
    separate(client, account, classes["acoes_etfs"], 4_000, date=day(-30))
    movement = SimpleNamespace(id=None, date=date.today(), amount_cents=1_000)

    assert (
        service.stage_consume_reservations(session, account, classes["acoes_etfs"], movement)
        == 1_000
    )
    session.rollback()

    assert overview(client, account)["reservations"][0]["used_cents"] == 0
