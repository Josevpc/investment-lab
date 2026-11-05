"""Aporte "fora da meta": conta no investido, nos saldos e no caixa, mas não no plano do mês."""

from cash_helpers import activate, entries
from cash_helpers import balance as cash_balance

API = "/api/v1"
DAY0 = "2026-09-30"


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


def aportes(client, **params):
    return client.get(f"{API}/movements", params={"kind": "aporte", **params}).json()


def edit(client, movement_id, **body):
    return client.patch(f"{API}/movements/{movement_id}", json=body)


def month_summary(client, month="2026-10"):
    response = client.get(f"{API}/portfolio/month-summary", params={"month": month})
    assert response.status_code == 200, response.text
    return response.json()


def state_of(client, asset_id):
    """Tudo o que marcar/desmarcar jamais pode mexer: investido, saldo e linhas de valorização."""
    asset = client.get(f"{API}/assets/{asset_id}").json()
    valuations = client.get(f"{API}/assets/{asset_id}/valuations").json()
    return asset["invested_cents"], asset["current_cents"], valuations


# ---- criar o aporte já marcado ------------------------------------------------------------------


def test_a_balance_with_off_goal_marks_the_movement_and_still_counts_as_invested(
    client, make_asset
):
    cdb = make_asset(invested=100_000, current=100_000, valuation_date=DAY0)

    close(client, cdb, "2026-10-10", 160_000, 50_000, off_goal=True)

    [movement] = aportes(client)
    assert (movement["amount_cents"], movement["off_goal"]) == (50_000, True)
    asset = client.get(f"{API}/assets/{cdb['id']}").json()
    assert (asset["invested_cents"], asset["current_cents"]) == (150_000, 160_000)


def test_off_goal_is_false_by_default(client, make_asset):
    cdb = make_asset(invested=100_000, current=100_000, valuation_date=DAY0)

    close(client, cdb, "2026-10-10", 160_000, 50_000)

    assert [m["off_goal"] for m in aportes(client)] == [False]


def test_off_goal_without_a_contribution_is_ignored(client, make_asset):
    cdb = make_asset(invested=100_000, current=100_000, valuation_date=DAY0)

    close(client, cdb, "2026-10-10", 110_000, 0, off_goal=True)

    assert aportes(client) == []  # nenhum movimento, então nada a marcar
    asset = client.get(f"{API}/assets/{cdb['id']}").json()
    assert (asset["invested_cents"], asset["current_cents"]) == (100_000, 110_000)


def test_a_purchase_with_off_goal_keeps_its_cash_entries(client, institution, make_asset):
    account = client.get(f"{API}/accounts").json()[0]["id"]
    fii = make_asset("FII", invested=50_000, current=50_000, valuation_date=DAY0)
    activate(client, account, 10_000, on=-30)

    marked = client.post(
        f"{API}/purchases",
        json={"asset_id": fii["id"], "amount_cents": 4_000, "off_goal": True},
    )

    assert marked.status_code == 201, marked.text
    assert marked.json()["movement"]["off_goal"] is True
    assert cash_balance(client, account) == 6_000  # a compra saiu do caixa como sempre
    assert [(e["kind"], e["amount_cents"]) for e in entries(client, account)][0] == (
        "compra",
        -4_000,
    )
    asset = client.get(f"{API}/assets/{fii['id']}").json()
    assert (asset["invested_cents"], asset["current_cents"]) == (54_000, 54_000)


# ---- marcar e desmarcar depois ------------------------------------------------------------------


def test_marking_and_unmarking_only_writes_the_flag(client, institution, make_asset):
    account = client.get(f"{API}/accounts").json()[0]["id"]
    cdb = make_asset("CDB", invested=100_000, current=100_000, valuation_date=DAY0)
    activate(client, account, 0, on=-60)
    close(client, cdb, "2026-10-10", 160_000, 50_000)
    [movement] = aportes(client)
    before = (state_of(client, cdb["id"]), entries(client, account), cash_balance(client, account))

    marked = edit(client, movement["id"], off_goal=True)
    after_marking = (
        state_of(client, cdb["id"]),
        entries(client, account),
        cash_balance(client, account),
    )
    unmarked = edit(client, movement["id"], off_goal=False)
    after_unmarking = (
        state_of(client, cdb["id"]),
        entries(client, account),
        cash_balance(client, account),
    )

    assert marked.status_code == 200 and marked.json()["off_goal"] is True
    assert unmarked.status_code == 200 and unmarked.json()["off_goal"] is False
    assert after_marking == before and after_unmarking == before
    assert [(m["amount_cents"], m["date"], m["cost_cents"]) for m in aportes(client)] == [
        (movement["amount_cents"], movement["date"], movement["cost_cents"])
    ]


