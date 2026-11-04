"""Aporte inicial: o ativo cadastrado como NOVO grava um aporte marcado no diário.

O aporte inicial é o investido da 1ª valorização (menos o que já era aporte comum ou veio de
transferência). Ele só alimenta os relatórios de aporte: nunca mexe em saldos nem no caixa.
"""

import datetime as dt
from types import SimpleNamespace

from cash_helpers import activate, entries, new_account

from app.features.analytics.service import _asset_flows

API = "/api/v1"
DAY0 = "2026-09-30"
NO_OWN_VALUE = "{} começou sem valor investido próprio; não há aporte inicial para registrar."


def create(client, institution, name="Novo", *, invested=80_000, current=90_000, **extra):
    body = {
        "name": name,
        "class_key": "renda_fixa",
        "institution_id": institution["id"],
        "invested_cents": invested,
        "current_cents": current,
        "valuation_date": DAY0,
        **extra,
    }
    return client.post(f"{API}/assets", json=body)


def movements(client, **params):
    return client.get(f"{API}/movements", params=params).json()


def initials(client):
    return [m for m in movements(client) if m["initial"]]


def asset(client, asset_id):
    return client.get(f"{API}/assets/{asset_id}").json()


def edit(client, current, **changes):
    """PUT /assets/{id} com os mesmos campos do ativo e as mudanças pedidas."""
    body = {
        "name": current["name"],
        "class_key": current["class_key"],
        "institution_id": current["institution_id"],
        "purpose": current["purpose"],
    } | changes
    return client.put(f"{API}/assets/{current['id']}", json=body)


# ---- cadastro ----------------------------------------------------------------------------------


def test_a_new_asset_records_the_initial_contribution_on_its_first_valuation_date(
    client, institution
):
    response = create(client, institution, is_new_investment=True)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["is_new_investment"] is True
    assert body["initial_contribution_cents"] == 80_000  # o investido, não o atual
    assert body["initial_contribution_date"] == DAY0
    [initial] = initials(client)
    assert (initial["kind"], initial["amount_cents"], initial["date"]) == ("aporte", 80_000, DAY0)
    assert initial["asset_id"] == body["id"]


def test_an_old_asset_records_nothing_and_is_the_default(client, institution):
    default = create(client, institution, "Padrão").json()
    explicit = create(client, institution, "Antigo", is_new_investment=False).json()

    assert movements(client) == []
    for body in (default, explicit):
        assert body["is_new_investment"] is False
        assert body["initial_contribution_cents"] is None
        assert body["initial_contribution_date"] is None


def test_the_initial_contribution_never_changes_balances(client, institution):
    body = create(client, institution, is_new_investment=True).json()

    assert (body["invested_cents"], body["current_cents"]) == (80_000, 90_000)
    valuations = client.get(f"{API}/assets/{body['id']}/valuations").json()
    assert [(v["invested_cents"], v["current_cents"]) for v in valuations] == [(80_000, 90_000)]


def test_the_initial_contribution_does_not_touch_the_cash_of_the_account(client, institution):
    account = new_account(client, "Conta com caixa", institution["id"])
    activate(client, account["id"], 500_000)

    response = create(client, institution, account_id=account["id"], is_new_investment=True)

    assert response.status_code == 201, response.text
    assert [e["kind"] for e in entries(client, account["id"])] == ["saldo_inicial"]
    assert len(initials(client)) == 1


def test_an_asset_without_own_invested_value_cannot_be_new_and_nothing_is_saved(
    client, institution
):
    response = create(
        client, institution, "Zerado", invested=0, current=50_000, is_new_investment=True
    )

    assert response.status_code == 422
    assert response.json()["detail"] == NO_OWN_VALUE.format("Zerado")
    assert client.get(f"{API}/assets").json() == []
    assert movements(client) == []


