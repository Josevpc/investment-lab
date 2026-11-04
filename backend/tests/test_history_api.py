API = "/api/v1"


def test_snapshot_requires_assets(client):
    response = client.post(f"{API}/snapshots", json={"date": "2026-01-31"})
    assert response.status_code == 422


def test_create_snapshot_from_current_portfolio(client, make_asset):
    make_asset(name="CDB", class_key="renda_fixa", invested=900_000, current=1_000_000)
    make_asset(name="BTC", class_key="cripto", invested=100_000, current=150_000)

    response = client.post(f"{API}/snapshots", json={"date": "2026-01-31"})
    assert response.status_code == 201
    body = response.json()
    assert body["total_cents"] == 1_150_000
    assert body["invested_cents"] == 1_000_000
    assert body["assets_count"] == 2
    assert {c["class_key"]: c["current_cents"] for c in body["by_class"]} == {
        "renda_fixa": 1_000_000,
        "cripto": 150_000,
    }


def test_snapshot_without_body_uses_today_and_is_unique_per_date(client, make_asset):
    make_asset()
    assert client.post(f"{API}/snapshots").status_code == 201
    assert client.post(f"{API}/snapshots").status_code == 409


def test_snapshot_is_not_affected_by_later_changes(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000)
    client.post(f"{API}/snapshots", json={"date": "2026-01-31"})
    client.post(
        f"{API}/assets/{asset['id']}/valuations",
        json={"date": "2026-02-28", "invested_cents": 100_000, "current_cents": 500_000},
    )
    snapshot = client.get(f"{API}/snapshots").json()[0]
    assert snapshot["total_cents"] == 100_000


def test_list_and_delete_snapshots(client, make_asset):
    make_asset()
    first = client.post(f"{API}/snapshots", json={"date": "2026-01-31"}).json()
    client.post(f"{API}/snapshots", json={"date": "2026-02-28"})

    assert [s["date"] for s in client.get(f"{API}/snapshots").json()] == [
        "2026-02-28",
        "2026-01-31",
    ]
    assert client.delete(f"{API}/snapshots/{first['id']}").status_code == 204
    assert client.delete(f"{API}/snapshots/{first['id']}").status_code == 404
    assert len(client.get(f"{API}/snapshots").json()) == 1


def test_evolution_separates_contributions_from_appreciation(client, make_asset):
    asset = make_asset(
        name="CDB",
        class_key="renda_fixa",
        invested=1_000_000,
        current=1_000_000,
        valuation_date="2026-01-31",
    )
    client.post(f"{API}/snapshots", json={"date": "2026-01-31"})

    # Fev e mar: aportes de R$ 500 e R$ 700 e valorização do restante.
    client.put(f"{API}/contributions/2026-02", json={"salary_cents": 500_000, "percent_bps": 1_000})
    client.put(f"{API}/contributions/2026-03", json={"salary_cents": 700_000, "percent_bps": 1_000})
    client.put(f"{API}/contributions/2026-01", json={"salary_cents": 999_999, "percent_bps": 1_000})
    client.post(
        f"{API}/assets/{asset['id']}/valuations",
        json={"date": "2026-03-31", "invested_cents": 1_120_000, "current_cents": 1_300_000},
    )
    client.post(f"{API}/snapshots", json={"date": "2026-03-31"})

    body = client.get(f"{API}/history/evolution").json()
    assert [p["date"] for p in body["points"]] == ["2026-01-31", "2026-03-31"]
    assert body["points"][1]["by_class"]["renda_fixa"] == 1_300_000

    summary = body["summary"]
    assert summary["change_cents"] == 300_000
    assert summary["contributions_cents"] == 120_000  # fev + mar; jan já estava no 1º snapshot
    assert summary["appreciation_cents"] == 180_000
    # Sem nada lançado no diário, tudo vem do plano: é estimativa e a resposta avisa os meses.
    assert summary["contributions_source"] == "planejado"
    assert summary["estimated_months"] == ["2026-02", "2026-03"]


def test_evolution_filters_by_period_and_handles_few_points(client, make_asset):
    asset = make_asset(valuation_date="2026-01-31")
    client.post(
        f"{API}/assets/{asset['id']}/valuations",
        json={"date": "2026-06-30", "invested_cents": 100_000, "current_cents": 120_000},
    )

    only_second = client.get(f"{API}/history/evolution", params={"from": "2026-03-01"}).json()
    assert [p["date"] for p in only_second["points"]] == ["2026-06-30"]
    assert only_second["summary"] is None
    assert len(only_second["classes"]) == 4


