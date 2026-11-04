API = "/api/v1/allocation"
CLASSES = "/api/v1/asset-classes"


def targets(rf=5_000, rv=1_000, acoes_etfs=3_000, cripto=1_000):
    return [
        {"class_key": "renda_fixa", "percent_bps": rf},
        {"class_key": "renda_variavel", "percent_bps": rv},
        {"class_key": "acoes_etfs", "percent_bps": acoes_etfs},
        {"class_key": "cripto", "percent_bps": cripto},
    ]


def class_id(client, key):
    return next(c["id"] for c in client.get(CLASSES).json() if c["key"] == key)


def test_default_plan_is_seeded_active_and_sums_to_100(client):
    plans = client.get(f"{API}/plans").json()
    assert len(plans) == 1
    assert plans[0]["is_active"] is True
    assert [(t["class_key"], t["percent_bps"]) for t in plans[0]["targets"]] == [
        ("renda_fixa", 2_500),
        ("renda_variavel", 2_500),
        ("acoes_etfs", 2_500),
        ("cripto", 2_500),
    ]


def test_create_plan_validates_sum(client):
    ok = client.post(f"{API}/plans", json={"name": "Agressivo", "targets": targets()})
    assert ok.status_code == 201
    assert ok.json()["is_active"] is False

    bad = client.post(f"{API}/plans", json={"name": "Quebrado", "targets": targets(rf=4_000)})
    assert bad.status_code == 422
    assert "somam 90,00%" in bad.json()["detail"]


def test_plan_name_must_be_unique_and_class_known(client):
    assert (
        client.post(f"{API}/plans", json={"name": "Plano padrão", "targets": targets()}).status_code
        == 409
    )
    unknown = [{"class_key": "ouro", "percent_bps": 10_000}]
    assert client.post(f"{API}/plans", json={"name": "X", "targets": unknown}).status_code == 422