def test_the_initial_amount_leaves_out_ordinary_contributions_up_to_the_first_valuation(
    client, institution
):
    # Aporte de R$ 200 no próprio dia do cadastro: já está no investido de R$ 1.000.
    old = create(client, institution, invested=80_000).json()
    client.post(
        f"{API}/assets/{old['id']}/balance",
        json={"date": DAY0, "balance_cents": 120_000, "contribution_cents": 20_000},
    )

    body = edit(client, asset(client, old["id"]), is_new_investment=True).json()

    assert body["initial_contribution_cents"] == 80_000  # 100.000 investido - 20.000 do aporte
    ordinary = [m for m in movements(client) if not m["initial"]]
    assert [m["amount_cents"] for m in ordinary] == [20_000]


def test_a_contribution_after_the_first_valuation_is_not_deducted(client, institution):
    new = create(client, institution, is_new_investment=True).json()
    client.post(
        f"{API}/assets/{new['id']}/balance",
        json={"date": "2026-10-31", "balance_cents": 130_000, "contribution_cents": 30_000},
    )

    assert asset(client, new["id"])["initial_contribution_cents"] == 80_000


def test_a_transfer_received_on_the_first_day_is_not_part_of_the_initial_amount(
    client, institution
):
    source = create(client, institution, "Origem", invested=500_000, current=500_000).json()
    target = create(client, institution, "Destino", invested=50_000, current=50_000).json()
    client.post(
        f"{API}/transfers",
        json={
            "from_asset_id": source["id"],
            "to_asset_id": target["id"],
            "amount_cents": 100_000,
            "date": DAY0,
        },
    )

    body = edit(client, asset(client, target["id"]), is_new_investment=True).json()

    # O investido do destino subiu 100.000 com a transferência; só os 50.000 são dinheiro novo.
    assert body["initial_contribution_cents"] == 50_000


def test_a_transfer_sent_on_the_first_day_gives_the_money_back_to_the_initial_amount(
    client, institution
):
    # O ativo nasce com R$ 600 e manda R$ 400 a outro no mesmo dia: o investido da 1ª linha cai
    # para 200, mas o dinheiro novo dele continua sendo os R$ 600.
    source = create(client, institution, "Origem", invested=60_000, current=60_000).json()
    other = create(client, institution, "Outro", invested=10_000, current=10_000).json()
    client.post(
        f"{API}/transfers",
        json={
            "from_asset_id": source["id"],
            "to_asset_id": other["id"],
            "amount_cents": 40_000,
            "date": DAY0,
        },
    )

    body = edit(client, asset(client, source["id"]), is_new_investment=True).json()

    assert body["initial_contribution_cents"] == 60_000


# ---- trocar a marca ----------------------------------------------------------------------------


def test_marking_an_old_asset_as_new_creates_the_initial_contribution(client, institution):
    old = create(client, institution).json()

    body = edit(client, old, is_new_investment=True).json()

    assert body["is_new_investment"] is True
    assert body["initial_contribution_cents"] == 80_000
    assert len(initials(client)) == 1


def test_marking_twice_keeps_a_single_initial_contribution(client, institution):
    old = create(client, institution).json()

    edit(client, old, is_new_investment=True)
    edit(client, old, is_new_investment=True)

    assert len(initials(client)) == 1


def test_unmarking_removes_the_initial_contribution_and_leaves_balances_alone(client, institution):
    new = create(client, institution, is_new_investment=True).json()

    body = edit(client, new, is_new_investment=False).json()

    assert body["is_new_investment"] is False and body["initial_contribution_cents"] is None
    assert movements(client) == []
    assert (body["invested_cents"], body["current_cents"]) == (80_000, 90_000)


def test_editing_without_the_mark_keeps_it_either_way(client, institution):
    new = create(client, institution, "Novo", is_new_investment=True).json()
    old = create(client, institution, "Antigo").json()

    edit(client, new, name="Novo renomeado")  # sem is_new_investment
    edit(client, old, name="Antigo renomeado", is_new_investment=None)

    assert asset(client, new["id"])["is_new_investment"] is True
    assert asset(client, old["id"])["is_new_investment"] is False
    assert len(initials(client)) == 1


def test_marking_an_asset_without_own_invested_value_is_refused_and_changes_nothing(
    client, institution
):
    zero = create(client, institution, "Zerado", invested=0, current=50_000).json()

    response = edit(client, zero, name="Outro nome", is_new_investment=True)

    assert response.status_code == 422
    assert response.json()["detail"] == NO_OWN_VALUE.format("Outro nome")
    assert asset(client, zero["id"])["name"] == "Zerado"  # nem o nome mudou
    assert movements(client) == []