# ---- histórico digitado à mão ------------------------------------------------------------


def manual(date, **values):
    """Snapshot digitado: values mapeia categoria -> (investido, atual) em centavos."""
    return {
        "date": date,
        "items": [
            {"class_key": key, "invested_cents": inv, "current_cents": cur}
            for key, (inv, cur) in values.items()
        ],
    }


def test_manual_snapshot_without_any_assets(client):
    body = manual("2025-12-31", cripto=(100_000, 600_000), renda_fixa=(200_000, 400_000))
    response = client.post(f"{API}/snapshots", json=body)
    assert response.status_code == 201
    snapshot = response.json()
    assert snapshot["manual"] is True
    assert snapshot["assets_count"] == 0
    assert snapshot["total_cents"] == 1_000_000
    assert snapshot["invested_cents"] == 300_000
    assert {c["class_key"]: c["current_cents"] for c in snapshot["by_class"]} == {
        "renda_fixa": 400_000,
        "cripto": 600_000,
    }


def test_manual_snapshot_validation(client):
    unknown = manual("2025-12-31", ouro=(1, 1))
    assert client.post(f"{API}/snapshots", json=unknown).status_code == 422

    duplicated = {
        "date": "2025-12-31",
        "items": [
            {"class_key": "cripto", "invested_cents": 1, "current_cents": 1},
            {"class_key": "cripto", "invested_cents": 2, "current_cents": 2},
        ],
    }
    assert client.post(f"{API}/snapshots", json=duplicated).status_code == 422

    ok = manual("2025-12-31", cripto=(1, 1))
    assert client.post(f"{API}/snapshots", json=ok).status_code == 201
    assert client.post(f"{API}/snapshots", json=ok).status_code == 409


def test_update_snapshot_replaces_values_and_date(client):
    created = client.post(f"{API}/snapshots", json=manual("2025-12-31", cripto=(1, 100))).json()

    updated = client.put(
        f"{API}/snapshots/{created['id']}",
        json=manual("2026-01-31", cripto=(1, 300), renda_fixa=(1, 700)),
    )
    assert updated.status_code == 200
    assert updated.json()["date"] == "2026-01-31"
    assert updated.json()["total_cents"] == 1_000
    assert len(client.get(f"{API}/snapshots").json()) == 1

    other = client.post(f"{API}/snapshots", json=manual("2026-02-28", cripto=(1, 1))).json()
    clash = client.put(f"{API}/snapshots/{other['id']}", json=manual("2026-01-31", cripto=(1, 1)))
    assert clash.status_code == 409
    assert (
        client.put(f"{API}/snapshots/999", json=manual("2026-03-31", cripto=(1, 1))).status_code
        == 404
    )
    empty = {"date": "2026-03-31", "items": []}
    assert client.put(f"{API}/snapshots/{other['id']}", json=empty).status_code == 422


def reserve_snapshot(date, reserve, reserve_invested=None, **values):
    body = {**manual(date, **values), "reserve_cents": reserve}
    if reserve_invested is not None:
        body["reserve_invested_cents"] = reserve_invested
    return body


def test_manual_snapshot_can_carry_the_invested_amount_of_the_reserve(client):
    created = client.post(
        f"{API}/snapshots",
        json=reserve_snapshot("2026-01-31", 1_100_000, 1_000_000, cripto=(100, 100)),
    ).json()
    assert created["invested_cents"] == 1_000_100
    assert created["total_cents"] == 1_100_100

    # Sem informar, o investido da reserva é igual ao atual (comportamento de sempre).
    plain = client.post(
        f"{API}/snapshots", json=reserve_snapshot("2026-02-28", 500_000, cripto=(100, 100))
    ).json()
    assert plain["invested_cents"] == 500_100


def test_editing_a_snapshot_keeps_the_invested_amount_of_the_reserve(client):
    created = client.post(
        f"{API}/snapshots",
        json=reserve_snapshot("2026-01-31", 1_100_000, 1_000_000, cripto=(100, 100)),
    ).json()

    # Corrigir só a data e um valor de categoria: a reserva rendeu 100 mil e continua rendendo.
    edited = client.put(
        f"{API}/snapshots/{created['id']}",
        json=reserve_snapshot("2026-01-30", 1_100_000, cripto=(100, 150)),
    ).json()
    assert edited["invested_cents"] == 1_000_100
    assert edited["total_cents"] == 1_100_150

    # Corrigir o valor da reserva também não mexe no que foi investido.
    corrected = client.put(
        f"{API}/snapshots/{created['id']}",
        json=reserve_snapshot("2026-01-30", 1_120_000, cripto=(100, 150)),
    ).json()
    assert corrected["invested_cents"] == 1_000_100