def test_update_activate_and_delete_plan(client):
    plan = client.post(f"{API}/plans", json={"name": "Novo", "targets": targets()}).json()

    updated = client.put(
        f"{API}/plans/{plan['id']}",
        json={"name": "Novo v2", "targets": targets(rf=6_000, acoes_etfs=2_000)},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Novo v2"
    assert updated.json()["targets"][0]["percent_bps"] == 6_000

    activated = client.post(f"{API}/plans/{plan['id']}/activate")
    assert activated.json()["is_active"] is True
    assert [p["is_active"] for p in client.get(f"{API}/plans").json()] == [False, True]

    assert client.delete(f"{API}/plans/{plan['id']}").status_code == 409  # ativo
    first = client.get(f"{API}/plans").json()[0]
    assert client.delete(f"{API}/plans/{first['id']}").status_code == 204
    assert client.get(f"{API}/plans/{first['id']}").status_code == 404


def test_split_proportional_uses_active_plan(client):
    plan = client.post(f"{API}/plans", json={"name": "Meu plano", "targets": targets()}).json()
    client.post(f"{API}/plans/{plan['id']}/activate")

    result = client.post(f"{API}/split", json={"amount_cents": 80_000}).json()
    amounts = {i["class_key"]: i["amount_cents"] for i in result["items"]}
    assert amounts == {
        "renda_fixa": 40_000,
        "renda_variavel": 8_000,
        "acoes_etfs": 24_000,
        "cripto": 8_000,
    }
    assert sum(amounts.values()) == result["amount_cents"]


def test_split_rebalance_moves_money_away_from_overweight_class(client, make_asset):
    make_asset(name="CDB", class_key="renda_fixa", invested=1_000_000, current=1_000_000)
    plan = client.post(f"{API}/plans", json={"name": "Meu plano", "targets": targets()}).json()

    result = client.post(
        f"{API}/split",
        json={"amount_cents": 100_000, "plan_id": plan["id"], "mode": "rebalance"},
    ).json()
    amounts = {i["class_key"]: i["amount_cents"] for i in result["items"]}
    assert amounts["renda_fixa"] == 0
    assert sum(amounts.values()) == 100_000


def test_comparison_real_vs_target(client, make_asset):
    make_asset(name="CDB", class_key="renda_fixa", invested=800_000, current=800_000)
    make_asset(name="PETR4", class_key="acoes_etfs", invested=200_000, current=200_000)
    plan = client.post(f"{API}/plans", json={"name": "Meu plano", "targets": targets()}).json()
    client.post(f"{API}/plans/{plan['id']}/activate")

    body = client.get(f"{API}/comparison").json()
    assert body["total_cents"] == 1_000_000
    rows = {i["class_key"]: i for i in body["items"]}
    assert rows["renda_fixa"]["current_bps"] == 8_000
    assert rows["renda_fixa"]["hold_status"] == "none"
    assert rows["renda_fixa"]["diff_cents"] == 300_000
    assert rows["cripto"]["diff_cents"] == -100_000


def test_new_category_enters_every_plan_with_zero_percent(client):
    client.post(f"{API}/plans", json={"name": "Outro", "targets": targets()})
    assert client.post(CLASSES, json={"name": "FIIs"}).status_code == 201

    for plan in client.get(f"{API}/plans").json():
        by_key = {t["class_key"]: t["percent_bps"] for t in plan["targets"]}
        assert by_key["fiis"] == 0
        assert sum(by_key.values()) == 10_000


def test_archiving_a_category_redistributes_its_percent(client):
    plan = client.post(f"{API}/plans", json={"name": "Meu plano", "targets": targets()}).json()
    client.post(f"{API}/plans/{plan['id']}/activate")

    cripto = class_id(client, "cripto")
    archived = client.put(
        f"{CLASSES}/{cripto}", json={"name": "Criptomoedas", "color": "#db2777", "archived": True}
    )
    assert archived.status_code == 200

    for p in client.get(f"{API}/plans").json():
        by_key = {t["class_key"]: t["percent_bps"] for t in p["targets"]}
        assert "cripto" not in by_key
        assert sum(by_key.values()) == 10_000
    mine = next(p for p in client.get(f"{API}/plans").json() if p["name"] == "Meu plano")
    # 50/10/30 reajustados proporcionalmente para 100%: renda fixa continua a maior fatia.
    shares = {t["class_key"]: t["percent_bps"] for t in mine["targets"]}
    assert shares["renda_fixa"] > shares["acoes_etfs"] > shares["renda_variavel"]


def test_archived_category_cannot_be_targeted(client):
    cripto = class_id(client, "cripto")
    client.put(
        f"{CLASSES}/{cripto}", json={"name": "Criptomoedas", "color": "#db2777", "archived": True}
    )
    response = client.post(f"{API}/plans", json={"name": "Com cripto", "targets": targets()})
    assert response.status_code == 422


# ---- manter posição (marca do ativo) -----------------------------------------------------

ASSETS = "/api/v1/assets"
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


def put_asset(client, asset, **changes):
    """Edita o ativo reenviando o que ele já tem, trocando só `changes`."""
    body = {key: asset[key] for key in ASSET_FIELDS} | {"hold_only": asset["hold_only"]}
    return client.put(f"{ASSETS}/{asset['id']}", json=body | changes)


def hold(client, asset, on=True):
    response = put_asset(client, asset, hold_only=on)
    assert response.status_code == 200, response.text
    return response.json()


def archive(client, key):
    response = client.put(
        f"{CLASSES}/{class_id(client, key)}",
        json={"name": key, "color": "#db2777", "archived": True},
    )
    assert response.status_code == 200, response.text


def scenario_targets(rf=5_000, rv=3_000, acoes_etfs=0, cripto=2_000):
    return targets(rf=rf, rv=rv, acoes_etfs=acoes_etfs, cripto=cripto)


def scenario(client, make_asset):
    """RF 10.000, ação A 3.000 (mantida), ação B 2.000 e cripto 1.000, em centavos. Metas
    50/30/20 (renda fixa, renda variável e cripto) no plano ativo."""
    rf = make_asset(name="CDB", class_key="renda_fixa", invested=10_000, current=10_000)
    a = make_asset(name="Ação A", class_key="renda_variavel", invested=3_000, current=3_000)
    b = make_asset(name="Ação B", class_key="renda_variavel", invested=2_000, current=2_000)
    cripto = make_asset(name="BTC", class_key="cripto", invested=1_000, current=1_000)
    a = hold(client, a)
    plan = client.post(f"{API}/plans", json={"name": "50/30/20", "targets": scenario_targets()})
    assert plan.status_code == 201, plan.text
    client.post(f"{API}/plans/{plan.json()['id']}/activate")
    return {"rf": rf, "a": a, "b": b, "cripto": cripto}


def split(client, amount=4_000, mode="proportional", **extra):
    response = client.post(f"{API}/split", json={"amount_cents": amount, "mode": mode, **extra})
    assert response.status_code == 200, response.text
    body = response.json()
    assert sum(i["amount_cents"] for i in body["items"]) == amount  # sempre o aporte exato
    return {i["class_key"]: i for i in body["items"]}


def amounts(items):
    return {key: item["amount_cents"] for key, item in items.items()}


def test_plan_has_no_hold_flag_and_ignores_the_old_one(client):
    plan = client.post(f"{API}/plans", json={"name": "Comum", "targets": targets()}).json()
    assert all("hold_only" not in t for t in plan["targets"])
    old_style = [{**t, "hold_only": True} for t in targets()]
    created = client.post(f"{API}/plans", json={"name": "Antigo", "targets": old_style})
    assert created.status_code == 201
    assert all("hold_only" not in t for t in created.json()["targets"])


def test_plan_still_needs_100_percent_on_every_category(client):
    response = client.post(f"{API}/plans", json={"name": "X", "targets": targets(rf=4_000)})
    assert response.status_code == 422
    assert response.json()["detail"] == "As metas devem somar 100%, mas somam 90,00%."


def test_proportional_split_with_a_partially_held_category(client, make_asset):
    scenario(client, make_asset)
    items = split(client)
    assert amounts(items) == {
        "renda_fixa": 2_000,
        "renda_variavel": 1_200,
        "acoes_etfs": 0,
        "cripto": 800,
    }
    rv = items["renda_variavel"]
    assert rv["hold_status"] == "partial"
    assert [a["name"] for a in rv["receiving_assets"]] == ["Ação B"]
    assert [(a["name"], a["current_cents"]) for a in rv["held_assets"]] == [("Ação A", 3_000)]
    assert (rv["target_bps"], rv["effective_target_bps"]) == (3_000, 3_000)
    assert rv["current_cents"] == 5_000  # o ativo mantido conta no valor da categoria
    assert items["renda_fixa"]["hold_status"] == "none"
    assert items["renda_fixa"]["held_assets"] == []
    assert all("hold_only" not in item for item in items.values())


def test_comparison_with_a_partially_held_category(client, make_asset):
    # Carteira depois do aporte: CDB 12.000, A 3.000 (mantida), B 3.200 e BTC 1.800 = 20.000.
    make_asset(name="CDB", class_key="renda_fixa", invested=12_000, current=12_000)
    a = make_asset(name="Ação A", class_key="renda_variavel", invested=3_000, current=3_000)
    make_asset(name="Ação B", class_key="renda_variavel", invested=3_200, current=3_200)
    make_asset(name="BTC", class_key="cripto", invested=1_800, current=1_800)
    hold(client, a)
    plan = client.post(f"{API}/plans", json={"name": "P", "targets": scenario_targets()}).json()
    client.post(f"{API}/plans/{plan['id']}/activate")

    body = client.get(f"{API}/comparison").json()
    assert (body["total_cents"], body["base_cents"]) == (20_000, 20_000)
    rows = {i["class_key"]: i for i in body["items"]}
    assert rows["renda_fixa"]["current_bps"] == 6_000
    assert rows["renda_variavel"]["current_bps"] == 3_100  # A 1.500 + B 1.600, da carteira toda
    assert rows["cripto"]["current_bps"] == 900
    assert rows["renda_variavel"]["hold_status"] == "partial"
    assert rows["renda_variavel"]["held_assets"] == [
        {"asset_id": a["id"], "name": "Ação A", "current_cents": 3_000}
    ]
    assert rows["renda_variavel"]["effective_target_bps"] == 3_000
    # 30% de 20.000 = 6.000: a categoria (A + B = 6.200) está R$ 2,00 acima.
    assert rows["renda_variavel"]["diff_cents"] == 200
    assert rows["renda_fixa"]["diff_cents"] == 2_000
    for row in body["items"]:
        assert not {"base_bps", "diff_bps", "hold_only"} & row.keys()


def test_rebalance_counts_the_held_asset_in_its_category(client, make_asset):
    scenario(client, make_asset)
    assert amounts(split(client, mode="rebalance")) == {
        "renda_fixa": 0,
        "renda_variavel": 1_000,
        "acoes_etfs": 0,
        "cripto": 3_000,
    }


def test_category_with_every_asset_held_gets_nothing_and_the_others_are_rescaled(
    client, make_asset
):
    assets = scenario(client, make_asset)
    hold(client, assets["b"])  # agora a renda variável inteira está mantida

    proportional = split(client)
    assert amounts(proportional) == {
        "renda_fixa": 2_858,  # RN-02: o centavo de arredondamento vai para a maior fatia
        "renda_variavel": 0,
        "acoes_etfs": 0,
        "cripto": 1_142,
    }
    rv = proportional["renda_variavel"]
    assert (rv["hold_status"], rv["effective_target_bps"], rv["target_bps"]) == ("all", 0, 3_000)
    assert rv["receiving_assets"] == []
    assert sorted(a["name"] for a in rv["held_assets"]) == ["Ação A", "Ação B"]
    assert proportional["renda_fixa"]["effective_target_bps"] == 7_143
    assert proportional["cripto"]["effective_target_bps"] == 2_857

    # Rebalancear: base de 15.000 (sem a renda variável, que vale 5.000).
    assert amounts(split(client, mode="rebalance")) == {
        "renda_fixa": 714,
        "renda_variavel": 0,
        "acoes_etfs": 0,
        "cripto": 3_286,
    }


def test_fully_held_category_keeps_its_stored_target_and_the_plan_stays_valid(client, make_asset):
    assets = scenario(client, make_asset)
    hold(client, assets["b"])
    plan = next(p for p in client.get(f"{API}/plans").json() if p["name"] == "50/30/20")
    stored = {t["class_key"]: t["percent_bps"] for t in plan["targets"]}
    assert stored["renda_variavel"] == 3_000 and sum(stored.values()) == 10_000

    body = {"name": "50/30/20", "targets": scenario_targets()}
    assert client.put(f"{API}/plans/{plan['id']}", json=body).status_code == 200
    # Meta 0% na categoria toda mantida também é válida, desde que tudo some 100%.
    ok = scenario_targets(rf=7_000, rv=0, cripto=3_000)
    assert client.put(f"{API}/plans/{plan['id']}", json={**body, "targets": ok}).status_code == 200


def test_reading_plans_never_rewrites_stored_targets(client, make_asset):
    # Plano ativo 50/30/20 e um inativo com renda variável em 20%; a marca dos ativos não pode
    # mexer em nenhum dos dois, nem ao listar, abrir, dividir ou comparar.
    assets = scenario(client, make_asset)
    other = client.post(
        f"{API}/plans",
        json={"name": "Inativo", "targets": scenario_targets(rf=5_000, rv=2_000, cripto=3_000)},
    ).json()
    hold(client, assets["b"])  # renda variável toda mantida
    before = client.get(f"{API}/plans").json()

    client.get(f"{API}/plans/{other['id']}")
    split(client)
    client.get(f"{API}/comparison", params={"plan_id": other["id"]})
    after = client.get(f"{API}/plans").json()

    assert after == before
    by_name = {p["name"]: {t["class_key"]: t["percent_bps"] for t in p["targets"]} for p in after}
    assert by_name["Inativo"]["renda_variavel"] == 2_000
    assert by_name["50/30/20"]["renda_variavel"] == 3_000
    assert sum(by_name["50/30/20"].values()) == 10_000


def test_saving_a_plan_does_not_change_the_asset_marks(client, make_asset):
    assets = scenario(client, make_asset)
    plan = next(p for p in client.get(f"{API}/plans").json() if p["name"] == "50/30/20")
    marks = {a["name"]: a["hold_only"] for a in client.get(ASSETS).json()}
    assert marks["Ação A"] is True

    client.put(
        f"{API}/plans/{plan['id']}",
        json={"name": "50/30/20", "targets": scenario_targets(rf=6_000, rv=2_000)},
    )
    client.post(f"{API}/plans", json={"name": "Outro", "targets": targets()})

    assert {a["name"]: a["hold_only"] for a in client.get(ASSETS).json()} == marks
    assert assets["a"]["hold_only"] is True


def test_every_category_fully_held_refuses_a_contribution(client, make_asset):
    assets = scenario(client, make_asset)
    etf = make_asset(name="ETF", class_key="acoes_etfs", invested=500, current=500)
    for asset in (assets["rf"], assets["b"], assets["cripto"], etf):
        hold(client, asset)
    response = client.post(f"{API}/split", json={"amount_cents": 1_000})
    assert response.status_code == 422
    assert "Desmarque algum ativo" in response.json()["detail"]
    assert response.json()["code"] == "all_held"  # código estável para a tela
    zero = client.post(f"{API}/split", json={"amount_cents": 0})
    assert zero.status_code == 200
    assert {i["amount_cents"] for i in zero.json()["items"]} == {0}


def test_split_with_month_uses_the_same_rule(client, make_asset):
    assets = scenario(client, make_asset)
    hold(client, assets["b"])
    items = split(client, amount=4_000, mode="rebalance", month="2026-10")
    assert items["renda_variavel"]["amount_cents"] == 0
    assert items["renda_variavel"]["hold_status"] == "all"


def test_split_sums_to_the_contribution_in_many_scenarios(client, make_asset):
    assets = scenario(client, make_asset)
    for amount in (0, 1, 7, 999, 4_000, 123_457):
        for mode in ("proportional", "rebalance"):
            split(client, amount=amount, mode=mode)  # a soma é conferida dentro de `split`
    hold(client, assets["b"])
    hold(client, assets["rf"])
    for amount in (1, 7, 999, 4_000, 123_457):
        for mode in ("proportional", "rebalance"):
            items = split(client, amount=amount, mode=mode)
            assert items["renda_variavel"]["amount_cents"] == 0
            assert items["renda_fixa"]["amount_cents"] == 0


def test_category_without_assets_is_none_and_gets_its_target(client, make_asset):
    make_asset(name="CDB", class_key="renda_fixa", invested=10_000, current=10_000)
    items = split(client)  # plano padrão: 25% cada
    assert {i["hold_status"] for i in items.values()} == {"none"}
    assert amounts(items) == {k: 1_000 for k in items}
    assert items["cripto"]["receiving_assets"] == [] and items["cripto"]["held_assets"] == []


def test_archived_and_reserve_assets_stay_out_of_the_hold_status(client, make_asset):
    cdb = make_asset(name="CDB", class_key="renda_fixa", invested=10_000, current=10_000)
    reserve = make_asset(
        name="Reserva", class_key="renda_fixa", invested=5_000, current=5_000, purpose="reserva"
    )
    old = make_asset(name="Velho", class_key="renda_fixa", invested=1_000, current=1_000)
    assert put_asset(client, old, archived=True).status_code == 200
    items = split(client)
    rf = items["renda_fixa"]
    assert rf["hold_status"] == "none"
    assert [a["name"] for a in rf["receiving_assets"]] == ["CDB"]  # sem a reserva nem o arquivado
    hold(client, cdb)
    assert split(client)["renda_fixa"]["hold_status"] == "all"
    assert reserve["hold_only"] is False


def test_archiving_the_category_with_the_held_assets_just_removes_it(client, make_asset):
    a = make_asset(name="BTC", class_key="cripto", invested=500_000, current=500_000)
    hold(client, a)
    plan = client.get(f"{API}/plans").json()[0]
    put_asset(client, client.get(f"{ASSETS}/{a['id']}").json(), archived=True, hold_only=False)
    archive(client, "cripto")

    mine = client.get(f"{API}/plans/{plan['id']}").json()
    assert "cripto" not in {t["class_key"] for t in mine["targets"]}
    assert sum(t["percent_bps"] for t in mine["targets"]) == 10_000


def test_new_category_enters_every_plan_with_zero_percent_and_no_hold(client, make_asset):
    scenario(client, make_asset)
    assert client.post(CLASSES, json={"name": "FIIs"}).status_code == 201
    for plan in client.get(f"{API}/plans").json():
        by_key = {t["class_key"]: t["percent_bps"] for t in plan["targets"]}
        assert by_key["fiis"] == 0
        assert sum(by_key.values()) == 10_000
    assert split(client)["fiis"]["hold_status"] == "none"


def test_sync_does_not_touch_a_plan_that_is_already_consistent(client, make_asset):
    assets = scenario(client, make_asset)
    hold(client, assets["b"])
    before = client.get(f"{API}/plans").json()
    assert client.get(f"{API}/plans").json() == before
