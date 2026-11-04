"""Resgate: valor e custo saem do ativo, nos dois modos, com caixa opcional e sem virar prejuízo."""

import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

import pytest
from cash_helpers import activate, day, entries
from cash_helpers import balance as cash_balance

from app.core.db import get_session
from app.features.analytics.cdi_equivalent import Flow, simulate
from app.features.benchmarks import client as bcb
from app.features.portfolio.models import AssetValuation

API = "/api/v1"
DAY0 = "2026-09-30"


def asset(client, name, institution_id, *, invested, current, on=DAY0, **extra):
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


def redeem(client, asset_id, amount, on="2026-10-10", **extra):
    return client.post(
        f"{API}/redemptions",
        json={"asset_id": asset_id, "amount_cents": amount, "date": on} | extra,
    )


def redeemed(client, asset_id, amount, on="2026-10-10", **extra):
    response = redeem(client, asset_id, amount, on, **extra)
    assert response.status_code == 201, response.text
    return response.json()


def state(client, asset_id):
    body = client.get(f"{API}/assets/{asset_id}").json()
    return body["invested_cents"], body["current_cents"]


def rows(client, asset_id):
    found = client.get(f"{API}/assets/{asset_id}/valuations").json()
    return {v["date"]: (v["invested_cents"], v["current_cents"]) for v in found}


def movements(client, **params):
    return client.get(f"{API}/movements", params=params).json()


def undo(client, movement_id):
    return client.post(f"{API}/movements/{movement_id}/undo")


def edit(client, movement_id, **body):
    return client.patch(f"{API}/movements/{movement_id}", json=body)


@pytest.fixture
def cdb(client, institution):
    """Investido R$ 1.000,00 e saldo R$ 1.100,00 em 30/09."""
    return asset(client, "CDB", institution["id"], invested=100_000, current=110_000)


# ---- resgate comum --------------------------------------------------------------------------


def test_redemption_takes_value_and_proportional_cost_and_keeps_the_return(client, cdb):
    response = redeem(client, cdb["id"], 11_000, note="  Conserto do carro  ")

    assert response.status_code == 201
    body = response.json()
    assert (body["kind"], body["asset_id"], body["related_asset_id"]) == (
        "resgate",
        cdb["id"],
        None,
    )
    assert (body["amount_cents"], body["cost_cents"]) == (11_000, 10_000)
    assert (body["note"], body["in_balance"]) == ("Conserto do carro", False)
    assert state(client, cdb["id"]) == (90_000, 99_000)
    assert (
        client.get(f"{API}/assets/{cdb['id']}").json()["return_bps"] == cdb["return_bps"] == 1_000
    )
    assert rows(client, cdb["id"])[DAY0] == (100_000, 110_000)  # o histórico anterior não muda


@pytest.mark.parametrize(
    ("invested", "current", "amount", "cost"),
    [(100, 300, 1, 0), (100, 300, 2, 1), (1, 2, 1, 1), (100, 300, 3, 1), (1, 1_000, 999, 1)],
)
def test_cost_is_rounded_half_up(client, institution, invested, current, amount, cost):
    item = asset(client, "A", institution["id"], invested=invested, current=current)

    body = redeemed(client, item["id"], amount)

    assert body["cost_cents"] == cost
    assert state(client, item["id"]) == (invested - cost, current - amount)


def test_redeeming_everything_zeroes_the_asset(client, cdb):
    body = redeemed(client, cdb["id"], 110_000)

    assert body["cost_cents"] == 100_000
    assert state(client, cdb["id"]) == (0, 0)
    assert client.get(f"{API}/assets/{cdb['id']}").json()["return_bps"] is None


def test_redemption_does_not_touch_other_assets_or_the_cash(client, institution, cdb):
    other = asset(client, "Outro", institution["id"], invested=5_000, current=6_000)

    redeemed(client, cdb["id"], 11_000)

    assert state(client, other["id"]) == (5_000, 6_000)