def test_invested_reserve_without_a_reserve_is_ignored(client):
    created = client.post(
        f"{API}/snapshots", json=reserve_snapshot("2026-01-31", 0, 500_000, cripto=(100, 100))
    ).json()
    assert created["invested_cents"] == 100  # nada de investido fantasma

    edited = client.put(
        f"{API}/snapshots/{created['id']}",
        json=reserve_snapshot("2026-01-31", 0, 500_000, cripto=(100, 100)),
    ).json()
    assert edited["invested_cents"] == 100


def test_editing_can_set_the_invested_amount_of_the_reserve_explicitly(client):
    created = client.post(
        f"{API}/snapshots", json=reserve_snapshot("2026-01-31", 1_100_000, cripto=(100, 100))
    ).json()
    edited = client.put(
        f"{API}/snapshots/{created['id']}",
        json=reserve_snapshot("2026-01-31", 1_100_000, 1_050_000, cripto=(100, 100)),
    ).json()
    assert edited["invested_cents"] == 1_050_100


def test_adding_or_removing_the_reserve_in_an_edit_has_no_yield_to_keep(client):
    without = client.post(f"{API}/snapshots", json=manual("2026-01-31", cripto=(100, 100))).json()
    added = client.put(
        f"{API}/snapshots/{without['id']}",
        json=reserve_snapshot("2026-01-31", 200_000, cripto=(100, 100)),
    ).json()
    assert added["invested_cents"] == 200_100  # investido = atual

    removed = client.put(
        f"{API}/snapshots/{without['id']}",
        json=reserve_snapshot("2026-01-31", 0, cripto=(100, 100)),
    ).json()
    assert removed["invested_cents"] == 100


def test_snapshot_exposes_the_invested_amount_of_the_reserve(client):
    # Na criação, na edição e na listagem: a tela de edição pré-preenche o valor atual da reserva.
    created = client.post(
        f"{API}/snapshots",
        json=reserve_snapshot("2026-01-31", 1_100_000, 1_000_000, cripto=(100, 100)),
    ).json()
    assert created["reserve_invested_cents"] == 1_000_000
    assert created["invested_cents"] == 1_000_100  # categorias (100) + reserva (1.000.000)

    listed = client.get(f"{API}/snapshots").json()
    assert [s["reserve_invested_cents"] for s in listed] == [1_000_000]

    edited = client.put(
        f"{API}/snapshots/{created['id']}",
        json=reserve_snapshot("2026-01-31", 1_100_000, 1_050_000, cripto=(100, 150)),
    ).json()
    assert edited["reserve_invested_cents"] == 1_050_000

    # Sem reserva, é zero: o investido total é só o das categorias.
    plain = client.post(f"{API}/snapshots", json=manual("2026-02-28", cripto=(100, 100))).json()
    assert plain["reserve_cents"] == 0 and plain["reserve_invested_cents"] == 0


def test_snapshots_do_not_feed_the_evolution(client):
    client.post(f"{API}/snapshots", json=manual("2025-10-31", cripto=(1, 600_000)))
    client.post(f"{API}/snapshots", json=manual("2026-04-30", cripto=(1, 450_000)))

    body = client.get(f"{API}/history/evolution").json()

    assert body["points"] == [] and body["summary"] is None
    assert len(client.get(f"{API}/snapshots").json()) == 2  # a foto continua existindo


