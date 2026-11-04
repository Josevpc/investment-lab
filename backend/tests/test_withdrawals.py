"""Registro de retiradas: resgates, saldo da reserva depois de cada um e o que falta da meta."""

import pytest
from sqlalchemy import func, select

from app.core.db import get_session
from app.features.reserve.models import ReserveSetting

API = "/api/v1"
DAY0 = "2026-09-30"


def asset(client, name, institution_id, *, invested=100_000, current=110_000, on=DAY0, **extra):
    response = client.post(
        f"{API}/assets",
        json={
            "name": name,
            "class_key": "renda_fixa",
            "institution_id": institution_id,
            "invested_cents": invested,
            "current_cents": current,
            "valuation_date": on,
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def typed_balance(client, asset_id, on, cents, **extra):
    response = client.post(
        f"{API}/assets/{asset_id}/balance", json={"date": on, "balance_cents": cents, **extra}
    )
    assert response.status_code == 200, response.text


def redeemed(client, asset_id, amount, on="2026-10-10", **extra):
    response = client.post(
        f"{API}/redemptions",
        json={"asset_id": asset_id, "amount_cents": amount, "date": on} | extra,
    )
    assert response.status_code == 201, response.text
    return response.json()


def set_goal(client, cents):
    response = client.put(f"{API}/reserve", json={"goal_cents": cents, "months": 6})
    assert response.status_code == 200, response.text


def update(client, item, **changes):
    body = {
        "name": item["name"],
        "class_key": item["class_key"],
        "institution_id": item["institution_id"],
        "purpose": item["purpose"],
        **changes,
    }
    response = client.put(f"{API}/assets/{item['id']}", json=body)
    assert response.status_code == 200, response.text


def withdrawals(client, **params):
    response = client.get(f"{API}/withdrawals", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def reserve_pair(client, institution):
    """Duas contas da reserva: R (R$ 1.100,00) e S (R$ 500,00), ambas em 30/09."""
    main = asset(client, "Cofrinho", institution["id"], purpose="reserva")
    other = asset(
        client,
        "Tesouro Selic",
        institution["id"],
        invested=50_000,
        current=50_000,
        purpose="reserva",
    )
    return main, other


# ---- lista ----------------------------------------------------------------------------------


def test_without_redemptions_everything_is_empty(client):
    assert withdrawals(client) == {
        "items": [],
        "total_cents": 0,
        "count": 0,
        "reserve_total_cents": 0,
        "years": [],
    }


def test_a_plain_redemption_is_listed_with_its_asset_and_effective_date(client, institution):
    cdb = asset(client, "CDB", institution["id"])
    moved = redeemed(client, cdb["id"], 11_000, note="Conserto do carro")

    body = withdrawals(client)

    assert body["items"] == [
        {
            "movement_id": moved["id"],
            "date": "2026-10-10",
            "effective_date": "2026-10-10",
            "asset_id": cdb["id"],
            "asset_name": "CDB",
            "institution_name": institution["name"],
            "asset_archived": False,
            "amount_cents": 11_000,
            "cost_cents": 10_000,
            "note": "Conserto do carro",
            "in_balance": False,
            "from_reserve": False,
            "reserve_balance_after_cents": None,
            "reserve_below_goal_cents": None,
        }
    ]
    assert (body["total_cents"], body["count"], body["reserve_total_cents"]) == (11_000, 1, 0)
    assert body["years"] == [2026]


def test_other_movements_are_not_withdrawals(client, institution):
    cdb = asset(client, "CDB", institution["id"])
    other = asset(client, "LCI", institution["id"])
    typed_balance(client, cdb["id"], "2026-10-31", 120_000, contribution_cents=5_000)
    transfer = client.post(
        f"{API}/transfers",
        json={
            "from_asset_id": cdb["id"],
            "to_asset_id": other["id"],
            "amount_cents": 1_000,
            "date": "2026-11-05",
        },
    )
    assert transfer.status_code == 201, transfer.text

    assert withdrawals(client)["items"] == []


def test_items_come_newest_first_and_ties_by_movement_id(client, institution):
    cdb = asset(client, "CDB", institution["id"])
    first = redeemed(client, cdb["id"], 1_000, on="2026-10-10")
    second = redeemed(client, cdb["id"], 2_000, on="2026-10-10")
    later = redeemed(client, cdb["id"], 3_000, on="2026-10-20")

    items = withdrawals(client)["items"]

    assert [i["movement_id"] for i in items] == [later["id"], second["id"], first["id"]]


def test_archived_asset_keeps_its_name_and_is_flagged(client, institution):
    cdb = asset(client, "CDB antigo", institution["id"])
    redeemed(client, cdb["id"], 11_000)
    update(client, cdb, archived=True)

    (item,) = withdrawals(client)["items"]

    assert (item["asset_name"], item["asset_archived"]) == ("CDB antigo", True)


# ---- resgate cujo saldo já veio sem o dinheiro ---------------------------------------------


def test_in_balance_redemption_takes_the_effective_date_from_the_next_typed_balance(
    client, institution
):
    cdb = asset(client, "CDB", institution["id"])
    typed_balance(client, cdb["id"], "2026-10-15", 111_000)
    typed_balance(client, cdb["id"], "2026-10-31", 100_000)
    redeemed(client, cdb["id"], 11_000, on="2026-10-20", already_in_balance=True)

    (item,) = withdrawals(client)["items"]

    assert (item["date"], item["effective_date"], item["in_balance"]) == (
        "2026-10-20",
        "2026-10-31",
        True,
    )


def test_in_balance_redemption_from_the_reserve_uses_the_balance_of_the_effective_date(
    client, institution
):
    main, other = reserve_pair(client, institution)
    typed_balance(client, main["id"], "2026-10-15", 111_000)  # ainda com o dinheiro
    typed_balance(client, main["id"], "2026-10-31", 100_000)  # o primeiro já sem ele
    redeemed(client, main["id"], 11_000, on="2026-10-20", already_in_balance=True)
    set_goal(client, 200_000)

    (item,) = withdrawals(client)["items"]

    # 100.000 (saldo de 31/10) + 50.000: não os 111.000 da linha anterior ao dia do resgate.
    assert item["effective_date"] == "2026-10-31"
    assert item["reserve_balance_after_cents"] == 150_000
    assert item["reserve_below_goal_cents"] == 50_000


def test_in_balance_redemption_without_a_later_typed_balance_has_no_effective_date(
    client, institution
):
    main, _ = reserve_pair(client, institution)
    typed_balance(client, main["id"], "2026-10-15", 111_000)
    typed_balance(client, main["id"], "2026-10-31", 100_000)
    redeemed(client, main["id"], 11_000, on="2026-10-20", already_in_balance=True)
    set_goal(client, 200_000)
    closing = next(
        v
        for v in client.get(f"{API}/assets/{main['id']}/valuations").json()
        if v["date"] == "2026-10-31"
    )
    response = client.delete(f"{API}/assets/{main['id']}/valuations/{closing['id']}")
    assert response.status_code == 204, response.text

    (item,) = withdrawals(client)["items"]

    assert item["effective_date"] is None
    assert item["from_reserve"] is True
    assert item["reserve_balance_after_cents"] is None
    assert item["reserve_below_goal_cents"] is None


# ---- reserva --------------------------------------------------------------------------------


def test_reserve_redemption_shows_the_reserve_balance_after_and_the_gap_to_the_goal(
    client, institution
):
    main, _ = reserve_pair(client, institution)
    cdb = asset(client, "CDB", institution["id"])
    redeemed(client, main["id"], 10_000)
    redeemed(client, cdb["id"], 1_000)
    set_goal(client, 200_000)

    body = withdrawals(client)
    reserve_item = next(i for i in body["items"] if i["asset_id"] == main["id"])
    cdb_item = next(i for i in body["items"] if i["asset_id"] == cdb["id"])

    assert reserve_item["from_reserve"] is True
    assert reserve_item["reserve_balance_after_cents"] == 150_000  # 100.000 + 50.000
    assert reserve_item["reserve_below_goal_cents"] == 50_000
    # O CDB não é da reserva: nada de saldo nem de meta, e fica fora do total da reserva.
    assert cdb_item["from_reserve"] is False
    assert cdb_item["reserve_balance_after_cents"] is None
    assert cdb_item["reserve_below_goal_cents"] is None
    assert (body["total_cents"], body["reserve_total_cents"]) == (11_000, 10_000)


def test_reserve_without_a_goal_has_the_balance_but_no_gap(client, institution):
    main, _ = reserve_pair(client, institution)
    redeemed(client, main["id"], 10_000)

    (item,) = withdrawals(client)["items"]

    assert item["reserve_balance_after_cents"] == 150_000
    assert item["reserve_below_goal_cents"] is None


def test_reserve_above_the_goal_has_a_gap_of_zero_not_negative(client, institution):
    main, _ = reserve_pair(client, institution)
    redeemed(client, main["id"], 10_000)
    set_goal(client, 120_000)

    (item,) = withdrawals(client)["items"]

    assert item["reserve_below_goal_cents"] == 0


def test_from_reserve_follows_the_purpose_the_asset_has_today(client, institution):
    main, _ = reserve_pair(client, institution)
    redeemed(client, main["id"], 10_000)
    update(client, main, purpose=None)

    (item,) = withdrawals(client)["items"]

    assert item["from_reserve"] is False
    assert item["reserve_balance_after_cents"] is None
    assert withdrawals(client)["reserve_total_cents"] == 0


def test_balance_uses_the_last_valuation_on_or_before_the_date(client, institution):
    main, other = reserve_pair(client, institution)
    typed_balance(client, other["id"], "2026-10-05", 60_000)  # antes do resgate
    typed_balance(client, other["id"], "2026-10-20", 70_000)  # depois: não vale
    redeemed(client, main["id"], 10_000, on="2026-10-10")

    (item,) = withdrawals(client)["items"]

    assert item["reserve_balance_after_cents"] == 100_000 + 60_000


def test_archived_reserve_asset_counts_until_its_last_record_and_not_after(client, institution):
    main, other = reserve_pair(client, institution)
    typed_balance(client, other["id"], "2026-10-31", 50_000)
    update(client, other, archived=True)
    redeemed(client, main["id"], 10_000, on="2026-10-10")
    redeemed(client, main["id"], 5_000, on="2026-11-05")

    november, october = withdrawals(client)["items"]

    # Mesma regra do histórico: o arquivado soma até o último registro dele e sai depois.
    assert october["reserve_balance_after_cents"] == 100_000 + 50_000
    assert november["reserve_balance_after_cents"] == 95_000


def test_two_redemptions_on_the_same_day_show_the_same_balance_after(client, institution):
    main, other = reserve_pair(client, institution)
    first = redeemed(client, main["id"], 10_000)
    second = redeemed(client, other["id"], 5_000)

    items = withdrawals(client)["items"]

    assert [i["movement_id"] for i in items] == [second["id"], first["id"]]
    # Os dois já descontados: 100.000 + 45.000.
    assert [i["reserve_balance_after_cents"] for i in items] == [145_000, 145_000]
    assert withdrawals(client)["reserve_total_cents"] == 15_000


# ---- filtro por ano -------------------------------------------------------------------------


def test_year_filters_items_and_totals_but_not_the_list_of_years(client, institution):
    main = asset(client, "Cofrinho", institution["id"], on="2025-11-30", purpose="reserva")
    cdb = asset(client, "CDB", institution["id"], on="2025-11-30")
    old = redeemed(client, main["id"], 1_000, on="2025-12-10")
    recent = redeemed(client, cdb["id"], 2_000, on="2026-10-10")

    everything = withdrawals(client)
    only_2025 = withdrawals(client, year=2025)
    only_2026 = withdrawals(client, year=2026)
    none = withdrawals(client, year=2024)

    assert [i["movement_id"] for i in everything["items"]] == [recent["id"], old["id"]]
    assert (everything["total_cents"], everything["count"]) == (3_000, 2)
    assert [i["movement_id"] for i in only_2025["items"]] == [old["id"]]
    assert (only_2025["total_cents"], only_2025["count"], only_2025["reserve_total_cents"]) == (
        1_000,
        1,
        1_000,
    )
    assert (only_2026["total_cents"], only_2026["count"], only_2026["reserve_total_cents"]) == (
        2_000,
        1,
        0,
    )
    assert (none["items"], none["total_cents"], none["count"]) == ([], 0, 0)
    for body in (everything, only_2025, only_2026, none):
        assert body["years"] == [2026, 2025]


@pytest.mark.parametrize("year", ["26", "20260", "999", "-2026", "abc", "2026.5", ""])
def test_invalid_year_is_422(client, year):
    assert client.get(f"{API}/withdrawals", params={"year": year}).status_code == 422


@pytest.mark.parametrize("year", [1000, 9999])
def test_year_limits_are_accepted(client, year):
    body = withdrawals(client, year=year)
    assert (body["items"], body["count"]) == ([], 0)


# ---- leitura não grava ----------------------------------------------------------------------


def reserve_setting_rows(client) -> int:
    """Quantas linhas `reserve_setting` existem, pela mesma sessão que a API usa."""
    override = client.app.dependency_overrides[get_session]
    session = next(override())
    try:
        return session.scalar(select(func.count()).select_from(ReserveSetting))
    finally:
        session.close()


def test_listing_withdrawals_does_not_create_the_reserve_setting(client, institution):
    assert reserve_setting_rows(client) == 0

    assert withdrawals(client)["count"] == 0
    main = asset(client, "Cofrinho", institution["id"], purpose="reserva")
    redeemed(client, main["id"], 1_000)
    body = withdrawals(client)

    # Sem meta salva, a retirada aparece sem "quanto falta"; e o GET não deixou linha para trás.
    assert body["count"] == 1
    assert body["items"][0]["reserve_below_goal_cents"] is None
    assert reserve_setting_rows(client) == 0


def test_get_reserve_still_creates_the_default_setting(client):
    assert reserve_setting_rows(client) == 0
    assert client.get(f"{API}/reserve").status_code == 200
    assert reserve_setting_rows(client) == 1