def test_movements_can_be_filtered_by_the_new_kind_and_month_summary_counts_them(client, cdb):
    redeemed(client, cdb["id"], 11_000, note="Viagem")
    typed_balance(client, cdb["id"], "2026-10-31", 100_000, contribution_cents=1_000)

    found = movements(client, kind="resgate")
    summary = client.get(f"{API}/portfolio/month-summary", params={"month": "2026-10"}).json()

    assert [(m["kind"], m["note"]) for m in found] == [("resgate", "Viagem")]
    assert summary["redemptions_cents"] == 11_000
    assert summary["total_cents"] == 1_000  # o total só soma aportes


def test_delete_of_a_redemption_is_refused(client, cdb):
    moved = redeemed(client, cdb["id"], 11_000)

    response = client.delete(f"{API}/movements/{moved['id']}")

    assert response.status_code == 409
    assert len(movements(client)) == 1


# ---- resgate cujo saldo já veio sem o dinheiro ---------------------------------------------


def test_redemption_already_in_the_balance_only_takes_the_cost_from_invested(client, cdb):
    typed_balance(client, cdb["id"], "2026-10-31", 99_000)

    body = redeemed(client, cdb["id"], 11_000, already_in_balance=True)

    assert (body["cost_cents"], body["in_balance"]) == (10_000, True)
    assert state(client, cdb["id"]) == (90_000, 99_000)  # o saldo do extrato fica como está
    assert rows(client, cdb["id"])[DAY0] == (100_000, 110_000)


def test_already_in_balance_starts_at_the_first_typed_balance_after_the_date(client, institution):
    item = asset(client, "CDB", institution["id"], invested=100_000, current=110_000)
    typed_balance(client, item["id"], "2026-10-15", 111_000)
    typed_balance(client, item["id"], "2026-10-31", 100_000)

    redeemed(client, item["id"], 11_000, on="2026-10-20", already_in_balance=True)

    found = rows(client, item["id"])
    assert found["2026-10-15"] == (100_000, 111_000)  # o fechamento de antes nunca teve o resgate
    # Custo sobre o saldo de antes do resgate (100.000 + 11.000): 100.000 x 11.000 / 111.000.
    assert found["2026-10-31"] == (90_090, 100_000)


def test_undoing_an_already_in_balance_redemption_gives_back_only_the_cost(client, cdb):
    typed_balance(client, cdb["id"], "2026-10-31", 99_000)
    moved = redeemed(client, cdb["id"], 11_000, already_in_balance=True)

    assert undo(client, moved["id"]).status_code == 200

    assert state(client, cdb["id"]) == (100_000, 99_000)
    assert movements(client) == []


def test_editing_an_already_in_balance_redemption_recomputes_the_cost(client, cdb):
    typed_balance(client, cdb["id"], "2026-10-31", 99_000)
    moved = redeemed(client, cdb["id"], 11_000, already_in_balance=True)

    response = edit(client, moved["id"], amount_cents=5_500)

    # 100.000 de investido sobre 104.500 (saldo digitado + o que saiu): custo 5.263.
    assert response.status_code == 200
    assert response.json()["cost_cents"] == 5_263
    assert state(client, cdb["id"]) == (94_737, 99_000)


# ---- desfazer -------------------------------------------------------------------------------


def test_undo_returns_value_and_cost_exactly(client, cdb):
    before = state(client, cdb["id"])
    moved = redeemed(client, cdb["id"], 33_333)

    assert undo(client, moved["id"]).status_code == 200

    assert state(client, cdb["id"]) == before
    assert movements(client) == []


def test_undo_also_restores_rows_typed_after_the_redemption(client, cdb):
    moved = redeemed(client, cdb["id"], 11_000)
    typed_balance(client, cdb["id"], "2026-10-31", 108_900)  # o restante rendeu 10%

    undo(client, moved["id"])

    assert rows(client, cdb["id"])["2026-10-31"] == (100_000, 119_900)
    assert rows(client, cdb["id"])["2026-10-10"] == (100_000, 110_000)