def test_evolution_has_one_point_per_date_with_a_typed_balance(client, make_asset):
    cripto = make_asset(
        name="BTC", class_key="cripto", invested=1, current=600_000, valuation_date="2025-10-31"
    )
    renda = make_asset(
        name="CDB", class_key="renda_fixa", invested=1, current=400_000, valuation_date="2025-10-31"
    )
    for asset, day, current in ((cripto, "2026-04-30", 450_000), (renda, "2026-04-30", 800_000)):
        body = {"date": day, "invested_cents": 1, "current_cents": current}
        client.post(f"{API}/assets/{asset['id']}/valuations", json=body)
    # Uma data só da renda fixa: a cripto mantém o último valor conhecido.
    client.post(
        f"{API}/assets/{renda['id']}/valuations",
        json={"date": "2026-05-15", "invested_cents": 1, "current_cents": 810_000},
    )

    body = client.get(f"{API}/history/evolution").json()

    assert [p["date"] for p in body["points"]] == ["2025-10-31", "2026-04-30", "2026-05-15"]
    assert [p["by_class"]["cripto"] for p in body["points"]] == [600_000, 450_000, 450_000]
    assert [p["total_cents"] for p in body["points"]] == [1_000_000, 1_250_000, 1_260_000]
    assert body["summary"]["change_cents"] == 260_000


def test_archived_category_stays_in_history_only_if_it_had_value(client, make_asset):
    btc = make_asset(
        name="BTC", class_key="cripto", invested=1, current=500_000, valuation_date="2026-01-31"
    )
    make_asset(
        name="CDB", class_key="renda_fixa", invested=1, current=500_000, valuation_date="2026-01-31"
    )
    client.post(f"{API}/snapshots", json=manual("2026-01-31", cripto=(1, 500_000)))
    # A categoria só arquiva sem ativos ativos: o ativo sai primeiro, o histórico dele fica.
    asset_body = {
        "name": "BTC",
        "class_key": "cripto",
        "institution_id": btc["institution_id"],
        "archived": True,
    }
    assert client.put(f"{API}/assets/{btc['id']}", json=asset_body).status_code == 200
    classes = client.get("/api/v1/asset-classes").json()
    for key in ("cripto", "renda_variavel"):
        c = next(c for c in classes if c["key"] == key)
        body = {"name": c["name"], "color": c["color"], "archived": True}
        assert client.put(f"/api/v1/asset-classes/{c['id']}", json=body).status_code == 200

    evolution = client.get(f"{API}/history/evolution").json()
    shown = {c["key"]: c for c in evolution["classes"]}
    assert shown["cripto"]["archived"] is True  # teve valor: o histórico preserva
    assert "renda_variavel" not in shown  # arquivada e sempre zerada: não polui o gráfico
    assert evolution["points"][0]["by_class"]["cripto"] == 500_000

    snapshot = client.get(f"{API}/snapshots").json()[0]
    assert {c["class_key"] for c in snapshot["by_class"]} == {"cripto"}


# ---- aporte x valorização: diário por data, plano só como estimativa ---------------------------
#
# Regra: mês com aporte no diário (data em (1ª data com saldo, última data com saldo]) usa SÓ o
# diário; mês sem diário usa o planejado e vira "estimado"; ativo novo entra pelo investido inicial.


def plan(client, month, cents):
    """Aporte planejado do mês: salário de 10x o valor com 10% dá exatamente `cents`."""
    body = {"salary_cents": cents * 10, "percent_bps": 1_000}
    assert client.put(f"{API}/contributions/{month}", json=body).status_code in (200, 201)


def close(client, asset, date, total):
    """Saldo digitado do ativo na data: é o que define as datas e o patrimônio da evolução."""
    body = {"date": date, "invested_cents": 1, "current_cents": total}
    response = client.post(f"{API}/assets/{asset['id']}/valuations", json=body)
    assert response.status_code == 201, response.text


def contribute(client, asset, date, cents, balance=None, **extra):
    """Fechamento do ativo na `date` com aporte de `cents` (entra no diário)."""
    body = {
        "date": date,
        "balance_cents": balance or 1_000_000 + cents,
        "contribution_cents": cents,
    }
    response = client.post(f"{API}/assets/{asset['id']}/balance", json=body | extra)
    assert response.status_code == 200, response.text


def summary_of(client, **params):
    return client.get(f"{API}/history/evolution", params=params).json()["summary"]


def exact(summary, contributions, *, new_assets=0):
    assert summary["contributions_cents"] == contributions
    assert summary["contributions_source"] == "diario"
    assert summary["estimated_months"] == []
    assert summary["new_assets_cents"] == new_assets
    assert summary["appreciation_cents"] == summary["change_cents"] - contributions


def test_only_the_diary_is_exact_and_ignores_a_larger_plan(client, make_asset):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-01-31")
    plan(client, "2026-02", 50_000)  # o plano é maior, mas o que foi lançado é o que vale
    contribute(client, asset, "2026-02-20", 30_000)
    close(client, asset, "2026-03-31", 1_100_000)

    summary = summary_of(client)

    exact(summary, 30_000)
    assert (summary["change_cents"], summary["appreciation_cents"]) == (100_000, 70_000)


