from app.features.allocation.domain import split_proportional, split_rebalance
from app.features.allocation.service import split_amounts
from app.features.analytics.domain import (
    base_shares_bps,
    max_gap_bps,
    months_to_target,
    shares_bps,
    simulate_contributions,
)

TARGETS = {1: 5_000, 2: 5_000}


def rebalance(amount, targets, current):
    return split_rebalance(amount, targets, current)


def proportional(amount, targets, _current):
    return split_proportional(amount, targets)


def test_shares_bps():
    assert shares_bps({1: 750, 2: 250}) == {1: 7_500, 2: 2_500}
    assert shares_bps({1: 0, 2: 0}) == {1: 0, 2: 0}


def test_simulation_keeps_the_total_growing_by_the_contribution():
    states = simulate_contributions({1: 900_000, 2: 100_000}, TARGETS, 50_000, 6, rebalance)
    assert len(states) == 7
    assert [sum(s.values()) for s in states] == [1_000_000 + 50_000 * m for m in range(7)]


def test_rebalance_moves_toward_target_and_proportional_does_not():
    start = {1: 900_000, 2: 100_000}
    rebalanced = simulate_contributions(start, TARGETS, 100_000, 12, rebalance)
    proportional_run = simulate_contributions(start, TARGETS, 100_000, 12, proportional)

    assert max_gap_bps(rebalanced[-1], TARGETS) < max_gap_bps(rebalanced[0], TARGETS)
    # Dividindo pela meta, 12 aportes iguais melhoram, mas bem menos do que rebalanceando.
    assert max_gap_bps(rebalanced[-1], TARGETS) < max_gap_bps(proportional_run[-1], TARGETS)


def test_months_to_target():
    start = {1: 900_000, 2: 100_000}
    states = simulate_contributions(start, TARGETS, 100_000, 24, rebalance)
    month = months_to_target(states, TARGETS, tolerance_bps=100)
    assert month is not None
    assert max_gap_bps(states[month], TARGETS) <= 100
    assert month == 0 or max_gap_bps(states[month - 1], TARGETS) > 100
    # Sem aporte a carteira nunca chega lá.
    assert (
        months_to_target(simulate_contributions(start, TARGETS, 0, 24, rebalance), TARGETS, 100)
        is None
    )


def test_already_balanced_portfolio_is_at_target_from_month_zero():
    states = simulate_contributions({1: 500_000, 2: 500_000}, TARGETS, 10_000, 3, rebalance)
    assert months_to_target(states, TARGETS, 0) == 0


def test_empty_portfolio_never_counts_as_on_target():
    states = simulate_contributions({1: 0, 2: 0}, TARGETS, 0, 3, rebalance)
    assert months_to_target(states, TARGETS, 100) is None


# ---- API ---------------------------------------------------------------------------------

API = "/api/v1/analytics/trajectory"


def test_trajectory_uses_last_contribution_by_default(client, make_asset):
    make_asset(name="CDB", class_key="renda_fixa", invested=900_000, current=900_000)
    make_asset(name="BTC", class_key="cripto", invested=100_000, current=100_000)
    client.put(
        "/api/v1/contributions/2026-10", json={"salary_cents": 1_000_000, "percent_bps": 1_000}
    )

    body = client.post(API, json={"months": 12}).json()
    assert body["contribution_source"] == "last_contribution"
    assert body["monthly_contribution_cents"] == 100_000
    assert body["mode"] == "rebalance"
    assert len(body["points"]) == 13
    assert body["points"][0]["month"] == 0
    assert body["points"][0]["total_cents"] == 1_000_000
    assert body["points"][-1]["total_cents"] == 2_200_000
    assert body["end_gap_bps"] < body["start_gap_bps"]
    assert {c["key"] for c in body["classes"]} == {
        "renda_fixa",
        "renda_variavel",
        "acoes_etfs",
        "cripto",
    }
    first = body["points"][0]["shares_bps"]
    assert first["renda_fixa"] == 9_000


def test_trajectory_with_informed_amount_and_no_history(client, make_asset):
    make_asset(name="CDB", class_key="renda_fixa", invested=100_000, current=100_000)
    body = client.post(API, json={"months": 6, "monthly_contribution_cents": 20_000}).json()
    assert body["contribution_source"] == "informed"
    assert body["points"][-1]["total_cents"] == 100_000 + 6 * 20_000

    without_anything = client.post(API, json={"months": 3}).json()
    assert without_anything["contribution_source"] == "none"
    assert without_anything["monthly_contribution_cents"] == 0
    assert without_anything["months_to_target"] is None


def test_trajectory_accepts_empty_body_and_validates_input(client):
    assert client.post(API).status_code == 200
    assert client.post(API, json={"months": 0}).status_code == 422
    assert client.post(API, json={"months": 601}).status_code == 422
    assert client.post(API, json={"mode": "outro"}).status_code == 422