def test_undo_of_an_unknown_redemption_is_404(client):
    assert undo(client, 9_999).status_code == 404


# ---- editar ---------------------------------------------------------------------------------


def test_editing_the_amount_recomputes_the_cost(client, cdb):
    moved = redeemed(client, cdb["id"], 11_000)

    response = edit(client, moved["id"], amount_cents=22_000)

    assert response.status_code == 200
    assert (response.json()["amount_cents"], response.json()["cost_cents"]) == (22_000, 20_000)
    assert state(client, cdb["id"]) == (80_000, 88_000)


def test_editing_the_date_recomputes_the_cost_from_the_balance_of_the_new_day(client, cdb):
    moved = redeemed(client, cdb["id"], 11_000)
    typed_balance(client, cdb["id"], "2026-10-31", 108_900)

    response = edit(client, moved["id"], date="2026-10-31")

    # No dia 31 o saldo sem o resgate é 119.900: 100.000 x 11.000 / 119.900 = 9.174.
    assert response.status_code == 200
    assert response.json()["cost_cents"] == 9_174
    assert state(client, cdb["id"]) == (90_826, 108_900)
    assert rows(client, cdb["id"])["2026-10-10"] == (100_000, 110_000)


def test_editing_above_the_balance_is_refused_and_changes_nothing(client, cdb):
    moved = redeemed(client, cdb["id"], 11_000)

    response = edit(client, moved["id"], amount_cents=200_000)

    assert response.status_code == 422
    assert state(client, cdb["id"]) == (90_000, 99_000)
    assert movements(client)[0]["amount_cents"] == 11_000


def test_the_note_can_be_changed_and_cleared_without_touching_balances(client, cdb):
    moved = redeemed(client, cdb["id"], 11_000, note="Antes")

    changed = edit(client, moved["id"], note="  Depois  ")
    assert changed.status_code == 200 and changed.json()["note"] == "Depois"
    assert edit(client, moved["id"], note="").json()["note"] is None
    assert edit(client, moved["id"], note="De novo").json()["note"] == "De novo"
    assert edit(client, moved["id"], note=None).json()["note"] is None
    assert state(client, cdb["id"]) == (90_000, 99_000)


def test_note_is_refused_outside_redemptions_and_an_empty_patch_is_invalid(client, cdb):
    typed_balance(client, cdb["id"], "2026-10-31", 120_000, contribution_cents=5_000)
    [aporte] = movements(client, kind="aporte")

    assert edit(client, aporte["id"], note="x").status_code == 422
    assert edit(client, aporte["id"], note=None).status_code == 422
    assert edit(client, aporte["id"]).status_code == 422
    assert edit(client, aporte["id"], amount_cents=4_000).status_code == 200


# ---- erros ----------------------------------------------------------------------------------


def test_unknown_asset_is_404(client):
    assert redeem(client, 9_999, 100).status_code == 404


def test_archived_asset_is_refused(client, cdb):
    body = {
        "name": cdb["name"],
        "class_key": cdb["class_key"],
        "institution_id": cdb["institution_id"],
        "archived": True,
    }
    assert client.put(f"{API}/assets/{cdb['id']}", json=body).status_code == 200

    response = redeem(client, cdb["id"], 100)

    assert response.status_code == 422
    assert "arquivado" in response.json()["detail"]


def test_amount_above_the_balance_is_refused_with_the_balance_in_the_message(client, cdb):
    response = redeem(client, cdb["id"], 110_001)

    assert response.status_code == 422
    assert "R$ 1.100,00" in response.json()["detail"]
    assert state(client, cdb["id"]) == (100_000, 110_000)
    assert movements(client) == []
    assert len(rows(client, cdb["id"])) == 1  # nem a linha do dia ficou


def test_date_before_the_last_update_is_refused(client, cdb):
    response = redeem(client, cdb["id"], 100, on="2026-09-01")

    assert response.status_code == 422
    assert "30/09/2026" in response.json()["detail"]