def test_only_the_plan_is_an_estimate_and_lists_the_months(client, make_asset):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-01-31")
    plan(client, "2026-01", 999_999)  # mês da 1ª data: já está no patrimônio inicial
    plan(client, "2026-02", 50_000)
    plan(client, "2026-03", 70_000)
    close(client, asset, "2026-03-31", 1_300_000)

    summary = summary_of(client)

    assert summary["contributions_cents"] == 120_000
    assert summary["contributions_source"] == "planejado"
    assert summary["estimated_months"] == ["2026-02", "2026-03"]
    assert summary["appreciation_cents"] == 300_000 - 120_000


def test_mixed_months_use_the_diary_where_it_exists_and_the_plan_elsewhere(client, make_asset):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-01-31")
    plan(client, "2026-02", 50_000)
    plan(client, "2026-03", 70_000)
    contribute(client, asset, "2026-02-20", 30_000)
    close(client, asset, "2026-03-31", 1_200_000)

    summary = summary_of(client)

    assert summary["contributions_cents"] == 30_000 + 70_000  # sem max: fev vale 30, não 50
    assert summary["contributions_source"] == "misto"
    assert summary["estimated_months"] == ["2026-03"]


def test_no_contribution_at_all_is_exact_zero(client, make_asset):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-01-31")
    close(client, asset, "2026-03-31", 1_050_000)

    summary = summary_of(client)

    exact(summary, 0)
    assert summary["appreciation_cents"] == 50_000


def test_contribution_after_the_first_date_in_the_same_month_counts(client, make_asset):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-01-15")
    contribute(client, asset, "2026-01-20", 20_000)  # mesmo mês, depois da 1ª data
    close(client, asset, "2026-03-31", 1_050_000)

    exact(summary_of(client), 20_000)


def test_contribution_in_the_last_month_but_after_the_last_balance_is_left_out(client, make_asset):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-01-31")
    account = client.get(f"{API}/accounts").json()[0]["id"]
    opening = {"date": "2026-02-01", "amount_cents": 100_000}
    assert client.post(f"{API}/accounts/{account}/opening-balance", json=opening).status_code == 201
    plan(client, "2026-03", 70_000)
    close(client, asset, "2026-03-15", 1_100_000)
    # Compra depois do último saldo digitado: nenhum saldo mostra esse dinheiro ainda.
    purchase = {"asset_id": asset["id"], "date": "2026-03-20", "amount_cents": 25_000}
    assert client.post(f"{API}/purchases", json=purchase).status_code == 201

    summary = summary_of(client)

    # Sem diário dentro do intervalo, março cai no planejado (estimado), não nos 25.000 de fora.
    assert summary["contributions_cents"] == 70_000
    assert (summary["contributions_source"], summary["estimated_months"]) == (
        "planejado",
        ["2026-03"],
    )


def test_date_limits_first_date_is_out_and_last_date_is_in(client, make_asset):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-01-31")
    contribute(client, asset, "2026-02-01", 22_000)  # um dia depois: entra
    contribute(client, asset, "2026-03-31", 33_000, balance=1_200_000)  # na última data: entra

    exact(summary_of(client), 22_000 + 33_000)


def test_purchase_with_cash_counts_as_a_contribution(client, make_asset):
    asset = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-01-31")
    account = client.get(f"{API}/accounts").json()[0]["id"]
    opening = {"date": "2026-02-01", "amount_cents": 100_000}
    assert client.post(f"{API}/accounts/{account}/opening-balance", json=opening).status_code == 201
    purchase = {"asset_id": asset["id"], "date": "2026-02-10", "amount_cents": 40_000}
    assert client.post(f"{API}/purchases", json=purchase).status_code == 201
    close(client, asset, "2026-03-31", 1_100_000)

    exact(summary_of(client), 40_000)