# ---- mexer no movimento inicial ----------------------------------------------------------------


def test_the_initial_contribution_cannot_be_edited(client, institution):
    create(client, institution, is_new_investment=True)
    [initial] = initials(client)

    for body in ({"amount_cents": 1_000}, {"date": "2026-10-05"}):
        response = client.patch(f"{API}/movements/{initial['id']}", json=body)
        assert response.status_code == 409
        assert response.json()["detail"] == (
            "Esse é o aporte inicial do ativo. Para mudar, edite o valor do ativo ou "
            "marque-o como antigo."
        )
    [again] = initials(client)
    assert (again["amount_cents"], again["date"]) == (80_000, DAY0)


def test_undoing_the_initial_contribution_only_deletes_the_movement(client, institution):
    new = create(client, institution, is_new_investment=True).json()
    [initial] = initials(client)

    response = client.post(f"{API}/movements/{initial['id']}/undo")

    assert response.status_code == 200
    assert response.json()["id"] == initial["id"]
    assert movements(client) == []
    after = asset(client, new["id"])
    assert (after["invested_cents"], after["current_cents"]) == (80_000, 90_000)
    assert after["is_new_investment"] is False


def test_undoing_the_initial_contribution_does_not_shift_later_balances(client, institution):
    new = create(client, institution, is_new_investment=True).json()
    client.post(
        f"{API}/assets/{new['id']}/balance",
        json={"date": "2026-10-31", "balance_cents": 150_000, "contribution_cents": 40_000},
    )
    [initial] = initials(client)

    client.post(f"{API}/movements/{initial['id']}/undo")

    valuations = client.get(f"{API}/assets/{new['id']}/valuations").json()
    assert sorted((v["date"], v["invested_cents"], v["current_cents"]) for v in valuations) == [
        (DAY0, 80_000, 90_000),
        ("2026-10-31", 120_000, 150_000),
    ]


def test_undoing_an_ordinary_contribution_still_shifts_balances(client, institution):
    new = create(client, institution, is_new_investment=True).json()
    client.post(
        f"{API}/assets/{new['id']}/balance",
        json={"date": "2026-10-31", "balance_cents": 150_000, "contribution_cents": 40_000},
    )
    [ordinary] = [m for m in movements(client) if not m["initial"]]

    client.post(f"{API}/movements/{ordinary['id']}/undo")

    after = asset(client, new["id"])
    assert after["invested_cents"] == 80_000  # só o aporte comum saiu
    assert len(initials(client)) == 1


def test_an_ordinary_contribution_can_still_be_edited_next_to_the_initial(client, institution):
    new = create(client, institution, is_new_investment=True).json()
    client.post(
        f"{API}/assets/{new['id']}/balance",
        json={"date": "2026-10-31", "balance_cents": 150_000, "contribution_cents": 40_000},
    )
    [ordinary] = [m for m in movements(client) if not m["initial"]]

    response = client.patch(f"{API}/movements/{ordinary['id']}", json={"amount_cents": 30_000})

    assert response.status_code == 200, response.text
    assert asset(client, new["id"])["invested_cents"] == 110_000
    assert asset(client, new["id"])["initial_contribution_cents"] == 80_000


# ---- acompanhar a 1ª valorização ---------------------------------------------------------------


def test_correcting_the_first_valuation_resyncs_the_initial_amount_and_date(client, institution):
    new = create(client, institution, is_new_investment=True).json()
    [first] = client.get(f"{API}/assets/{new['id']}/valuations").json()

    response = client.put(
        f"{API}/assets/{new['id']}/valuations/{first['id']}",
        json={"date": "2026-09-15", "invested_cents": 95_000, "current_cents": 99_000},
    )

    assert response.status_code == 200, response.text
    [initial] = initials(client)
    assert (initial["amount_cents"], initial["date"]) == (95_000, "2026-09-15")