def test_asset_without_values_is_refused(client, cdb):
    session = next(client.app.dependency_overrides[get_session]())
    with session:
        session.query(AssetValuation).delete()
        session.commit()

    for extra in ({}, {"already_in_balance": True}):
        response = redeem(client, cdb["id"], 100, **extra)
        assert response.status_code == 422
        assert "valores" in response.json()["detail"]


@pytest.mark.parametrize("amount", [0, -1, 10**13 + 1])
def test_amount_must_be_positive_and_below_the_ceiling(client, cdb, amount):
    assert redeem(client, cdb["id"], amount).status_code == 422


def test_note_has_at_most_120_characters_after_trimming(client, cdb):
    assert redeem(client, cdb["id"], 100, note="x" * 121).status_code == 422
    ok = redeem(client, cdb["id"], 100, note="  " + "x" * 120 + "  ")
    assert ok.status_code == 201 and len(ok.json()["note"]) == 120
    assert redeem(client, cdb["id"], 100, note="   ").json()["note"] is None


def test_already_in_balance_needs_a_typed_balance_on_or_after_the_date(client, cdb):
    response = redeem(client, cdb["id"], 100, on="2026-10-10", already_in_balance=True)

    assert response.status_code == 422
    assert "saldo digitado" in response.json()["detail"]
    typed_balance(client, cdb["id"], "2026-10-05", 100_000)
    assert (
        redeem(client, cdb["id"], 100, on="2026-10-10", already_in_balance=True).status_code == 422
    )
    assert state(client, cdb["id"]) == (100_000, 100_000)


def test_already_in_balance_must_come_after_a_previous_typed_balance(client, cdb):
    typed_balance(client, cdb["id"], "2026-10-31", 99_000)

    # No dia do cadastro, ou antes, não há saldo anterior: o resgate cairia no ponto de partida.
    for on in (DAY0, "2026-09-15"):
        response = redeem(client, cdb["id"], 100, on=on, already_in_balance=True)
        assert response.status_code == 422
        assert "depois do primeiro saldo" in response.json()["detail"]
    assert state(client, cdb["id"]) == (100_000, 99_000)


# ---- caixa ----------------------------------------------------------------------------------


@pytest.fixture
def cash_asset(client, institution):
    account = client.get(f"{API}/accounts").json()[0]["id"]
    item = asset(client, "CDB", institution["id"], invested=100_000, current=110_000, on=day(-40))
    activate(client, account, 10_000)
    return account, item


def test_credit_cash_books_a_sale_linked_to_the_movement(client, cash_asset):
    account, item = cash_asset

    moved = redeemed(client, item["id"], 11_000, on=day(-5), credit_cash=True)

    [sale] = [e for e in entries(client, account) if e["kind"] == "venda"]
    assert (sale["amount_cents"], sale["movement_id"], sale["asset_id"]) == (
        11_000,
        moved["id"],
        item["id"],
    )
    assert sale["date"] == day(-5)
    assert cash_balance(client, account) == 21_000
    capital = client.get(f"{API}/cash/contributed-capital").json()
    assert capital["contributed_cents"] == 0  # venda não é depósito: não vira capital aportado


def test_without_credit_cash_the_cash_does_not_change(client, cash_asset):
    account, item = cash_asset

    redeemed(client, item["id"], 11_000, on=day(-5))

    assert cash_balance(client, account) == 10_000


def test_undo_removes_the_sale_and_gives_back_asset_and_cash(client, cash_asset):
    account, item = cash_asset
    before = (state(client, item["id"]), cash_balance(client, account), entries(client, account))
    moved = redeemed(client, item["id"], 11_000, on=day(-5), credit_cash=True)

    assert undo(client, moved["id"]).status_code == 200

    after = (state(client, item["id"]), cash_balance(client, account), entries(client, account))
    assert after == before