def test_transfer_is_neutral_and_does_not_make_the_month_exact(client, make_asset):
    source = make_asset(
        name="A", invested=1_000_000, current=1_000_000, valuation_date="2026-01-31"
    )
    target = make_asset(name="B", invested=100_000, current=100_000, valuation_date="2026-01-31")
    plan(client, "2026-02", 50_000)
    body = {"from_asset_id": source["id"], "to_asset_id": target["id"], "amount_cents": 300_000}
    assert client.post(f"{API}/transfers", json=body | {"date": "2026-02-10"}).status_code == 201
    close(client, source, "2026-03-31", 800_000)
    close(client, target, "2026-03-31", 400_000)

    summary = summary_of(client)

    # A transferência não é aporte: fevereiro continua sem diário e usa o plano, não os 300.000.
    assert summary["contributions_cents"] == 50_000
    assert summary["estimated_months"] == ["2026-02"]
    assert summary["change_cents"] == 100_000  # a transferência não mexe no patrimônio


def test_provento_is_appreciation_not_contribution(client, make_asset):
    fii = make_asset(invested=1_000_000, current=1_000_000, valuation_date="2026-01-31")
    other = make_asset(name="Conta", invested=10_000, current=10_000, valuation_date="2026-01-31")
    body = {"asset_id": fii["id"], "amount_cents": 8_000, "date": "2026-02-10"}
    assert client.post(f"{API}/proventos", json=body).status_code == 201
    credited = body | {"credited_asset_id": other["id"], "date": "2026-02-11"}
    assert client.post(f"{API}/proventos", json=credited).status_code == 201
    close(client, fii, "2026-03-31", 1_000_000)
    close(client, other, "2026-03-31", 30_000)

    summary = summary_of(client)

    exact(summary, 0)
    assert summary["appreciation_cents"] == 20_000


def test_new_asset_enters_by_its_initial_invested_value_without_double_counting(client, make_asset):
    antigo = make_asset(
        name="Antigo", invested=1_000_000, current=1_000_000, valuation_date="2026-01-31"
    )
    # Cadastrado em fevereiro com R$ 2.000 investidos que já valiam R$ 2.600: o ganho é
    # valorização, só o investido é dinheiro novo.
    novo = make_asset(name="Novo", invested=200_000, current=260_000, valuation_date="2026-02-10")
    close(client, antigo, "2026-03-31", 1_040_000)
    close(client, novo, "2026-03-31", 260_000)

    summary = summary_of(client)

    assert client.get(f"{API}/movements").json() == []  # cadastrar não grava movimento
    exact(summary, 200_000, new_assets=200_000)
    assert (summary["change_cents"], summary["appreciation_cents"]) == (300_000, 100_000)


def test_new_asset_with_contribution_before_its_first_valuation_counts_once(client, make_asset):
    antigo = make_asset(
        name="Antigo", invested=1_000_000, current=1_000_000, valuation_date="2026-01-31"
    )
    plan(client, "2026-02", 50_000)
    # Aporte de R$ 90 no dia 6; o ativo só ganha valor no dia 15, já com esses R$ 90 no investido.
    novo = make_asset(name="Novo", invested=62_391, current=70_000, valuation_date="2026-02-15")
    contribute(client, novo, "2026-02-15", 9_000, balance=70_000, contribution_date="2026-02-06")
    close(client, antigo, "2026-03-31", 1_100_000)

    summary = summary_of(client)

    # 71.391 uma vez só (ativo novo). Fevereiro tem diário (o aporte de 90), então não cai no
    # plano de 500 nem vira estimado.
    exact(summary, 71_391, new_assets=71_391)


def test_new_asset_registered_after_the_first_date_limits(client, make_asset):
    make_asset(name="No dia", invested=100_000, current=100_000, valuation_date="2026-01-31")
    make_asset(name="Último", invested=300_000, current=300_000, valuation_date="2026-03-31")
    make_asset(name="Depois", invested=900_000, current=900_000, valuation_date="2026-04-01")

    summary = summary_of(client, to="2026-03-31")

    # Na data do 1º saldo não é novo; na do último é; depois do último não entra.
    exact(summary, 300_000, new_assets=300_000)


def transfer(client, source, target, cents, date):
    body = {"from_asset_id": source["id"], "to_asset_id": target["id"], "amount_cents": cents}
    assert client.post(f"{API}/transfers", json=body | {"date": date}).status_code == 201


def test_transfer_into_a_new_asset_on_its_registration_day_is_not_new_money(client, make_asset):
    antigo = make_asset(
        name="Antigo", invested=1_000_000, current=1_000_000, valuation_date="2026-01-31"
    )
    # Ativo novo com R$ 0,01 e, no mesmo dia, R$ 3.000 trazidos do outro: o custo transferido
    # entra no investido da linha de cadastro, mas esse dinheiro já estava no patrimônio.
    novo = make_asset(name="Novo", invested=1, current=1, valuation_date="2026-02-10")
    transfer(client, antigo, novo, 300_000, "2026-02-10")
    close(client, antigo, "2026-03-31", 700_000)
    close(client, novo, "2026-03-31", 300_001)

    exact(summary_of(client), 1, new_assets=1)