def test_an_earlier_valuation_becomes_the_first_and_moves_the_initial(client, institution):
    new = create(client, institution, is_new_investment=True).json()

    response = client.post(
        f"{API}/assets/{new['id']}/valuations",
        json={"date": "2026-08-31", "invested_cents": 60_000, "current_cents": 61_000},
    )

    assert response.status_code == 201, response.text
    [initial] = initials(client)
    assert (initial["amount_cents"], initial["date"]) == (60_000, "2026-08-31")


def test_a_later_valuation_does_not_move_the_initial(client, institution):
    new = create(client, institution, is_new_investment=True).json()

    client.post(
        f"{API}/assets/{new['id']}/valuations",
        json={"date": "2026-10-31", "invested_cents": 200_000, "current_cents": 210_000},
    )

    [initial] = initials(client)
    assert (initial["amount_cents"], initial["date"]) == (80_000, DAY0)


def test_deleting_the_first_valuation_moves_the_initial_to_the_next_one(client, institution):
    new = create(client, institution, is_new_investment=True).json()
    client.post(
        f"{API}/assets/{new['id']}/valuations",
        json={"date": "2026-10-31", "invested_cents": 120_000, "current_cents": 130_000},
    )
    first = min(client.get(f"{API}/assets/{new['id']}/valuations").json(), key=lambda v: v["date"])

    response = client.delete(f"{API}/assets/{new['id']}/valuations/{first['id']}")

    assert response.status_code == 204
    [initial] = initials(client)
    assert (initial["amount_cents"], initial["date"]) == (120_000, "2026-10-31")