def test_undo_is_refused_when_the_cash_would_go_negative_and_changes_nothing(client, cash_asset):
    account, item = cash_asset
    moved = redeemed(client, item["id"], 11_000, on=day(-5), credit_cash=True)
    withdrawal = client.post(
        f"{API}/accounts/{account}/withdrawals", json={"amount_cents": 20_000, "date": day(-1)}
    )
    assert withdrawal.status_code == 201, withdrawal.text

    response = undo(client, moved["id"])

    assert response.status_code == 409
    assert state(client, item["id"]) == (90_000, 99_000)
    assert len(movements(client)) == 1
    assert cash_balance(client, account) == 1_000


def test_editing_a_credited_redemption_moves_the_sale_with_it(client, cash_asset):
    account, item = cash_asset
    moved = redeemed(client, item["id"], 11_000, on=day(-5), credit_cash=True)

    assert edit(client, moved["id"], amount_cents=5_500, date=day(-3)).status_code == 200

    [sale] = [e for e in entries(client, account) if e["kind"] == "venda"]
    assert (sale["amount_cents"], sale["date"]) == (5_500, day(-3))


def test_credit_cash_without_active_cash_is_refused_and_nothing_is_saved(client, cdb):
    response = redeem(client, cdb["id"], 11_000, credit_cash=True)

    assert response.status_code == 422
    assert "caixa" in response.json()["detail"]
    assert state(client, cdb["id"]) == (100_000, 110_000)
    assert movements(client) == []


def test_credit_cash_before_the_opening_balance_is_refused(client, cash_asset):
    _account, item = cash_asset

    response = redeem(client, item["id"], 100, on=day(-35), credit_cash=True)

    assert response.status_code == 422
    assert "saldo inicial" in response.json()["detail"]
    assert movements(client) == []


def test_a_redemption_made_before_the_cash_cannot_be_moved_into_it(client, cash_asset):
    _account, item = cash_asset
    moved = redeemed(client, item["id"], 100, on=day(-35))

    response = edit(client, moved["id"], date=day(-5))

    assert response.status_code == 422
    assert "caixa" in response.json()["detail"]


# ---- análises -------------------------------------------------------------------------------


def business_days(start, end):
    out, current = [], start + dt.timedelta(days=1)
    while current <= end:
        if current.weekday() < 5:
            out.append(current)
        current += dt.timedelta(days=1)
    return out


def seed_cdi(client, monkeypatch, start, end):
    rows_ = [(d, 437_390) for d in business_days(start, end)]
    monkeypatch.setattr(bcb, "fetch_series", lambda series, s, e: [("2026-10", 10_000)])
    monkeypatch.setattr(bcb, "fetch_daily_cdi", lambda s, e: rows_)
    monkeypatch.setattr(bcb, "fetch_ibovespa", lambda s, e: [])
    assert client.post(f"{API}/benchmarks/refresh").status_code == 200
    return [(d, Decimal(437_390) / Decimal(10**9)) for d, _ in rows_]


@pytest.mark.parametrize("already_in_balance", [False, True])
def test_a_redemption_keeps_the_return_and_the_percent_of_cdi(
    client, institution, monkeypatch, already_in_balance
):
    days = seed_cdi(client, monkeypatch, dt.date(2026, 9, 1), dt.date(2026, 10, 30))
    item = asset(client, "CDB 100%", institution["id"], invested=900_000, current=1_000_000)
    outflow = Flow(dt.date(2026, 10, 15), -10_000)  # R$ 100,00
    period = [(d, r) for d, r in days if d > dt.date(2026, 9, 30)]
    final = int(simulate(1_000_000, [outflow], period, Decimal(1)).to_integral_value(ROUND_HALF_UP))

    if already_in_balance:
        typed_balance(client, item["id"], "2026-10-30", final)
        redeemed(client, item["id"], 10_000, on="2026-10-15", already_in_balance=True)
    else:
        redeemed(client, item["id"], 10_000, on="2026-10-15")
        # A rentabilidade do que sobrou (investido x atual) não muda com o resgate: 11,11%.
        assert client.get(f"{API}/assets/{item['id']}").json()["return_bps"] == 1_111
        typed_balance(client, item["id"], "2026-10-30", final)

    body = client.get(f"{API}/analytics/assets/{item['id']}/vs-cdi").json()
    assert body["flows"] == [{"date": "2026-10-15", "kind": "resgate", "cents": -10_000}]
    assert body["flows_cents"] == -10_000
    assert body["yield_cents"] == final - 1_000_000 + 10_000
    assert abs(body["pct_of_cdi_bps"] - 10_000) <= 1
    assert abs(body["return_bps"] - body["cdi_bps"]) <= 1


