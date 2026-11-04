API = "/api/v1"
DAY0 = "2026-09-30"


def asset(
    client, name, institution_id, *, class_key="renda_fixa", invested=None, current=0, **extra
):
    body = {
        "name": name,
        "class_key": class_key,
        "institution_id": institution_id,
        "current_cents": current,
        "valuation_date": DAY0,
        **extra,
    }
    if invested is not None:
        body["invested_cents"] = invested
    response = client.post(f"{API}/assets", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def balance(client, asset_id, **body):
    return client.post(f"{API}/assets/{asset_id}/balance", json=body)


def summary(client):
    return client.get(f"{API}/portfolio/summary").json()


# ---- valor investido opcional ------------------------------------------------------------


def test_invested_defaults_to_current_when_omitted(client, institution):
    created = asset(client, "Cofrinho", institution["id"], current=250_000)
    assert created["invested_cents"] == 250_000
    assert created["gain_cents"] == 0
    assert created["return_bps"] == 0


# ---- aporte e rendimento -----------------------------------------------------------------


def test_balance_with_contribution_splits_aporte_from_rendimento(client, institution):
    cdb = asset(client, "CDB", institution["id"], invested=100_000, current=100_000)

    response = balance(
        client, cdb["id"], date="2026-10-31", balance_cents=151_200, contribution_cents=50_000
    )
    assert response.status_code == 200
    body = response.json()
    assert body["invested_cents"] == 150_000  # 100.000 + aporte de 50.000
    assert body["current_cents"] == 151_200
    assert body["gain_cents"] == 1_200  # o que veio de rendimento
    assert body["return_bps"] == 80

    movements = client.get(f"{API}/movements", params={"month": "2026-10"}).json()
    assert [(m["kind"], m["amount_cents"], m["asset_name"]) for m in movements] == [
        ("aporte", 50_000, "CDB")
    ]


def test_balance_without_contribution_keeps_invested(client, institution):
    cdb = asset(client, "CDB", institution["id"], invested=100_000, current=100_000)
    body = balance(client, cdb["id"], date="2026-10-31", balance_cents=100_900).json()
    assert body["invested_cents"] == 100_000
    assert body["gain_cents"] == 900
    assert client.get(f"{API}/movements").json() == []


def test_balance_can_correct_invested(client, institution):
    cdb = asset(client, "CDB", institution["id"], invested=100_000, current=120_000)
    body = balance(
        client, cdb["id"], date="2026-10-31", balance_cents=120_000, invested_cents=90_000
    ).json()
    assert body["invested_cents"] == 90_000


def test_balance_same_day_updates_in_place_and_stacks_contributions(client, institution):
    cdb = asset(client, "CDB", institution["id"], invested=100_000, current=100_000)
    balance(client, cdb["id"], date="2026-10-05", balance_cents=110_000, contribution_cents=10_000)
    body = balance(
        client, cdb["id"], date="2026-10-05", balance_cents=125_000, contribution_cents=15_000
    ).json()
    assert body["invested_cents"] == 125_000
    assert len(client.get(f"{API}/assets/{cdb['id']}/valuations").json()) == 2  # sem duplicar o dia


def test_balance_rejects_dates_before_the_latest_update(client, institution):
    cdb = asset(client, "CDB", institution["id"], invested=100_000, current=100_000)
    response = balance(client, cdb["id"], date="2026-09-01", balance_cents=1)
    assert response.status_code == 422
    assert "30/09/2026" in response.json()["detail"]


# ---- transferência entre ativos ----------------------------------------------------------


def test_transfer_moves_cost_basis_and_keeps_portfolio_totals(client, institution):
    midway = asset(client, "CDB Midway", institution["id"], invested=100_000, current=110_000)
    mp = asset(client, "Cofrinho MP", institution["id"], invested=50_000, current=50_000)
    before = summary(client)

    response = client.post(
        f"{API}/transfers",
        json={
            "from_asset_id": midway["id"],
            "to_asset_id": mp["id"],
            "amount_cents": 55_000,
            "date": "2026-10-10",
        },
    )
    assert response.status_code == 201
    moved = response.json()
    assert moved["kind"] == "transferencia"
    assert moved["cost_cents"] == 50_000  # metade do custo acompanha a metade do saldo
    assert (moved["related_asset_name"], moved["asset_name"]) == ("CDB Midway", "Cofrinho MP")

    origin = client.get(f"{API}/assets/{midway['id']}").json()
    target = client.get(f"{API}/assets/{mp['id']}").json()
    assert (origin["invested_cents"], origin["current_cents"]) == (50_000, 55_000)
    assert (target["invested_cents"], target["current_cents"]) == (100_000, 105_000)

    after = summary(client)
    assert after["total_current_cents"] == before["total_current_cents"]
    assert after["total_invested_cents"] == before["total_invested_cents"]
    assert after["return_bps"] == before["return_bps"]


def test_full_transfer_empties_the_origin(client, institution):
    midway = asset(client, "CDB Midway", institution["id"], invested=100_000, current=110_000)
    mp = asset(client, "Cofrinho MP", institution["id"], invested=0, current=0)
    client.post(
        f"{API}/transfers",
        json={"from_asset_id": midway["id"], "to_asset_id": mp["id"], "amount_cents": 110_000},
    )
    origin = client.get(f"{API}/assets/{midway['id']}").json()
    target = client.get(f"{API}/assets/{mp['id']}").json()
    assert (origin["invested_cents"], origin["current_cents"]) == (0, 0)
    assert (target["invested_cents"], target["current_cents"]) == (100_000, 110_000)
    assert target["return_bps"] == 1_000  # o rendimento da Midway viaja junto


def test_transfer_validation(client, institution):
    a = asset(client, "A", institution["id"], invested=100, current=100)
    b = asset(client, "B", institution["id"], invested=100, current=100)
    url = f"{API}/transfers"
    base = {"from_asset_id": a["id"], "to_asset_id": b["id"], "amount_cents": 50}

    assert client.post(url, json={**base, "to_asset_id": a["id"]}).status_code == 422
    too_much = client.post(url, json={**base, "amount_cents": 101})
    assert too_much.status_code == 422
    assert "R$ 1,00" in too_much.json()["detail"]
    assert client.post(url, json={**base, "amount_cents": 0}).status_code == 422
    assert client.post(url, json={**base, "date": "2026-01-01"}).status_code == 422
    assert client.post(url, json={**base, "to_asset_id": 999}).status_code == 404


# ---- proventos ---------------------------------------------------------------------------


def test_provento_is_tracked_per_asset_and_adds_to_total_return(client, institution):
    fii = asset(
        client,
        "HGLG11",
        institution["id"],
        class_key="renda_variavel",
        invested=100_000,
        current=100_000,
    )
    for date, amount in (("2026-10-15", 800), ("2026-11-15", 900)):
        response = client.post(
            f"{API}/proventos", json={"asset_id": fii["id"], "amount_cents": amount, "date": date}
        )
        assert response.status_code == 201

    body = client.get(f"{API}/assets/{fii['id']}").json()
    assert body["proventos_cents"] == 1_700
    assert body["return_bps"] == 0  # a cota não mexeu
    assert body["total_return_bps"] == 170  # 1,7% só de proventos
    assert summary(client)["proventos_cents"] == 1_700
    # Sem crédito, o provento não altera o patrimônio.
    assert body["current_cents"] == 100_000


def test_provento_credited_to_cash_asset_raises_its_balance_not_its_invested(client, institution):
    fii = asset(client, "HGLG11", institution["id"], class_key="renda_variavel", current=100_000)
    cash = asset(client, "Saldo em conta", institution["id"], class_key="renda_variavel", current=0)
    response = client.post(
        f"{API}/proventos",
        json={
            "asset_id": fii["id"],
            "amount_cents": 900,
            "date": "2026-10-15",
            "credited_asset_id": cash["id"],
        },
    )
    assert response.status_code == 201
    assert response.json()["related_asset_name"] == "Saldo em conta"

    credited = client.get(f"{API}/assets/{cash['id']}").json()
    assert (credited["invested_cents"], credited["current_cents"]) == (0, 900)
    assert credited["gain_cents"] == 900

    same = client.post(
        f"{API}/proventos",
        json={"asset_id": fii["id"], "amount_cents": 1, "credited_asset_id": fii["id"]},
    )
    assert same.status_code == 422


def test_reinvesting_dividends_moves_cash_into_the_fii_without_new_capital(client, institution):
    fii = asset(
        client,
        "HGLG11",
        institution["id"],
        class_key="renda_variavel",
        invested=100_000,
        current=100_000,
    )
    cash = asset(client, "Saldo em conta", institution["id"], class_key="renda_variavel", current=0)
    client.post(
        f"{API}/proventos",
        json={
            "asset_id": fii["id"],
            "amount_cents": 900,
            "date": "2026-10-15",
            "credited_asset_id": cash["id"],
        },
    )
    before = summary(client)

    client.post(
        f"{API}/transfers",
        json={
            "from_asset_id": cash["id"],
            "to_asset_id": fii["id"],
            "amount_cents": 900,
            "date": "2026-10-20",
        },
    )
    after = summary(client)
    assert after["total_invested_cents"] == before["total_invested_cents"] == 100_000
    assert after["total_current_cents"] == before["total_current_cents"] == 100_900
    reinvested = client.get(f"{API}/assets/{fii['id']}").json()
    assert (reinvested["invested_cents"], reinvested["current_cents"]) == (100_000, 100_900)


# ---- diário ------------------------------------------------------------------------------


def test_only_uncredited_proventos_can_be_deleted(client, institution):
    fii = asset(client, "HGLG11", institution["id"], current=100_000)
    cash = asset(client, "Conta", institution["id"], current=0)
    free = client.post(f"{API}/proventos", json={"asset_id": fii["id"], "amount_cents": 10}).json()
    credited = client.post(
        f"{API}/proventos",
        json={"asset_id": fii["id"], "amount_cents": 10, "credited_asset_id": cash["id"]},
    ).json()
    balance(client, cash["id"], balance_cents=100, contribution_cents=90)

    assert client.delete(f"{API}/movements/{free['id']}").status_code == 204
    assert client.delete(f"{API}/movements/{credited['id']}").status_code == 409
    aporte = next(m for m in client.get(f"{API}/movements").json() if m["kind"] == "aporte")
    assert client.delete(f"{API}/movements/{aporte['id']}").status_code == 409
    assert client.delete(f"{API}/movements/9999").status_code == 404


def test_month_summary_shows_what_was_already_contributed(client, institution):
    cdb = asset(client, "CDB", institution["id"], invested=100, current=100)
    btc = asset(client, "BTC", institution["id"], class_key="cripto", invested=100, current=100)
    reserva = asset(
        client, "Cofrinho", institution["id"], invested=100, current=100, purpose="reserva"
    )

    balance(client, cdb["id"], date="2026-10-10", balance_cents=60_100, contribution_cents=60_000)
    balance(client, btc["id"], date="2026-10-11", balance_cents=20_100, contribution_cents=20_000)
    balance(
        client, reserva["id"], date="2026-10-12", balance_cents=30_100, contribution_cents=30_000
    )
    balance(client, cdb["id"], date="2026-11-02", balance_cents=70_000, contribution_cents=9_000)
    client.post(
        f"{API}/proventos", json={"asset_id": cdb["id"], "amount_cents": 500, "date": "2026-10-20"}
    )

    october = client.get(f"{API}/portfolio/month-summary", params={"month": "2026-10"}).json()
    by_class = {c["class_key"]: c["amount_cents"] for c in october["by_class"]}
    assert by_class["renda_fixa"] == 60_000
    assert by_class["cripto"] == 20_000
    assert by_class["renda_variavel"] == 0
    assert october["reserve_cents"] == 30_000
    assert october["total_cents"] == 110_000
    assert october["proventos_cents"] == 500

    assert (
        client.get(f"{API}/portfolio/month-summary", params={"month": "2026-12"}).json()[
            "total_cents"
        ]
        == 0
    )
    assert client.get(f"{API}/portfolio/month-summary", params={"month": "dez"}).status_code == 422


def test_movements_filters(client, institution):
    a = asset(client, "A", institution["id"], current=1_000)
    b = asset(client, "B", institution["id"], current=1_000)
    balance(client, a["id"], date="2026-10-01", balance_cents=1_500, contribution_cents=500)
    client.post(
        f"{API}/transfers",
        json={
            "from_asset_id": a["id"],
            "to_asset_id": b["id"],
            "amount_cents": 100,
            "date": "2026-10-02",
        },
    )
    client.post(
        f"{API}/proventos", json={"asset_id": b["id"], "amount_cents": 5, "date": "2026-10-03"}
    )

    kinds = [m["kind"] for m in client.get(f"{API}/movements").json()]
    assert kinds == ["provento", "transferencia", "aporte"]  # mais recente primeiro
    assert [
        m["kind"] for m in client.get(f"{API}/movements", params={"kind": "aporte"}).json()
    ] == ["aporte"]
    # Filtrar por ativo pega o movimento como origem ou destino.
    assert len(client.get(f"{API}/movements", params={"asset_id": a["id"]}).json()) == 2


# ---- desfazer movimentos que já mexeram em saldos -----------------------------------------


def movement_of(client, kind):
    return next(m for m in client.get(f"{API}/movements").json() if m["kind"] == kind)


def test_undoing_an_aporte_takes_it_out_of_invested_and_balance(client, institution):
    cdb = asset(client, "CDB", institution["id"], invested=100_000, current=100_000)
    balance(client, cdb["id"], date="2026-10-31", balance_cents=151_200, contribution_cents=50_000)
    aporte = movement_of(client, "aporte")

    response = client.post(f"{API}/movements/{aporte['id']}/undo")
    assert response.status_code == 200
    assert response.json()["amount_cents"] == 50_000

    after = client.get(f"{API}/assets/{cdb['id']}").json()
    assert (after["invested_cents"], after["current_cents"]) == (100_000, 101_200)
    assert client.get(f"{API}/movements").json() == []


def test_undoing_an_aporte_dated_before_an_unrelated_row_only_touches_the_balance_that_had_it(
    client, institution
):
    source = asset(client, "Origem", institution["id"], invested=100_000, current=100_000)
    cdb = asset(client, "CDB", institution["id"], invested=100_000, current=100_000)
    # Dia 20: uma transferência cria uma linha no CDB que nunca teve o aporte do dia 15.
    client.post(
        f"{API}/transfers",
        json={
            "from_asset_id": source["id"],
            "to_asset_id": cdb["id"],
            "amount_cents": 10_000,
            "date": "2026-10-20",
        },
    )
    # Dia 31: fechamento com um aporte feito no dia 15.
    balance(
        client,
        cdb["id"],
        date="2026-10-31",
        balance_cents=125_000,
        contribution_cents=10_000,
        contribution_date="2026-10-15",
    )
    aporte = movement_of(client, "aporte")

    client.post(f"{API}/movements/{aporte['id']}/undo")

    rows = {v["date"]: v for v in client.get(f"{API}/assets/{cdb['id']}/valuations").json()}
    assert rows["2026-10-20"]["invested_cents"] == 110_000  # a linha do dia 20 não é tocada
    assert rows["2026-10-31"]["invested_cents"] == 110_000  # 120.000 - 10.000
    assert rows["2026-10-31"]["current_cents"] == 115_000


def test_undoing_a_transfer_returns_money_and_cost_to_the_origin(client, institution):
    source = asset(client, "Origem", institution["id"], invested=80_000, current=100_000)
    target = asset(client, "Destino", institution["id"], invested=10_000, current=10_000)
    client.post(
        f"{API}/transfers",
        json={
            "from_asset_id": source["id"],
            "to_asset_id": target["id"],
            "amount_cents": 50_000,
            "date": "2026-10-10",
        },
    )
    moved = movement_of(client, "transferencia")

    assert client.post(f"{API}/movements/{moved['id']}/undo").status_code == 200

    origin = client.get(f"{API}/assets/{source['id']}").json()
    destination = client.get(f"{API}/assets/{target['id']}").json()
    assert (origin["invested_cents"], origin["current_cents"]) == (80_000, 100_000)
    assert (destination["invested_cents"], destination["current_cents"]) == (10_000, 10_000)
    assert client.get(f"{API}/movements").json() == []


def test_undoing_a_credited_provento_takes_it_out_of_the_receiver(client, institution):
    fii = asset(client, "HGLG11", institution["id"], current=100_000)
    cash = asset(client, "Conta", institution["id"], current=1_000)
    credited = client.post(
        f"{API}/proventos",
        json={"asset_id": fii["id"], "amount_cents": 300, "credited_asset_id": cash["id"]},
    ).json()

    assert client.post(f"{API}/movements/{credited['id']}/undo").status_code == 200

    after = client.get(f"{API}/assets/{cash['id']}").json()
    assert (after["invested_cents"], after["current_cents"]) == (1_000, 1_000)
    assert client.get(f"{API}/movements").json() == []


def test_undo_is_refused_when_it_would_make_a_balance_negative_and_changes_nothing(
    client, institution
):
    source = asset(client, "Origem", institution["id"], invested=100_000, current=100_000)
    target = asset(client, "Destino", institution["id"], invested=0, current=0)
    client.post(
        f"{API}/transfers",
        json={
            "from_asset_id": source["id"],
            "to_asset_id": target["id"],
            "amount_cents": 40_000,
            "date": "2026-10-10",
        },
    )
    # O dinheiro já saiu do destino (saldo corrigido): desfazer deixaria o saldo negativo.
    balance(client, target["id"], date="2026-10-20", balance_cents=10_000)
    moved = movement_of(client, "transferencia")

    response = client.post(f"{API}/movements/{moved['id']}/undo")
    assert response.status_code == 409
    assert "negativo" in response.json()["detail"]

    assert len(client.get(f"{API}/movements").json()) == 1  # nada foi desfeito
    still_source = client.get(f"{API}/assets/{source['id']}").json()
    assert still_source["current_cents"] == 60_000


def test_undo_of_an_unknown_movement_is_404(client):
    assert client.post(f"{API}/movements/9999/undo").status_code == 404


# ---- editar um movimento (valor ou data) ---------------------------------------------------


def edit(client, movement_id, **body):
    return client.patch(f"{API}/movements/{movement_id}", json=body)


def transfer(client, source, target, amount, day="2026-10-10"):
    response = client.post(
        f"{API}/transfers",
        json={
            "from_asset_id": source["id"],
            "to_asset_id": target["id"],
            "amount_cents": amount,
            "date": day,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def totals(client, asset_id):
    body = client.get(f"{API}/assets/{asset_id}").json()
    return body["invested_cents"], body["current_cents"]


def test_editing_an_aporte_amount_keeps_the_rendimento(client, institution):
    cdb = asset(client, "CDB", institution["id"], invested=100_000, current=100_000)
    balance(client, cdb["id"], date="2026-10-31", balance_cents=151_200, contribution_cents=50_000)
    aporte = movement_of(client, "aporte")

    response = edit(client, aporte["id"], amount_cents=30_000)

    assert response.status_code == 200
    assert response.json()["amount_cents"] == 30_000
    assert totals(client, cdb["id"]) == (130_000, 131_200)  # o rendimento segue em 1.200
    assert movement_of(client, "aporte")["amount_cents"] == 30_000


def test_editing_an_aporte_date_moves_it_within_the_period(client, institution):
    cdb = asset(client, "CDB", institution["id"], invested=100_000, current=100_000)
    balance(
        client,
        cdb["id"],
        date="2026-10-31",
        balance_cents=151_200,
        contribution_cents=50_000,
        contribution_date="2026-10-15",
    )
    aporte = movement_of(client, "aporte")

    response = edit(client, aporte["id"], date="2026-10-25")

    assert response.status_code == 200
    assert response.json()["date"] == "2026-10-25"
    assert totals(client, cdb["id"]) == (150_000, 151_200)


def test_editing_an_aporte_date_across_a_balance_moves_it_to_that_closing(client, institution):
    cdb = asset(client, "CDB", institution["id"], invested=100_000, current=100_000)
    balance(client, cdb["id"], date="2026-10-15", balance_cents=101_000)
    balance(
        client,
        cdb["id"],
        date="2026-10-31",
        balance_cents=152_000,
        contribution_cents=50_000,
        contribution_date="2026-10-20",
    )
    aporte = movement_of(client, "aporte")

    # Antes do saldo de 15/10, o aporte passa a pertencer a esse fechamento.
    assert edit(client, aporte["id"], date="2026-10-10").status_code == 200

    rows = {v["date"]: v for v in client.get(f"{API}/assets/{cdb['id']}/valuations").json()}
    assert (rows["2026-10-15"]["invested_cents"], rows["2026-10-15"]["current_cents"]) == (
        150_000,
        151_000,
    )
    assert (rows["2026-10-31"]["invested_cents"], rows["2026-10-31"]["current_cents"]) == (
        150_000,
        152_000,
    )
    assert movement_of(client, "aporte")["date"] == "2026-10-10"


def test_editing_an_aporte_date_to_after_the_last_balance_is_refused(client, institution):
    cdb = asset(client, "CDB", institution["id"], invested=100_000, current=100_000)
    balance(client, cdb["id"], date="2026-10-31", balance_cents=151_200, contribution_cents=50_000)
    aporte = movement_of(client, "aporte")

    response = edit(client, aporte["id"], date="2026-11-05")

    assert response.status_code == 422
    assert "saldo registrado" in response.json()["detail"]
    assert totals(client, cdb["id"]) == (150_000, 151_200)


def test_editing_a_transfer_amount_recomputes_the_cost(client, institution):
    source = asset(client, "Origem", institution["id"], invested=80_000, current=100_000)
    target = asset(client, "Destino", institution["id"], invested=10_000, current=10_000)
    moved = transfer(client, source, target, 50_000)

    response = edit(client, moved["id"], amount_cents=20_000)

    assert response.status_code == 200
    assert response.json()["cost_cents"] == 16_000  # 80% do valor, como o custo da origem
    assert totals(client, source["id"]) == (64_000, 80_000)
    assert totals(client, target["id"]) == (26_000, 30_000)


def test_editing_a_transfer_date_to_the_past_creates_the_row_and_moves_later_ones(
    client, institution
):
    source = asset(client, "Origem", institution["id"], invested=100_000, current=100_000)
    target = asset(client, "Destino", institution["id"], invested=0, current=0)
    moved = transfer(client, source, target, 40_000, day="2026-10-10")
    balance(client, target["id"], date="2026-10-20", balance_cents=41_000)

    assert edit(client, moved["id"], date="2026-10-05").status_code == 200

    rows = {v["date"]: v for v in client.get(f"{API}/assets/{target['id']}/valuations").json()}
    assert rows["2026-10-05"]["current_cents"] == 40_000
    assert rows["2026-10-20"]["current_cents"] == 41_000  # o saldo digitado não muda
    assert totals(client, source["id"]) == (60_000, 60_000)


def test_editing_a_transfer_above_the_origin_balance_is_refused(client, institution):
    source = asset(client, "Origem", institution["id"], invested=100_000, current=100_000)
    target = asset(client, "Destino", institution["id"], invested=0, current=0)
    moved = transfer(client, source, target, 40_000)

    response = edit(client, moved["id"], amount_cents=150_000)

    assert response.status_code == 422
    assert "maior que o saldo" in response.json()["detail"]
    assert totals(client, source["id"]) == (60_000, 60_000)
    assert totals(client, target["id"]) == (40_000, 40_000)


def test_editing_is_refused_when_it_would_make_a_balance_negative_and_changes_nothing(
    client, institution
):
    source = asset(client, "Origem", institution["id"], invested=100_000, current=100_000)
    target = asset(client, "Destino", institution["id"], invested=0, current=0)
    moved = transfer(client, source, target, 40_000)
    balance(client, target["id"], date="2026-10-20", balance_cents=10_000)  # o dinheiro já saiu

    response = edit(client, moved["id"], amount_cents=20_000)

    assert response.status_code == 409
    assert "negativo" in response.json()["detail"]
    assert movement_of(client, "transferencia")["amount_cents"] == 40_000
    assert totals(client, source["id"]) == (60_000, 60_000)


def test_editing_a_credited_provento_adjusts_the_receiver_without_touching_invested(
    client, institution
):
    fii = asset(client, "HGLG11", institution["id"], current=100_000)
    cash = asset(client, "Conta", institution["id"], current=1_000)
    credited = client.post(
        f"{API}/proventos",
        json={"asset_id": fii["id"], "amount_cents": 300, "credited_asset_id": cash["id"]},
    ).json()

    assert edit(client, credited["id"], amount_cents=500).status_code == 200

    assert totals(client, cash["id"]) == (1_000, 1_500)


def test_editing_a_provento_without_credit_changes_only_the_record(client, institution):
    fii = asset(client, "HGLG11", institution["id"], current=100_000)
    provento = client.post(
        f"{API}/proventos", json={"asset_id": fii["id"], "amount_cents": 300, "date": "2026-10-05"}
    ).json()

    response = edit(client, provento["id"], amount_cents=450, date="2026-10-08")

    assert response.status_code == 200
    assert (response.json()["amount_cents"], response.json()["date"]) == (450, "2026-10-08")
    assert totals(client, fii["id"]) == (100_000, 100_000)


def test_editing_with_nothing_to_change_or_an_unknown_movement_fails(client, institution):
    fii = asset(client, "HGLG11", institution["id"], current=100_000)
    provento = client.post(
        f"{API}/proventos", json={"asset_id": fii["id"], "amount_cents": 300}
    ).json()

    assert edit(client, provento["id"]).status_code == 422
    assert edit(client, provento["id"], amount_cents=0).status_code == 422
    assert edit(client, 9999, amount_cents=100).status_code == 404


# ---- aporte de cripto por quantidade -----------------------------------------------------


def test_balance_with_quantity_added_sums_to_the_asset_quantity(client, institution):
    btc = asset(
        client,
        "Bitcoin",
        institution["id"],
        class_key="cripto",
        invested=100_000,
        current=120_000,
        quantity="0.0025",
    )
    body = balance(
        client,
        btc["id"],
        date="2026-10-31",
        balance_cents=207_500,
        contribution_cents=87_500,
        quantity_added="0.0025",
    ).json()
    assert body["quantity"] == "0.005"
    assert body["invested_cents"] == 187_500
    assert body["current_cents"] == 207_500


def test_quantity_added_starts_from_zero_when_the_asset_has_no_quantity(client, institution):
    eth = asset(client, "Ether", institution["id"], class_key="cripto", current=10_000)
    body = balance(
        client,
        eth["id"],
        date="2026-10-31",
        balance_cents=30_000,
        contribution_cents=20_000,
        quantity_added="0.1",
    ).json()
    assert body["quantity"] == "0.1"


def test_quantity_added_must_be_a_positive_decimal(client, institution):
    btc = asset(client, "Bitcoin", institution["id"], class_key="cripto", current=10_000)
    for bad in ("0", "-1", "abc", "1e3"):
        response = balance(
            client, btc["id"], balance_cents=10_000, contribution_cents=1, quantity_added=bad
        )
        assert response.status_code == 422, bad