def test_transfer_out_of_a_new_asset_on_its_registration_day_does_not_hide_new_money(
    client, make_asset
):
    antigo = make_asset(
        name="Antigo", invested=1_000_000, current=1_000_000, valuation_date="2026-01-31"
    )
    # R$ 5.000 novos entram no ativo novo e R$ 2.000 vão no mesmo dia para o antigo: o dinheiro
    # novo continua sendo os R$ 5.000 inteiros, mesmo com o investido da linha reduzido.
    novo = make_asset(name="Novo", invested=500_000, current=500_000, valuation_date="2026-02-10")
    transfer(client, novo, antigo, 200_000, "2026-02-10")
    close(client, antigo, "2026-03-31", 1_200_000)
    close(client, novo, "2026-03-31", 300_000)

    exact(summary_of(client), 500_000, new_assets=500_000)


def test_transfer_between_two_new_assets_is_neutral(client, make_asset):
    antigo = make_asset(
        name="Antigo", invested=1_000_000, current=1_000_000, valuation_date="2026-01-31"
    )
    a = make_asset(name="A", invested=100_000, current=100_000, valuation_date="2026-02-10")
    b = make_asset(name="B", invested=50_000, current=50_000, valuation_date="2026-02-10")
    transfer(client, a, b, 40_000, "2026-02-10")
    close(client, antigo, "2026-03-31", 1_000_000)
    close(client, a, "2026-03-31", 60_000)
    close(client, b, "2026-03-31", 90_000)

    exact(summary_of(client), 150_000, new_assets=150_000)


def test_a_late_asset_contribution_counts_when_its_balance_shows_it(client, make_asset):
    on_time = make_asset(
        name="Em dia", invested=1_000_000, current=1_000_000, valuation_date="2026-09-01"
    )
    late = make_asset(
        name="Atrasado", invested=1_000_000, current=1_000_000, valuation_date="2026-09-01"
    )
    close(client, on_time, "2026-09-30", 1_010_000)
    # Aporte de 28/09, mas o saldo do atrasado só foi digitado em 05/10.
    contribute(
        client, late, "2026-10-05", 50_000, balance=1_050_000, contribution_date="2026-09-28"
    )

    until_september = summary_of(client, to="2026-09-30")
    until_october = summary_of(client)

    # Em setembro o saldo do atrasado ainda não mostra o aporte: ele não é aporte do período
    # (senão a valorização sairia 50.000 menor do que foi).
    exact(until_september, 0)
    assert until_september["appreciation_cents"] == 10_000
    exact(until_october, 50_000)
    assert until_october["appreciation_cents"] == until_october["change_cents"] - 50_000


def test_a_contribution_dated_before_the_period_but_shown_in_it_counts_once_for_a_new_asset(
    client, make_asset
):
    antigo = make_asset(
        name="Antigo", invested=1_000_000, current=1_000_000, valuation_date="2026-01-31"
    )
    novo = make_asset(name="Novo", invested=62_391, current=70_000, valuation_date="2026-02-15")
    contribute(client, novo, "2026-02-15", 9_000, balance=70_000, contribution_date="2026-02-06")
    close(client, antigo, "2026-02-10", 1_000_000)

    # O período começa em 10/02, depois do aporte de 06/02, mas o saldo do ativo novo (15/02) só o
    # mostra agora: ele está no investido do ativo novo, uma vez só.
    summary = summary_of(client, **{"from": "2026-02-10"})

    exact(summary, 71_391, new_assets=71_391)


# ---- ativo arquivado: a saída não é prejuízo ----------------------------------------------------


def archive(client, asset):
    body = {
        "name": asset["name"],
        "class_key": "renda_fixa",
        "institution_id": asset["institution_id"],
    }
    response = client.put(f"{API}/assets/{asset['id']}", json=body | {"archived": True})
    assert response.status_code == 200, response.text