def months_of_earnings(client):
    body = client.get(f"{API}/earnings").json()
    return {m["month"]: m["appreciation_cents"] for m in body["months"]}


@pytest.fixture
def earnings_today(monkeypatch):
    monkeypatch.setattr("app.features.earnings.service._today", lambda: dt.date(2026, 11, 15))


def earnings_asset(client, institution):
    return asset(
        client, "CDB", institution["id"], invested=100_000, current=110_000, on="2026-08-31"
    )


def test_earnings_baseline_without_a_redemption(client, institution, earnings_today):
    item = earnings_asset(client, institution)
    typed_balance(client, item["id"], "2026-09-30", 121_000)
    typed_balance(client, item["id"], "2026-10-31", 133_100)

    assert months_of_earnings(client) == {
        "2026-08": 0,
        "2026-09": 11_000,
        "2026-10": 12_100,
        "2026-11": 0,
    }


def test_a_normal_redemption_does_not_turn_the_withdrawn_gain_into_a_loss(
    client, institution, earnings_today
):
    item = earnings_asset(client, institution)
    # Resgate de R$ 121,00 (custo 100,00) no meio de setembro; o restante rende 10% até o dia 30.
    redeemed(client, item["id"], 12_100, on="2026-09-15")
    typed_balance(client, item["id"], "2026-09-30", 108_900)
    typed_balance(client, item["id"], "2026-10-31", 119_790)

    assert months_of_earnings(client) == {
        "2026-08": 0,
        "2026-09": 11_000,  # igual ao mês sem resgate: o ganho realizado volta à conta
        "2026-10": 10_890,  # 10% do que sobrou
        "2026-11": 0,
    }


def test_an_already_in_balance_redemption_counts_from_the_typed_balance_after_it(
    client, institution, earnings_today
):
    item = earnings_asset(client, institution)
    typed_balance(client, item["id"], "2026-09-30", 108_900)
    typed_balance(client, item["id"], "2026-10-31", 119_790)
    redeemed(client, item["id"], 12_100, on="2026-09-15", already_in_balance=True)

    assert months_of_earnings(client) == {
        "2026-08": 0,
        "2026-09": 11_000,
        "2026-10": 10_890,
        "2026-11": 0,
    }


def test_undoing_the_redemption_takes_its_gain_adjustment_away_too(
    client, institution, earnings_today
):
    item = earnings_asset(client, institution)
    typed_balance(client, item["id"], "2026-09-30", 121_000)
    moved = redeemed(client, item["id"], 12_100, on="2026-09-30")
    typed_balance(client, item["id"], "2026-10-31", 119_790)
    undo(client, moved["id"])

    months = months_of_earnings(client)
    assert months["2026-09"] == 11_000
    assert months["2026-10"] == 119_790 + 12_100 - 121_000


# ---- evolução e metas -----------------------------------------------------------------------


def test_evolution_appreciation_adds_the_withdrawals_back(client, institution):
    item = asset(
        client, "CDB", institution["id"], invested=100_000, current=100_000, on="2026-01-31"
    )
    typed_balance(client, item["id"], "2026-02-28", 130_000)
    redeemed(client, item["id"], 50_000, on="2026-03-15", note="Entrada do carro")
    typed_balance(client, item["id"], "2026-03-31", 80_000)

    summary = client.get(f"{API}/history/evolution").json()["summary"]

    assert summary["change_cents"] == -20_000
    assert summary["withdrawals_cents"] == 50_000
    assert summary["contributions_cents"] == 0
    assert summary["appreciation_cents"] == 30_000  # change - contributions + withdrawals