def test_marking_together_with_the_amount_applies_both(client, make_asset):
    cdb = make_asset(invested=100_000, current=100_000, valuation_date=DAY0)
    close(client, cdb, "2026-10-10", 160_000, 50_000)
    [movement] = aportes(client)

    response = edit(client, movement["id"], off_goal=True, amount_cents=40_000)

    assert response.status_code == 200, response.text
    assert (response.json()["amount_cents"], response.json()["off_goal"]) == (40_000, True)
    asset = client.get(f"{API}/assets/{cdb['id']}").json()
    assert asset["invested_cents"] == 140_000


def test_only_aportes_can_be_marked(client, make_asset):
    cdb = make_asset(invested=100_000, current=100_000, valuation_date=DAY0)
    close(client, cdb, "2026-10-10", 160_000, 50_000)
    provento = client.post(
        f"{API}/proventos", json={"asset_id": cdb["id"], "amount_cents": 700, "date": "2026-10-12"}
    ).json()
    redemption = client.post(
        f"{API}/redemptions",
        json={"asset_id": cdb["id"], "amount_cents": 1_000, "date": "2026-10-15"},
    ).json()

    for movement in (provento, redemption):
        for flag in (True, False):
            response = edit(client, movement["id"], off_goal=flag)
            assert response.status_code == 422, response.text
            assert "Só aportes podem ficar fora da meta." in str(response.json())

    assert [m["off_goal"] for m in client.get(f"{API}/movements").json()] == [False] * 3


def test_marking_an_unknown_movement_is_404(client):
    assert edit(client, 9999, off_goal=True).status_code == 404


def test_an_edit_with_nothing_to_change_is_still_refused(client, make_asset):
    cdb = make_asset(invested=100_000, current=100_000, valuation_date=DAY0)
    close(client, cdb, "2026-10-10", 160_000, 50_000)
    [movement] = aportes(client)

    assert edit(client, movement["id"]).status_code == 422
    assert edit(client, movement["id"], off_goal=None).status_code == 422


# ---- aporte inicial -----------------------------------------------------------------------------


def new_asset(client, make_asset, **extra):
    return make_asset(
        name="Novo",
        class_key="cripto",
        invested=40_000,
        current=42_000,
        valuation_date="2026-10-05",
        is_new_investment=True,
        **extra,
    )


def test_the_initial_contribution_can_be_marked_when_only_off_goal_comes(client, make_asset):
    novo = new_asset(client, make_asset)
    [initial] = aportes(client)
    assert initial["initial"] is True and initial["off_goal"] is False
    before = state_of(client, novo["id"])

    response = edit(client, initial["id"], off_goal=True)

    assert response.status_code == 200, response.text
    assert (response.json()["initial"], response.json()["off_goal"]) == (True, True)
    assert state_of(client, novo["id"]) == before


def test_the_initial_contribution_still_refuses_value_or_date_with_off_goal(client, make_asset):
    new_asset(client, make_asset)
    [initial] = aportes(client)

    for body in (
        {"amount_cents": 1_000},
        {"date": "2026-10-06"},
        {"amount_cents": 1_000, "date": "2026-10-06"},
    ):
        response = edit(client, initial["id"], off_goal=True, **body)
        assert response.status_code == 409, response.text
        assert edit(client, initial["id"], **body).status_code == 409

    assert aportes(client)[0]["off_goal"] is False  # nada foi gravado


def test_the_mark_of_the_initial_contribution_survives_a_correction_of_the_asset(
    client, make_asset
):
    novo = new_asset(client, make_asset)
    [initial] = aportes(client)
    edit(client, initial["id"], off_goal=True)

    body = {
        "name": "Novo",
        "class_key": "cripto",
        "institution_id": novo["institution_id"],
        "purpose": novo["purpose"],
        "is_new_investment": True,
    }
    assert client.put(f"{API}/assets/{novo['id']}", json=body).status_code == 200

    assert [m["off_goal"] for m in aportes(client)] == [True]


# ---- resumo do mês ------------------------------------------------------------------------------