def test_archiving_an_asset_with_a_balance_is_an_exit_and_not_a_loss(client, make_asset):
    old = make_asset(name="Velho", invested=500_000, current=500_000, valuation_date="2026-09-01")
    parado = make_asset(
        name="Parado", invested=1_000_000, current=1_000_000, valuation_date="2026-09-01"
    )
    archive(client, old)
    close(client, parado, "2026-09-30", 1_000_000)

    summary = summary_of(client)

    assert summary["change_cents"] == -500_000
    assert summary["archived_out_cents"] == 500_000
    assert summary["withdrawals_cents"] == 0  # o resgate continua sendo só o resgate
    assert summary["appreciation_cents"] == 0  # change - aportes + resgates + arquivados


def test_archived_out_adds_to_redemptions_and_contributions_in_the_appreciation(client, make_asset):
    old = make_asset(name="Velho", invested=500_000, current=500_000, valuation_date="2026-09-01")
    fund = make_asset(
        name="Fundo", invested=1_000_000, current=1_000_000, valuation_date="2026-09-01"
    )
    archive(client, old)
    redemption = {"asset_id": fund["id"], "amount_cents": 100_000, "date": "2026-09-15"}
    assert client.post(f"{API}/redemptions", json=redemption).status_code == 201
    contribute(client, fund, "2026-09-30", 30_000, balance=960_000)  # 900.000 + 30.000 + 30.000

    summary = summary_of(client)

    assert summary["change_cents"] == 960_000 - 1_500_000
    assert (summary["contributions_cents"], summary["withdrawals_cents"]) == (30_000, 100_000)
    assert summary["archived_out_cents"] == 500_000
    assert summary["appreciation_cents"] == -540_000 - 30_000 + 100_000 + 500_000 == 30_000


def test_an_archived_asset_without_a_balance_has_no_archived_out(client, make_asset):
    old = make_asset(name="Velho", invested=500_000, current=500_000, valuation_date="2026-09-01")
    fund = make_asset(
        name="Fundo", invested=1_000_000, current=1_000_000, valuation_date="2026-09-01"
    )
    transfer(client, old, fund, 500_000, "2026-09-15")  # zerou antes de arquivar
    archive(client, old)
    close(client, fund, "2026-09-30", 1_500_000)

    summary = summary_of(client)

    assert summary["archived_out_cents"] == 0
    assert summary["change_cents"] == 0 and summary["appreciation_cents"] == 0


def test_an_asset_archived_with_its_last_value_on_the_last_date_has_no_archived_out(
    client, make_asset
):
    old = make_asset(name="Velho", invested=500_000, current=500_000, valuation_date="2026-09-01")
    fund = make_asset(
        name="Fundo", invested=1_000_000, current=1_000_000, valuation_date="2026-09-01"
    )
    close(client, fund, "2026-09-15", 1_000_000)
    close(client, old, "2026-09-30", 510_000)
    archive(client, old)

    summary = summary_of(client)

    # Ele ainda soma na última data: nada saiu, e o ganho dele continua sendo valorização.
    assert summary["archived_out_cents"] == 0
    assert summary["change_cents"] == summary["appreciation_cents"] == 10_000
    # Em 15/09 ele ainda não tinha saído e não sai antes do fim.
    assert summary_of(client, to="2026-09-15")["archived_out_cents"] == 0


def test_an_asset_that_left_before_the_period_does_not_count_in_it(client, make_asset):
    old = make_asset(name="Velho", invested=500_000, current=500_000, valuation_date="2026-09-01")
    fund = make_asset(
        name="Fundo", invested=1_000_000, current=1_000_000, valuation_date="2026-09-01"
    )
    archive(client, old)
    close(client, fund, "2026-09-30", 1_000_000)  # aqui o arquivado deixa de somar
    close(client, fund, "2026-10-31", 1_010_000)

    later = summary_of(client, **{"from": "2026-09-30"})

    assert later["archived_out_cents"] == 0
    assert later["change_cents"] == 10_000 and later["appreciation_cents"] == 10_000
    assert summary_of(client)["archived_out_cents"] == 500_000


def test_the_performance_ignores_the_archived_out(client, make_asset):
    old = make_asset(name="Velho", invested=500_000, current=500_000, valuation_date="2026-09-01")
    fund = make_asset(
        name="Fundo", invested=1_000_000, current=1_000_000, valuation_date="2026-09-01"
    )
    archive(client, old)
    close(client, fund, "2026-09-30", 1_010_000)

    points = client.get(f"{API}/analytics/performance").json()["points"]

    assert [p["portfolio_bps"] for p in points] == [0, 67]  # 10.000 sobre 1.500.000