def test_evolution_without_redemptions_has_zero_withdrawals(client, make_asset):
    item = make_asset(valuation_date="2026-01-31")
    typed_balance(client, item["id"], "2026-02-28", 115_000)

    summary = client.get(f"{API}/history/evolution").json()["summary"]

    assert summary["withdrawals_cents"] == 0
    assert summary["appreciation_cents"] == summary["change_cents"] - summary["contributions_cents"]


def test_year_goal_lowers_the_accumulated_but_not_the_appreciation(
    client, institution, monkeypatch
):
    monkeypatch.setattr("app.features.goals.service._today", lambda: dt.date(2026, 10, 17))
    item = asset(
        client, "CDB", institution["id"], invested=100_000, current=100_000, on="2026-01-31"
    )
    typed_balance(client, item["id"], "2026-02-28", 130_000)
    redeemed(client, item["id"], 50_000, on="2026-03-15")
    typed_balance(client, item["id"], "2026-03-31", 80_000)

    year = client.get(f"{API}/goals/progress").json()["year"]

    assert year["status"] == "ok"
    assert year["accumulated_cents"] == -20_000
    assert year["withdrawals_cents"] == 50_000
    assert year["appreciation_cents"] == 30_000


def test_a_redemption_on_the_day_an_asset_is_registered_counts_as_cost_sent(client, institution):
    base = asset(client, "Base", institution["id"], invested=500_000, current=500_000)
    assert client.post(f"{API}/snapshots", json={"date": DAY0}).status_code == 201
    new = asset(
        client, "Novo", institution["id"], invested=100_000, current=100_000, on="2026-10-05"
    )
    redeemed(client, new["id"], 30_000, on="2026-10-05")
    client.post(f"{API}/snapshots", json={"date": "2026-10-31"})

    summary = client.get(f"{API}/history/evolution").json()["summary"]

    # O Novo entrou com R$ 1.000,00 (R$ 300,00 já saíram): é aporte de 100.000, e o resgate volta.
    assert base["id"] != new["id"]
    assert summary["new_assets_cents"] == 100_000
    assert summary["withdrawals_cents"] == 30_000
    assert summary["appreciation_cents"] == 0


def test_initial_contribution_of_a_new_asset_ignores_a_redemption_on_the_first_day(
    client, institution
):
    new = asset(
        client, "Novo", institution["id"], invested=100_000, current=100_000, is_new_investment=True
    )
    redeemed(client, new["id"], 30_000, on=DAY0)

    marked = client.get(f"{API}/assets/{new['id']}").json()
    assert marked["initial_contribution_cents"] == 100_000
    body = {k: marked[k] for k in ("name", "class_key", "institution_id")}
    updated = client.put(f"{API}/assets/{new['id']}", json=body | {"is_new_investment": True})
    assert updated.json()["initial_contribution_cents"] == 100_000


def test_an_already_in_balance_redemption_does_not_move_a_month_that_was_not_updated(
    client, institution, earnings_today
):
    item = earnings_asset(client, institution)
    typed_balance(client, item["id"], "2026-10-31", 99_000)  # sem fechamento de setembro
    redeemed(client, item["id"], 11_000, on="2026-09-15", already_in_balance=True)

    # As linhas só mudam no fechamento de 31/10: setembro não ganha nem perde nada.
    assert months_of_earnings(client) == {
        "2026-08": 0,
        "2026-09": 0,
        "2026-10": 0,
        "2026-11": 0,
    }


# ---- resgate já no saldo: a Evolução e a meta contam pela data em que ele passa a valer ----------