def seed_october(client, make_asset):
    """Outubro: categoria com um aporte comum e um marcado, reserva marcada e ativo novo marcado."""
    cdb = make_asset("CDB", invested=100, current=100, valuation_date=DAY0)
    reserva = make_asset(
        "Cofrinho", invested=100, current=100, purpose="reserva", valuation_date=DAY0
    )
    novo = new_asset(client, make_asset)
    close(client, cdb, "2026-10-10", 60_100, 60_000)
    close(client, cdb, "2026-10-11", 75_100, 15_000, off_goal=True)
    close(client, reserva, "2026-10-12", 30_100, 30_000, off_goal=True)
    [initial] = [m for m in aportes(client) if m["initial"]]
    assert edit(client, initial["id"], off_goal=True).status_code == 200
    return cdb, reserva, novo


def test_the_month_summary_separates_what_counts_in_the_goal(client, make_asset):
    seed_october(client, make_asset)

    body = month_summary(client)

    by_class = {c["class_key"]: c for c in body["by_class"]}
    assert (by_class["renda_fixa"]["amount_cents"], by_class["renda_fixa"]["goal_cents"]) == (
        75_000,
        60_000,
    )
    assert (by_class["cripto"]["amount_cents"], by_class["cripto"]["goal_cents"]) == (40_000, 0)
    assert (
        by_class["renda_variavel"]["amount_cents"],
        by_class["renda_variavel"]["goal_cents"],
    ) == (0, 0)
    assert (body["reserve_cents"], body["reserve_goal_cents"]) == (30_000, 0)
    assert body["off_goal_cents"] == 15_000 + 30_000 + 40_000  # inclui reserva e aporte inicial
    # Os campos antigos continuam com tudo.
    assert body["total_cents"] == 60_000 + 15_000 + 30_000 + 40_000
    assert (body["registered_cents"], body["new_assets_cents"]) == (105_000, 40_000)


def test_the_month_summary_adds_up(client, make_asset):
    seed_october(client, make_asset)

    for month in ("2026-10", "2026-09", "2026-11"):
        body = month_summary(client, month)
        counted = body["reserve_goal_cents"] + sum(c["goal_cents"] for c in body["by_class"])
        assert body["total_cents"] == counted + body["off_goal_cents"]
        assert all(c["goal_cents"] <= c["amount_cents"] for c in body["by_class"])


def test_the_month_summary_without_marks_has_everything_in_the_goal(client, make_asset):
    cdb = make_asset("CDB", invested=100, current=100, valuation_date=DAY0)
    close(client, cdb, "2026-10-10", 60_100, 60_000)

    body = month_summary(client)

    assert body["off_goal_cents"] == 0 and body["reserve_goal_cents"] == 0
    assert [c["goal_cents"] for c in body["by_class"]] == [
        c["amount_cents"] for c in body["by_class"]
    ]
    assert body["total_cents"] == 60_000


def test_unmarking_brings_the_amount_back_into_the_goal(client, make_asset):
    seed_october(client, make_asset)
    for movement in aportes(client):
        edit(client, movement["id"], off_goal=False)

    body = month_summary(client)

    assert body["off_goal_cents"] == 0
    assert body["reserve_goal_cents"] == 30_000
    assert sum(c["goal_cents"] for c in body["by_class"]) == 115_000


# ---- o que NÃO muda -----------------------------------------------------------------------------


def targets():
    return [
        {"class_key": "renda_fixa", "percent_bps": 5_000},
        {"class_key": "renda_variavel", "percent_bps": 1_000},
        {"class_key": "acoes_etfs", "percent_bps": 3_000},
        {"class_key": "cripto", "percent_bps": 1_000},
    ]


def test_split_contribution_ignores_the_mark(client, make_asset):
    seed_october(client, make_asset)
    plan = client.post(
        f"{API}/allocation/plans", json={"name": "Plano", "targets": targets()}
    ).json()
    client.post(f"{API}/allocation/plans/{plan['id']}/activate")
    request = {"amount_cents": 90_000, "mode": "rebalance", "month": "2026-10"}

    marked = client.post(f"{API}/allocation/split", json=request).json()
    for movement in aportes(client):
        edit(client, movement["id"], off_goal=False)
    unmarked = client.post(f"{API}/allocation/split", json=request).json()

    assert marked == unmarked


def test_the_period_contributions_of_the_evolution_count_the_marked_ones(client, make_asset):
    cdb = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-01-31")
    close(client, cdb, "2026-02-20", 1_030_000, 30_000, off_goal=True)
    response = client.post(
        f"{API}/assets/{cdb['id']}/valuations",
        json={"date": "2026-03-31", "invested_cents": 1, "current_cents": 1_100_000},
    )
    assert response.status_code == 201, response.text

    summary = client.get(f"{API}/history/evolution").json()["summary"]

    assert summary["contributions_cents"] == 30_000
    assert summary["contributions_source"] == "diario"