# ---- manter posição: categoria com todos os ativos mantidos -------------------------------

# A categoria 1 está toda mantida; as metas efetivas já vêm reescaladas.
HELD_TARGETS = {1: 0, 2: 5_000, 3: 5_000}


def held_split(fully_held):
    def split(amount, targets, current):
        return split_amounts(amount, targets, current, "rebalance", fully_held)

    return split


def test_gap_is_measured_only_on_the_categories_that_are_not_fully_held():
    values = {1: 800_000, 2: 100_000, 3: 100_000}
    # Sem a categoria 1 a base é R$ 2.000, dividida 50/50: já está na meta.
    assert max_gap_bps(values, HELD_TARGETS, fully_held={1}) == 0
    # Tratada como categoria comum, com meta 0%, ela destoaria em 80 pontos percentuais.
    assert max_gap_bps(values, HELD_TARGETS) == 8_000
    assert base_shares_bps(values, fully_held={1}) == {2: 5_000, 3: 5_000}


def test_months_to_target_ignores_the_fully_held_category():
    start = {1: 900_000, 2: 100_000, 3: 0}
    split = held_split({1})
    states = simulate_contributions(start, HELD_TARGETS, 100_000, 24, split)
    assert all(state[1] == 900_000 for state in states)  # a mantida não recebe nada
    month = months_to_target(states, HELD_TARGETS, 100, fully_held={1})
    assert month is not None and month <= 2
    assert max_gap_bps(states[month], HELD_TARGETS, {1}) <= 100
    # Sem informar a categoria mantida, a meta de 0% para ela nunca é atingida.
    assert months_to_target(states, HELD_TARGETS, 100) is None


def test_months_to_target_needs_something_in_the_base():
    states = simulate_contributions({1: 500_000, 2: 0, 3: 0}, HELD_TARGETS, 0, 3, held_split({1}))
    assert months_to_target(states, HELD_TARGETS, 10_000, fully_held={1}) is None


def mark(client, asset, on=True):
    keys = (
        "name",
        "class_key",
        "institution_id",
        "ticker",
        "indexer",
        "rate_bps",
        "maturity_date",
        "quantity",
        "purpose",
        "asset_type",
        "fii_segment",
        "account_id",
        "archived",
    )
    body = {key: asset[key] for key in keys} | {"hold_only": on}
    response = client.put(f"/api/v1/assets/{asset['id']}", json=body)
    assert response.status_code == 200, response.text


def activate_plan(client, rf, rv, acoes_etfs, cripto, name="Plano"):
    plan = client.post(
        "/api/v1/allocation/plans",
        json={
            "name": name,
            "targets": [
                {"class_key": "renda_fixa", "percent_bps": rf},
                {"class_key": "renda_variavel", "percent_bps": rv},
                {"class_key": "acoes_etfs", "percent_bps": acoes_etfs},
                {"class_key": "cripto", "percent_bps": cripto},
            ],
        },
    ).json()
    client.post(f"/api/v1/allocation/plans/{plan['id']}/activate")


def test_trajectory_with_a_fully_held_category(client, make_asset):
    make_asset(name="CDB", class_key="renda_fixa", invested=300_000, current=300_000)
    btc = make_asset(name="BTC", class_key="cripto", invested=700_000, current=700_000)
    mark(client, btc)
    activate_plan(client, rf=5_000, rv=5_000, acoes_etfs=0, cripto=0)

    body = client.post(API, json={"months": 6, "monthly_contribution_cents": 100_000}).json()
    classes = {c["key"]: c for c in body["classes"]}
    assert {k: c["hold_status"] for k, c in classes.items()} == {
        "renda_fixa": "none",
        "renda_variavel": "none",
        "acoes_etfs": "none",
        "cripto": "all",
    }
    assert all("hold_only" not in c for c in classes.values())
    first, last = body["points"][0], body["points"][-1]
    assert first["shares_bps"]["cripto"] == 7_000  # na carteira inteira
    assert "cripto" not in first["base_shares_bps"]
    assert first["base_shares_bps"]["renda_fixa"] == 10_000  # base de R$ 3.000 só tem renda fixa
    assert last["values_cents"]["cripto"] == 700_000  # nunca recebe aportes
    assert last["total_cents"] == 1_000_000 + 6 * 100_000
    assert body["start_gap_bps"] == 5_000  # renda fixa 100% da base contra 50% de meta
    assert body["end_gap_bps"] < body["start_gap_bps"]
    assert body["months_to_target"] is not None