def late_balance_scenario(client, institution, *, redeemed_on, typed_on, balances):
    """Ativo cadastrado em 30/11/2025; o saldo sem o dinheiro só é digitado em `typed_on`.

    Os saldos de `before` (anteriores ao resgate) ainda têm o dinheiro; os de `after`, não.
    """
    item = asset(
        client, "CDB", institution["id"], invested=100_000, current=110_000, on="2025-11-30"
    )
    for day_ in balances["before"]:
        typed_balance(client, item["id"], day_, 110_000)
    typed_balance(client, item["id"], typed_on, 99_000)
    redeemed(client, item["id"], 11_000, on=redeemed_on, already_in_balance=True)
    for day_ in balances["after"]:
        typed_balance(client, item["id"], day_, 99_000)
    return item


def test_year_goal_counts_an_already_in_balance_redemption_by_the_date_it_takes_effect(
    client, institution, monkeypatch
):
    monkeypatch.setattr("app.features.goals.service._today", lambda: dt.date(2026, 10, 17))
    # Resgate de 20/12/2025, mas o saldo de 15/12 ainda tem o dinheiro (o saldo sem ele só foi
    # digitado em 15/01/2026): a queda aparece na meta de 2026, e a retirada precisa vir junto.
    late_balance_scenario(
        client,
        institution,
        redeemed_on="2025-12-20",
        typed_on="2026-01-15",
        balances={"before": ["2025-12-15"], "after": ["2026-01-31"]},
    )

    year = client.get(f"{API}/goals/progress").json()["year"]

    assert year["accumulated_cents"] == -11_000
    assert year["withdrawals_cents"] == 11_000
    assert year["appreciation_cents"] == 0  # o dinheiro que saiu não é prejuízo


def test_evolution_counts_an_already_in_balance_redemption_by_the_date_it_takes_effect(
    client, institution
):
    late_balance_scenario(
        client,
        institution,
        redeemed_on="2025-12-20",
        typed_on="2026-01-15",
        balances={"before": ["2025-12-15"], "after": ["2026-01-31"]},
    )

    summary = client.get(f"{API}/history/evolution").json()["summary"]

    assert summary["change_cents"] == -11_000
    assert summary["withdrawals_cents"] == 11_000
    assert summary["appreciation_cents"] == 0


def test_evolution_period_before_the_balance_was_typed_does_not_count_the_redemption(
    client, institution
):
    item = late_balance_scenario(
        client,
        institution,
        redeemed_on="2026-01-20",
        typed_on="2026-02-15",
        balances={"before": ["2025-12-15", "2026-01-10"], "after": ["2026-02-28"]},
    )

    early = client.get(f"{API}/history/evolution", params={"to": "2026-01-10"}).json()["summary"]
    later = client.get(f"{API}/history/evolution", params={"from": "2026-01-10"}).json()["summary"]

    # Os dois primeiros saldos ainda têm o dinheiro: nada caiu, nada voltou à conta.
    assert (early["change_cents"], early["withdrawals_cents"]) == (0, 0)
    assert (later["change_cents"], later["withdrawals_cents"]) == (-11_000, 11_000)
    assert later["appreciation_cents"] == 0
    assert item["id"]  # o ativo é o mesmo nos dois períodos


def test_a_normal_redemption_is_counted_on_its_own_date_in_the_evolution(client, institution):
    item = asset(
        client, "CDB", institution["id"], invested=100_000, current=110_000, on="2025-11-30"
    )
    typed_balance(client, item["id"], "2025-12-31", 110_000)
    redeemed(client, item["id"], 11_000, on="2026-01-20")
    typed_balance(client, item["id"], "2026-01-31", 99_000)

    summary = client.get(f"{API}/history/evolution").json()["summary"]

    assert (summary["withdrawals_cents"], summary["appreciation_cents"]) == (11_000, 0)


def test_an_already_in_balance_redemption_without_a_later_typed_balance_counts_nowhere(
    client, institution
):
    # Sem saldo digitado depois do resgate ele nem seria aceito: o 422 protege a conta.
    item = asset(
        client, "CDB", institution["id"], invested=100_000, current=110_000, on="2025-11-30"
    )
    assert (
        redeem(client, item["id"], 100, on="2026-01-20", already_in_balance=True).status_code == 422
    )
