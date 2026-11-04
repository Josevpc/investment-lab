"""Grupos de categorias: só apresentação. A divisão do aporte e a comparação por categoria têm de
ficar idênticas com e sem grupos; o grupo apenas soma as categorias dele."""

import pytest

API = "/api/v1"
GROUPS = f"{API}/asset-groups"
CLASSES = f"{API}/asset-classes"
ALLOCATION = f"{API}/allocation"
ASSET_FIELDS = (
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


def class_of(client, key):
    return next(
        c for c in client.get(CLASSES, params={"include_archived": 1}).json() if c["key"] == key
    )


def create_group(client, name="Renda variável", **extra):
    response = client.post(GROUPS, json={"name": name, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def put_class(client, key, **changes):
    current = class_of(client, key)
    body = {k: current[k] for k in ("name", "color", "archived")} | changes
    return client.put(f"{CLASSES}/{current['id']}", json=body)


def assign(client, group, *keys):
    for key in keys:
        response = put_class(client, key, group_id=group["id"])
        assert response.status_code == 200, response.text


def hold(client, asset, on=True):
    body = {key: asset[key] for key in ASSET_FIELDS} | {"hold_only": on}
    response = client.put(f"{API}/assets/{asset['id']}", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def scenario(client, make_asset, all_held=False):
    """RF 10.000, ação A 3.000 (mantida), ação B 2.000 e cripto 1.000. Metas 50/30/0/20."""
    make_asset(name="CDB", class_key="renda_fixa", invested=10_000, current=10_000)
    a = make_asset(name="Ação A", class_key="renda_variavel", invested=3_000, current=3_000)
    b = make_asset(name="Ação B", class_key="renda_variavel", invested=2_000, current=2_000)
    make_asset(name="BTC", class_key="cripto", invested=1_000, current=1_000)
    hold(client, a)
    if all_held:
        hold(client, b)
    targets = [
        {"class_key": "renda_fixa", "percent_bps": 5_000},
        {"class_key": "renda_variavel", "percent_bps": 3_000},
        {"class_key": "acoes_etfs", "percent_bps": 0},
        {"class_key": "cripto", "percent_bps": 2_000},
    ]
    plan = client.post(f"{ALLOCATION}/plans", json={"name": "50/30/20", "targets": targets}).json()
    client.post(f"{ALLOCATION}/plans/{plan['id']}/activate")


def without_groups(value):
    """O mesmo JSON sem nada de grupo, para comparar com o de uma carteira sem grupos."""
    if isinstance(value, dict):
        return {k: without_groups(v) for k, v in value.items() if k not in ("group_id", "groups")}
    if isinstance(value, list):
        return [without_groups(v) for v in value]
    return value


def allocation_views(client):
    split = {
        mode: client.post(f"{ALLOCATION}/split", json={"amount_cents": 4_000, "mode": mode}).json()
        for mode in ("proportional", "rebalance")
    }
    comparison = client.get(f"{ALLOCATION}/comparison").json()
    trajectory = client.post(f"{API}/analytics/trajectory", json={"months": 6}).json()
    return {"split": split, "comparison": comparison, "trajectory": trajectory}


# ---- CRUD --------------------------------------------------------------------------------


def test_create_and_list_groups(client):
    assert client.get(GROUPS).json() == []

    group = create_group(client, "Renda variável")

    assert group["name"] == "Renda variável" and group["archived"] is False
    assert group["class_ids"] == [] and group["color"].startswith("#")
    assert client.get(GROUPS).json() == [group]


def test_group_color_defaults_to_one_not_used_and_can_be_chosen(client):
    first = create_group(client, "A")
    second = create_group(client, "B")
    chosen = create_group(client, "C", color="#123456")

    assert first["color"] != second["color"]
    assert chosen["color"] == "#123456"
    used = {c["color"].lower() for c in client.get(CLASSES).json()}
    assert first["color"].lower() not in used


def test_group_name_must_be_unique_ignoring_case_and_not_blank(client):
    create_group(client, "Renda variável")

    duplicate = client.post(GROUPS, json={"name": "RENDA VARIÁVEL".lower()})
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Já existe um grupo com esse nome."
    assert client.post(GROUPS, json={"name": "   "}).status_code == 422
    assert client.post(GROUPS, json={"name": "X", "color": "azul"}).status_code == 422


def test_rename_and_recolor_a_group_and_omitted_fields_stay(client):
    group = create_group(client, "Bolsa", color="#111111")
    other = create_group(client, "Outro")

    renamed = client.put(f"{GROUPS}/{group['id']}", json={"name": "Bolsa e FIIs"})
    assert renamed.status_code == 200
    assert (renamed.json()["name"], renamed.json()["color"]) == ("Bolsa e FIIs", "#111111")
    recolored = client.put(f"{GROUPS}/{group['id']}", json={"color": "#222222"})
    assert (recolored.json()["name"], recolored.json()["color"]) == ("Bolsa e FIIs", "#222222")
    # Manter o próprio nome (com outra caixa) não é conflito; o nome de outro grupo é.
    assert client.put(f"{GROUPS}/{group['id']}", json={"name": "BOLSA E FIIS"}).status_code == 200
    clash = client.put(f"{GROUPS}/{group['id']}", json={"name": other["name"].upper()})
    assert clash.status_code == 409


def test_updating_an_unknown_group_is_404(client):
    response = client.put(f"{GROUPS}/999", json={"name": "X"})
    assert response.status_code == 404
    assert response.json()["detail"] == "Grupo não encontrado."


def test_archiving_a_group_frees_its_categories_and_hides_it(client):
    group = create_group(client)
    assign(client, group, "renda_variavel", "acoes_etfs")
    assert client.get(GROUPS).json()[0]["class_ids"] == [
        class_of(client, "renda_variavel")["id"],
        class_of(client, "acoes_etfs")["id"],
    ]

    archived = client.put(f"{GROUPS}/{group['id']}", json={"archived": True})

    assert archived.status_code == 200
    assert archived.json()["archived"] is True and archived.json()["class_ids"] == []
    assert client.get(GROUPS).json() == []
    assert [g["id"] for g in client.get(GROUPS, params={"include_archived": 1}).json()] == [
        group["id"]
    ]
    assert class_of(client, "renda_variavel")["group_id"] is None
    assert class_of(client, "acoes_etfs")["group_id"] is None
    # As categorias seguem na carteira.
    assert {"renda_variavel", "acoes_etfs"} <= {c["key"] for c in client.get(CLASSES).json()}


# ---- categoria dentro do grupo -----------------------------------------------------------


def test_classes_start_without_group_and_group_id_follows_the_put_rules(client):
    assert all(c["group_id"] is None for c in client.get(CLASSES).json())
    group = create_group(client)
    other = create_group(client, "Outro")

    assert put_class(client, "acoes_etfs", group_id=group["id"]).json()["group_id"] == group["id"]
    # Omitir mantém o grupo (o nome muda, o grupo fica).
    kept = put_class(client, "acoes_etfs", name="Ações")
    assert (kept.json()["name"], kept.json()["group_id"]) == ("Ações", group["id"])
    # Trocar de grupo: a categoria fica em um só.
    moved = put_class(client, "acoes_etfs", group_id=other["id"])
    assert moved.json()["group_id"] == other["id"]
    ids = {g["id"]: g["class_ids"] for g in client.get(GROUPS).json()}
    assert ids == {group["id"]: [], other["id"]: [class_of(client, "acoes_etfs")["id"]]}
    # `null` tira do grupo.
    assert put_class(client, "acoes_etfs", group_id=None).json()["group_id"] is None
    assert client.get(GROUPS).json()[1]["class_ids"] == []


def test_a_category_cannot_go_into_an_unknown_or_archived_group(client):
    group = create_group(client)
    client.put(f"{GROUPS}/{group['id']}", json={"archived": True})

    unknown = put_class(client, "cripto", group_id=999)
    archived = put_class(client, "cripto", group_id=group["id"])

    assert unknown.status_code == 422 and unknown.json()["detail"] == "Grupo não encontrado."
    assert archived.status_code == 422 and "arquivado" in archived.json()["detail"]
    assert class_of(client, "cripto")["group_id"] is None


def test_a_new_category_can_be_created_inside_a_group(client):
    group = create_group(client)

    created = client.post(CLASSES, json={"name": "FII", "group_id": group["id"]})

    assert created.status_code == 201 and created.json()["group_id"] == group["id"]
    assert client.post(CLASSES, json={"name": "Outra", "group_id": 999}).status_code == 422


def test_archiving_a_category_keeps_the_group_and_hides_it_from_the_members(client):
    group = create_group(client)
    assign(client, group, "renda_variavel", "acoes_etfs")

    assert put_class(client, "acoes_etfs", archived=True).status_code == 200

    [listed] = client.get(GROUPS).json()
    assert listed["class_ids"] == [class_of(client, "renda_variavel")["id"]]
    assert class_of(client, "acoes_etfs")["group_id"] == group["id"]  # o histórico segue no grupo


# ---- o grupo não muda a divisão nem a comparação -----------------------------------------


@pytest.mark.parametrize("all_held", [False, True])
def test_split_comparison_and_trajectory_are_identical_with_and_without_groups(
    client, make_asset, all_held
):
    scenario(client, make_asset, all_held=all_held)
    before = allocation_views(client)

    group = create_group(client)
    assign(client, group, "renda_variavel", "acoes_etfs")
    after = allocation_views(client)

    assert without_groups(after) == without_groups(before)
    assert before["comparison"]["groups"] == []
    assert after["comparison"]["groups"] != []


def test_the_known_split_examples_still_hold_with_a_group(client, make_asset):
    scenario(client, make_asset)
    assign(client, create_group(client), "renda_variavel", "acoes_etfs")
    amounts = lambda body: {i["class_key"]: i["amount_cents"] for i in body["items"]}  # noqa: E731

    proportional = client.post(f"{ALLOCATION}/split", json={"amount_cents": 4_000}).json()
    assert amounts(proportional) == {
        "renda_fixa": 2_000,
        "renda_variavel": 1_200,
        "acoes_etfs": 0,
        "cripto": 800,
    }

    hold(client, next(a for a in client.get(f"{API}/assets").json() if a["name"] == "Ação B"))
    all_held = client.post(f"{ALLOCATION}/split", json={"amount_cents": 4_000}).json()
    assert amounts(all_held) == {
        "renda_fixa": 2_858,
        "renda_variavel": 0,
        "acoes_etfs": 0,
        "cripto": 1_142,
    }


def test_split_trajectory_and_comparison_items_carry_the_group_id(client, make_asset):
    scenario(client, make_asset)
    group = create_group(client)
    assign(client, group, "renda_variavel")

    split = client.post(f"{ALLOCATION}/split", json={"amount_cents": 4_000}).json()
    comparison = client.get(f"{ALLOCATION}/comparison").json()
    trajectory = client.post(f"{API}/analytics/trajectory", json={"months": 3}).json()

    expected = {
        "renda_fixa": None,
        "renda_variavel": group["id"],
        "acoes_etfs": None,
        "cripto": None,
    }
    assert {i["class_key"]: i["group_id"] for i in split["items"]} == expected
    assert {i["class_key"]: i["group_id"] for i in comparison["items"]} == expected
    assert {c["key"]: c["group_id"] for c in trajectory["classes"]} == expected


# ---- comparação do grupo -----------------------------------------------------------------


def test_group_comparison_sums_a_group_with_a_partially_held_child(client, make_asset):
    # Depois do aporte: CDB 12.000, A 3.000 (mantida), B 3.200 e BTC 1.800 = 20.000.
    make_asset(name="CDB", class_key="renda_fixa", invested=12_000, current=12_000)
    a = make_asset(name="Ação A", class_key="renda_variavel", invested=3_000, current=3_000)
    make_asset(name="Ação B", class_key="renda_variavel", invested=3_200, current=3_200)
    make_asset(name="ETF", class_key="acoes_etfs", invested=1_000, current=1_000)
    make_asset(name="BTC", class_key="cripto", invested=800, current=800)
    hold(client, a)
    targets = [
        {"class_key": "renda_fixa", "percent_bps": 5_000},
        {"class_key": "renda_variavel", "percent_bps": 2_000},
        {"class_key": "acoes_etfs", "percent_bps": 1_000},
        {"class_key": "cripto", "percent_bps": 2_000},
    ]
    plan = client.post(f"{ALLOCATION}/plans", json={"name": "P", "targets": targets}).json()
    client.post(f"{ALLOCATION}/plans/{plan['id']}/activate")
    group = create_group(client)
    assign(client, group, "renda_variavel", "acoes_etfs")

    body = client.get(f"{ALLOCATION}/comparison").json()

    rows = {i["class_key"]: i for i in body["items"]}
    [row] = body["groups"]
    assert row["group_id"] == group["id"] and row["name"] == "Renda variável"
    assert row["color"] == group["color"]
    assert row["class_keys"] == ["renda_variavel", "acoes_etfs"]
    # Total 20.000 (CDB 12.000, RV 6.200, ETF 1.000, BTC 800): o grupo vale 7.200.
    assert row["current_cents"] == 7_200 and row["current_bps"] == 3_600
    assert row["target_bps"] == 3_000 and row["effective_target_bps"] == 3_000
    assert (
        row["diff_cents"] == rows["renda_variavel"]["diff_cents"] + rows["acoes_etfs"]["diff_cents"]
    )
    assert row["diff_cents"] == 7_200 - 6_000
    # Uma filha parcialmente mantida e a outra sem nada mantido: o grupo é "partial".
    assert (rows["renda_variavel"]["hold_status"], rows["acoes_etfs"]["hold_status"]) == (
        "partial",
        "none",
    )
    assert row["hold_status"] == "partial"


def test_group_comparison_with_a_fully_held_child_and_with_every_child_held(client, make_asset):
    scenario(client, make_asset, all_held=True)  # renda_variavel toda mantida
    group = create_group(client)
    assign(client, group, "renda_variavel", "acoes_etfs")

    [row] = client.get(f"{ALLOCATION}/comparison").json()["groups"]
    rows = {i["class_key"]: i for i in client.get(f"{ALLOCATION}/comparison").json()["items"]}

    # Filha toda mantida (meta efetiva 0) e filha vazia (nenhum ativo): "partial".
    assert rows["renda_variavel"]["hold_status"] == "all"
    assert row["hold_status"] == "partial"
    assert row["current_cents"] == 5_000
    assert (row["target_bps"], row["effective_target_bps"]) == (3_000, 0)
    # Só a filha vazia tem diferença (meta efetiva 0 sobre a base sem a mantida).
    assert row["diff_cents"] == rows["acoes_etfs"]["diff_cents"]

    # Com a outra filha também toda mantida, o grupo não tem diferença.
    make_asset_id = client.post(
        f"{API}/assets",
        json={
            "name": "ETF",
            "class_key": "acoes_etfs",
            "institution_id": client.get(f"{API}/institutions").json()[0]["id"],
            "invested_cents": 1_000,
            "current_cents": 1_000,
            "asset_type": "etf",
        },
    ).json()
    hold(client, make_asset_id)
    [row] = client.get(f"{ALLOCATION}/comparison").json()["groups"]
    assert row["hold_status"] == "all" and row["diff_cents"] is None


def test_group_share_is_recomputed_from_the_value_not_summed_from_the_children_bps(
    client, make_asset
):
    for key in ("renda_fixa", "renda_variavel", "acoes_etfs"):
        make_asset(name=key, class_key=key, invested=100, current=100)
    assign(client, create_group(client, "Tudo"), "renda_fixa", "renda_variavel", "acoes_etfs")
    # A carteira tem só as três categorias com valor (a quarta, cripto, não tem ativos).

    body = client.get(f"{ALLOCATION}/comparison").json()

    [row] = body["groups"]
    assert [i["current_bps"] for i in body["items"] if i["class_key"] != "cripto"] == [3_333] * 3
    assert row["current_bps"] == 10_000  # e não 9.999


def test_groups_without_categories_or_with_only_archived_ones_are_not_compared(client, make_asset):
    make_asset(name="CDB", class_key="renda_fixa", invested=100, current=100)
    create_group(client, "Vazio")
    archived_member = create_group(client, "Só arquivada")
    assign(client, archived_member, "acoes_etfs")
    put_class(client, "acoes_etfs", archived=True)

    assert client.get(f"{ALLOCATION}/comparison").json()["groups"] == []


def test_comparison_always_has_a_groups_list(client):
    assert client.get(f"{ALLOCATION}/comparison").json()["groups"] == []


# ---- resumo da carteira ------------------------------------------------------------------


def test_summary_by_group_sums_the_categories_and_leaves_the_ungrouped_out(client, make_asset):
    make_asset(name="CDB", class_key="renda_fixa", invested=60_000, current=70_000)
    make_asset(name="FII", class_key="renda_variavel", invested=10_000, current=12_000)
    make_asset(name="ETF", class_key="acoes_etfs", invested=15_000, current=18_000)
    make_asset(
        name="Reserva", class_key="renda_fixa", invested=5_000, current=5_000, purpose="reserva"
    )
    group = create_group(client)
    assign(client, group, "renda_variavel", "acoes_etfs")

    body = client.get(f"{API}/portfolio/summary").json()

    assert body["by_group"] == [
        {
            "group_id": group["id"],
            "name": "Renda variável",
            "color": group["color"],
            "current_cents": 30_000,
            "invested_cents": 25_000,
            "share_bps": 3_000,  # 30.000 de 100.000 de investimentos (a reserva fica de fora)
        }
    ]
    assert {c["class_key"] for c in body["by_class"]} >= {"renda_fixa", "cripto"}


def test_summary_by_group_is_empty_without_groups_and_the_other_numbers_do_not_change(
    client, make_asset
):
    make_asset(name="FII", class_key="renda_variavel", invested=10_000, current=12_000)
    before = client.get(f"{API}/portfolio/summary").json()
    assert before["by_group"] == []

    assign(client, create_group(client), "renda_variavel")
    after = client.get(f"{API}/portfolio/summary").json()

    assert {k: v for k, v in after.items() if k != "by_group"} == {
        k: v for k, v in before.items() if k != "by_group"
    }


# ---- desempenho do grupo -----------------------------------------------------------------


def typed(client, asset, day, balance):
    response = client.post(
        f"{API}/assets/{asset['id']}/balance", json={"date": day, "balance_cents": balance}
    )
    assert response.status_code == 200, response.text


def performance(client, scope):
    response = client.get(f"{API}/analytics/performance", params={"scope": scope})
    assert response.status_code == 200, response.text
    return response.json()


def test_performance_by_group_covers_only_its_categories(client, make_asset):
    fii = make_asset(
        name="FII", class_key="renda_variavel", invested=1_000_000, current=1_000_000,
        valuation_date="2026-09-01",
    )  # fmt: skip
    etf = make_asset(
        name="ETF", class_key="acoes_etfs", invested=1_000_000, current=1_000_000,
        valuation_date="2026-09-01",
    )  # fmt: skip
    cdb = make_asset(
        name="CDB", class_key="renda_fixa", invested=1_000_000, current=1_000_000,
        valuation_date="2026-09-01",
    )  # fmt: skip
    typed(client, fii, "2026-09-30", 1_100_000)
    typed(client, etf, "2026-09-30", 1_300_000)
    typed(client, cdb, "2026-09-30", 1_010_000)
    group = create_group(client)
    assign(client, group, "renda_variavel", "acoes_etfs")

    body = performance(client, f"group:{group['id']}")

    assert body["scope"] == f"group:{group['id']}" and body["scope_label"] == "Renda variável"
    assert [p["value_cents"] for p in body["points"]] == [2_000_000, 2_400_000]
    assert [p["portfolio_bps"] for p in body["points"]] == [0, 2_000]  # (2,4 / 2,0) - 1
    # As categorias sozinhas seguem como eram.
    assert [p["portfolio_bps"] for p in performance(client, "renda_variavel")["points"]] == [
        0,
        1_000,
    ]
    assert [p["portfolio_bps"] for p in performance(client, "total")["points"]] == [0, 1_367]


def test_performance_of_a_group_follows_its_current_members(client, make_asset):
    fii = make_asset(
        name="FII", class_key="renda_variavel", invested=1_000_000, current=1_000_000,
        valuation_date="2026-09-01",
    )  # fmt: skip
    etf = make_asset(
        name="ETF", class_key="acoes_etfs", invested=1_000_000, current=1_000_000,
        valuation_date="2026-09-01",
    )  # fmt: skip
    typed(client, fii, "2026-09-30", 1_100_000)
    typed(client, etf, "2026-09-30", 1_300_000)
    group = create_group(client)
    assign(client, group, "renda_variavel")
    assert performance(client, f"group:{group['id']}")["points"][1]["portfolio_bps"] == 1_000

    assign(client, group, "acoes_etfs")

    assert performance(client, f"group:{group['id']}")["points"][1]["portfolio_bps"] == 2_000


def test_performance_of_an_unknown_group_is_404_and_a_bad_id_too(client):
    for scope in ("group:999", "group:abc", "group:"):
        response = client.get(f"{API}/analytics/performance", params={"scope": scope})
        assert response.status_code == 404, scope
    assert response.json()["detail"] == "Grupo desconhecido."


def test_performance_of_a_group_leaves_the_reserve_out(client, make_asset):
    reserve = make_asset(
        name="Reserva", class_key="renda_variavel", invested=500_000, current=500_000,
        purpose="reserva", valuation_date="2026-09-01",
    )  # fmt: skip
    fii = make_asset(
        name="FII", class_key="renda_variavel", invested=1_000_000, current=1_000_000,
        valuation_date="2026-09-01",
    )  # fmt: skip
    typed(client, reserve, "2026-09-30", 900_000)
    typed(client, fii, "2026-09-30", 1_100_000)
    group = create_group(client)
    assign(client, group, "renda_variavel")

    body = performance(client, f"group:{group['id']}")

    assert [p["value_cents"] for p in body["points"]] == [1_000_000, 1_100_000]