def test_a_valuation_edit_that_leaves_no_own_invested_value_is_refused(client, institution):
    new = create(client, institution, "Novo", is_new_investment=True).json()
    [first] = client.get(f"{API}/assets/{new['id']}/valuations").json()

    response = client.put(
        f"{API}/assets/{new['id']}/valuations/{first['id']}",
        json={"date": DAY0, "invested_cents": 0, "current_cents": 90_000},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == NO_OWN_VALUE.format("Novo")
    [kept] = client.get(f"{API}/assets/{new['id']}/valuations").json()
    assert kept["invested_cents"] == 80_000  # a correção não foi gravada
    assert initials(client)[0]["amount_cents"] == 80_000


def test_correcting_invested_in_the_balance_closing_resyncs_the_initial(client, institution):
    new = create(client, institution, is_new_investment=True).json()

    client.post(
        f"{API}/assets/{new['id']}/balance",
        json={"date": DAY0, "balance_cents": 90_000, "invested_cents": 70_000},
    )

    assert initials(client)[0]["amount_cents"] == 70_000


# ---- resumo do mês -----------------------------------------------------------------------------


def month_summary(client, month="2026-09"):
    return client.get(f"{API}/portfolio/month-summary", params={"month": month}).json()


def test_month_summary_adds_new_assets_to_the_registered_total(client, institution):
    old = create(client, institution, "Antigo", invested=500_000, current=500_000).json()
    client.post(
        f"{API}/assets/{old['id']}/balance",
        json={"date": "2026-09-30", "balance_cents": 530_000, "contribution_cents": 20_000},
    )
    novo = create(client, institution, "Novo CDB", is_new_investment=True).json()

    summary = month_summary(client)

    assert summary["registered_cents"] == 20_000
    assert summary["new_assets_cents"] == 80_000
    assert summary["new_assets"] == [
        {"asset_id": novo["id"], "asset_name": "Novo CDB", "amount_cents": 80_000}
    ]
    assert summary["total_cents"] == 100_000
    assert summary["registered_cents"] + summary["new_assets_cents"] == summary["total_cents"]
    rf = next(c for c in summary["by_class"] if c["class_key"] == "renda_fixa")
    assert rf["amount_cents"] == 100_000


def test_month_summary_sends_a_new_reserve_asset_to_the_reserve(client, institution):
    create(client, institution, "Caixinha", purpose="reserva", is_new_investment=True)

    summary = month_summary(client)

    assert summary["reserve_cents"] == 80_000
    assert summary["new_assets_cents"] == 80_000
    assert all(c["amount_cents"] == 0 for c in summary["by_class"])


def test_month_summary_without_new_assets_keeps_the_old_numbers(client, institution):
    create(client, institution)  # antigo: nada entra

    summary = month_summary(client)

    assert (summary["registered_cents"], summary["new_assets_cents"]) == (0, 0)
    assert summary["new_assets"] == [] and summary["total_cents"] == 0


def test_month_summary_ignores_new_assets_of_other_months(client, institution):
    create(client, institution, is_new_investment=True)

    assert month_summary(client, "2026-10")["new_assets_cents"] == 0


# ---- histórico: sem contar em dobro ------------------------------------------------------------


def closing(date, total):
    item = {"class_key": "renda_fixa", "invested_cents": 1, "current_cents": total}
    return {"date": date, "items": [item]}


def _history_scenario(client, institution, *, new: bool):
    """Antigo com R$ 10.000 em jan; Novo cadastrado em fev com um aporte comum dias antes."""
    antigo = create(
        client,
        institution,
        "Antigo",
        invested=1_000_000,
        current=1_000_000,
        valuation_date="2026-01-31",
    )
    assert antigo.status_code == 201
    assert client.post(f"{API}/snapshots", json=closing("2026-01-31", 1_000_000)).status_code == 201
    novo = create(
        client,
        institution,
        "Novo",
        invested=62_391,
        current=70_000,
        valuation_date="2026-02-15",
    ).json()
    client.post(
        f"{API}/assets/{novo['id']}/balance",
        json={
            "date": "2026-02-15",
            "balance_cents": 71_391,
            "contribution_cents": 9_000,
            "contribution_date": "2026-02-06",
        },
    )
    if new:
        assert edit(client, asset(client, novo["id"]), is_new_investment=True).status_code == 200
    assert client.post(f"{API}/snapshots", json=closing("2026-03-31", 1_100_000)).status_code == 201
    return client.get(f"{API}/history/evolution").json()["summary"]


def test_history_counts_a_new_asset_once_whether_marked_new_or_not(client, institution):
    unmarked = _history_scenario(client, institution, new=False)

    assert unmarked["contributions_cents"] == 71_391  # 62.391 do cadastro + 9.000 de aporte
    assert unmarked["new_assets_cents"] == 71_391


def test_history_marked_new_gives_the_same_total_through_the_diary(client, institution):
    marked = _history_scenario(client, institution, new=True)

    assert marked["contributions_cents"] == 71_391  # sem dobra: inicial 62.391 + comum 9.000
    assert marked["new_assets_cents"] == 0  # agora vem do diário, não do "ativo novo"
    assert marked["contributions_source"] == "diario"
    assert marked["estimated_months"] == []
    assert marked["appreciation_cents"] == marked["change_cents"] - 71_391


# ---- desempenho contra o CDI -------------------------------------------------------------------


def test_the_initial_contribution_is_not_a_flow_for_the_cdi_comparison():
    def movement(kind, initial):
        return SimpleNamespace(
            kind=kind,
            initial=initial,
            date=dt.date(2026, 9, 30),
            asset_id=7,
            related_asset_id=None,
            amount_cents=5_000,
        )

    flows = _asset_flows(7, [movement("aporte", True), movement("aporte", False)])

    assert [kind for _, kind in flows] == ["aporte"]  # só o comum


def test_deleting_an_initial_contribution_points_to_the_right_way(client, institution):
    create(client, institution, is_new_investment=True)
    [initial] = initials(client)

    response = client.delete(f"{API}/movements/{initial['id']}")

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "aporte inicial" in detail
    assert "Desfazer" in detail and "antigo" in detail
    assert "já alterou saldos" not in detail
    assert len(initials(client)) == 1  # nada foi apagado


def test_deleting_an_ordinary_contribution_keeps_the_generic_message(client, institution):
    old = create(client, institution).json()
    client.post(
        f"{API}/assets/{old['id']}/balance",
        json={"date": "2026-10-05", "balance_cents": 95_000, "contribution_cents": 1_000},
    )
    [ordinary] = [m for m in movements(client) if m["kind"] == "aporte"]

    response = client.delete(f"{API}/movements/{ordinary['id']}")

    assert response.status_code == 409
    assert response.json()["detail"].startswith("Esse movimento já alterou saldos.")