def test_trajectory_exposes_the_effective_targets_of_the_rescale(client, make_asset):
    make_asset(name="CDB", class_key="renda_fixa", invested=10_000, current=10_000)
    a = make_asset(name="A", class_key="renda_variavel", invested=3_000, current=3_000)
    b = make_asset(name="B", class_key="renda_variavel", invested=2_000, current=2_000)
    make_asset(name="BTC", class_key="cripto", invested=1_000, current=1_000)
    mark(client, a)
    activate_plan(client, rf=5_000, rv=3_000, acoes_etfs=0, cripto=2_000)

    def classes():
        body = client.post(API, json={"months": 3, "monthly_contribution_cents": 4_000}).json()
        return {c["key"]: c for c in body["classes"]}

    partial = classes()  # só A mantido: nada é reescalado
    assert partial["renda_variavel"]["hold_status"] == "partial"
    assert [c["effective_target_bps"] for c in partial.values()] == [5_000, 3_000, 0, 2_000]

    mark(client, b)  # renda variável toda mantida: a meta de 30% fica suspensa
    full = classes()
    assert full["renda_variavel"]["hold_status"] == "all"
    assert full["renda_variavel"]["target_bps"] == 3_000  # a gravada continua à vista
    assert [c["effective_target_bps"] for c in full.values()] == [7_143, 0, 0, 2_857]
    assert sum(c["effective_target_bps"] for c in full.values()) == 10_000


def test_trajectory_with_a_partially_held_category_counts_the_held_asset(client, make_asset):
    make_asset(name="CDB", class_key="renda_fixa", invested=10_000, current=10_000)
    a = make_asset(name="A", class_key="renda_variavel", invested=3_000, current=3_000)
    make_asset(name="B", class_key="renda_variavel", invested=2_000, current=2_000)
    make_asset(name="BTC", class_key="cripto", invested=1_000, current=1_000)
    mark(client, a)
    activate_plan(client, rf=5_000, rv=3_000, acoes_etfs=0, cripto=2_000)

    body = client.post(API, json={"months": 1, "monthly_contribution_cents": 4_000}).json()
    first, last = body["points"]
    assert first["values_cents"]["renda_variavel"] == 5_000  # A + B
    assert first["shares_bps"]["renda_variavel"] == 3_125  # carteira toda
    assert first["base_shares_bps"] == first["shares_bps"]  # nenhuma categoria "all": mesma base
    # Rebalanceando (R1): renda fixa 0, renda variável 1.000, cripto 3.000.
    assert last["values_cents"] == {
        "renda_fixa": 10_000,
        "renda_variavel": 6_000,
        "acoes_etfs": 0,
        "cripto": 4_000,
    }


def test_trajectory_without_any_mark_has_the_same_base_as_the_portfolio(client, make_asset):
    make_asset(name="CDB", class_key="renda_fixa", invested=100_000, current=100_000)
    body = client.post(API, json={"months": 2, "monthly_contribution_cents": 20_000}).json()
    assert {c["hold_status"] for c in body["classes"]} == {"none"}
    assert [c["effective_target_bps"] for c in body["classes"]] == [
        c["target_bps"] for c in body["classes"]
    ]
    for point in body["points"]:
        assert point["base_shares_bps"] == point["shares_bps"]


def test_trajectory_with_every_category_fully_held_simulates_without_contribution(
    client, make_asset
):
    assets = [
        make_asset(name="CDB", class_key="renda_fixa", invested=10_000, current=10_000),
        make_asset(name="FII", class_key="renda_variavel", invested=5_000, current=5_000),
        make_asset(name="ETF", class_key="acoes_etfs", invested=3_000, current=3_000),
        make_asset(name="BTC", class_key="cripto", invested=1_000, current=1_000),
    ]
    for asset in assets:
        mark(client, asset)

    response = client.post(API, json={"months": 3, "monthly_contribution_cents": 50_000})

    assert response.status_code == 200, response.text  # antes: 422 e a tela só mostrava o erro
    body = response.json()
    assert body["all_held"] is True
    assert body["monthly_contribution_cents"] == 0  # nenhuma categoria pode receber
    assert {c["hold_status"] for c in body["classes"]} == {"all"}
    assert {c["effective_target_bps"] for c in body["classes"]} == {0}
    # A carteira fica parada: sem aporte a simulação não muda nada.
    assert {p["total_cents"] for p in body["points"]} == {19_000}
    assert body["points"][0]["values_cents"] == body["points"][-1]["values_cents"]
    assert body["start_gap_bps"] == body["end_gap_bps"] == 0
    assert body["months_to_target"] is None


def test_trajectory_all_held_is_false_when_some_category_can_still_receive(client, make_asset):
    cdb = make_asset(name="CDB", class_key="renda_fixa", invested=10_000, current=10_000)
    mark(client, cdb)  # as outras categorias estão vazias ("none") e podem receber
    body = client.post(API, json={"months": 2, "monthly_contribution_cents": 1_000}).json()
    assert body["all_held"] is False
    assert body["monthly_contribution_cents"] == 1_000

    plain = client.post(API, json={"months": 2}).json()
    assert plain["all_held"] is False
