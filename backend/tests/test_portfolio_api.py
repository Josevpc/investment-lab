API = "/api/v1"


def test_asset_classes_are_seeded(client):
    keys = [c["key"] for c in client.get(f"{API}/asset-classes").json()]
    assert keys == ["renda_fixa", "renda_variavel", "acoes_etfs", "cripto"]


def test_institution_crud_and_rules(client):
    created = client.post(f"{API}/institutions", json={"name": "Nubank"})
    assert created.status_code == 201
    assert client.post(f"{API}/institutions", json={"name": "nubank"}).status_code == 409

    renamed = client.put(f"{API}/institutions/{created.json()['id']}", json={"name": "Nu"})
    assert renamed.json()["name"] == "Nu"
    assert client.post(f"{API}/institutions", json={"name": "  "}).status_code == 422
    assert client.delete(f"{API}/institutions/{created.json()['id']}").status_code == 204
    assert client.delete(f"{API}/institutions/999").status_code == 404


def test_cannot_delete_institution_with_assets(client, institution, make_asset):
    make_asset()
    assert client.delete(f"{API}/institutions/{institution['id']}").status_code == 409


def test_create_asset_returns_latest_values_and_return(client, make_asset):
    asset = make_asset(
        name="CDB 110% CDI",
        invested=100_000,
        current=112_500,
        indexer="CDI",
        rate_bps=11_000,
        maturity_date="2028-01-15",
    )
    assert asset["class_key"] == "renda_fixa"
    assert asset["return_bps"] == 1_250  # 12,5%
    assert asset["indexer"] == "CDI"
    assert asset["maturity_date"] == "2028-01-15"


def test_asset_validation(client, institution):
    base = {
        "name": "X",
        "class_key": "acoes_etfs",
        "institution_id": institution["id"],
        "invested_cents": 100,
        "current_cents": 100,
    }
    assert client.post(f"{API}/assets", json={**base, "class_key": "ouro"}).status_code == 422
    assert client.post(f"{API}/assets", json={**base, "institution_id": 999}).status_code == 422
    assert client.post(f"{API}/assets", json={**base, "current_cents": -1}).status_code == 422
    assert client.post(f"{API}/assets", json={**base, "quantity": "abc"}).status_code == 422
    ok = client.post(f"{API}/assets", json={**base, "ticker": " petr4 ", "quantity": "10.5"})
    assert ok.status_code == 201
    assert ok.json()["ticker"] == "PETR4"


def test_new_valuation_replaces_current_value_and_keeps_history(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000)
    response = client.post(
        f"{API}/assets/{asset['id']}/valuations",
        json={"date": "2099-01-01", "invested_cents": 120_000, "current_cents": 150_000},
    )
    assert response.status_code == 201

    current = client.get(f"{API}/assets/{asset['id']}").json()
    assert current["current_cents"] == 150_000
    assert current["invested_cents"] == 120_000
    assert len(client.get(f"{API}/assets/{asset['id']}/valuations").json()) == 2

    # Mesma data: atualiza em vez de duplicar.
    client.post(
        f"{API}/assets/{asset['id']}/valuations",
        json={"date": "2099-01-01", "invested_cents": 120_000, "current_cents": 160_000},
    )
    assert len(client.get(f"{API}/assets/{asset['id']}/valuations").json()) == 2
    assert client.get(f"{API}/assets/{asset['id']}").json()["current_cents"] == 160_000


def test_archived_assets_leave_the_current_portfolio(client, make_asset):
    keep = make_asset(name="Fica", current=100_000, invested=100_000)
    gone = make_asset(name="Sai", current=50_000, invested=50_000)

    body = {
        "name": gone["name"],
        "class_key": gone["class_key"],
        "institution_id": gone["institution_id"],
        "archived": True,
    }
    assert client.put(f"{API}/assets/{gone['id']}", json=body).status_code == 200

    assert [a["name"] for a in client.get(f"{API}/assets").json()] == [keep["name"]]
    assert len(client.get(f"{API}/assets?include_archived=true").json()) == 2
    assert client.get(f"{API}/portfolio/summary").json()["total_current_cents"] == 100_000


def test_summary_consolidates_by_class_and_institution(client, institution, make_asset):
    other = client.post(f"{API}/institutions", json={"name": "Corretora"}).json()
    make_asset(name="CDB", class_key="renda_fixa", invested=600_000, current=700_000)
    make_asset(name="BTC", class_key="cripto", invested=100_000, current=100_000)
    client.post(
        f"{API}/assets",
        json={
            "name": "PETR4",
            "class_key": "acoes_etfs",
            "institution_id": other["id"],
            "invested_cents": 200_000,
            "current_cents": 200_000,
        },
    )

    summary = client.get(f"{API}/portfolio/summary").json()
    assert summary["total_current_cents"] == 1_000_000
    assert summary["total_invested_cents"] == 900_000
    assert summary["return_bps"] == 1_111
    assert summary["assets_count"] == 3

    classes = {c["class_key"]: c for c in summary["by_class"]}
    assert classes["renda_fixa"]["share_bps"] == 7_000
    assert classes["acoes_etfs"]["current_cents"] == 200_000
    assert classes["renda_variavel"]["current_cents"] == 0

    institutions = {i["institution_name"]: i for i in summary["by_institution"]}
    assert institutions["Banco Teste"]["current_cents"] == 800_000
    assert institutions["Corretora"]["share_bps"] == 2_000


def test_empty_portfolio_summary(client):
    summary = client.get(f"{API}/portfolio/summary").json()
    assert summary["total_current_cents"] == 0
    assert summary["return_bps"] is None
    assert len(summary["by_class"]) == 4


# ---- categorias editáveis ----------------------------------------------------------------


def test_create_category_generates_key_and_color(client):
    response = client.post(f"{API}/asset-classes", json={"name": "Fundos Imobiliários (FIIs)"})
    assert response.status_code == 201
    created = response.json()
    assert created["key"] == "fundos_imobiliarios_fiis"
    assert created["color"].startswith("#")
    assert created["archived"] is False

    # Categorias novas recebem a primeira cor da paleta que ainda não está em uso.
    second = client.post(f"{API}/asset-classes", json={"name": "Debêntures"}).json()
    assert second["color"] != created["color"]
    assert second["key"] == "debentures"

    explicit = client.post(f"{API}/asset-classes", json={"name": "Ouro", "color": "#ca8a04"})
    assert explicit.json()["color"] == "#ca8a04"
    assert len(client.get(f"{API}/asset-classes").json()) == 7


def test_category_name_must_be_unique_and_color_valid(client):
    assert client.post(f"{API}/asset-classes", json={"name": "renda fixa"}).status_code == 409
    assert (
        client.post(f"{API}/asset-classes", json={"name": "Ouro", "color": "azul"}).status_code
        == 422
    )
    assert client.post(f"{API}/asset-classes", json={"name": "   "}).status_code == 422


def test_rename_and_recolor_category_keeps_key(client):
    cripto = next(c for c in client.get(f"{API}/asset-classes").json() if c["key"] == "cripto")
    response = client.put(
        f"{API}/asset-classes/{cripto['id']}",
        json={"name": "Cripto", "color": "#000000", "archived": False},
    )
    assert response.status_code == 200
    assert response.json()["key"] == "cripto"
    assert response.json()["name"] == "Cripto"


def test_cannot_archive_category_with_active_assets(client, make_asset):
    make_asset(class_key="cripto")
    cripto = next(c for c in client.get(f"{API}/asset-classes").json() if c["key"] == "cripto")
    body = {"name": cripto["name"], "color": cripto["color"], "archived": True}
    assert client.put(f"{API}/asset-classes/{cripto['id']}", json=body).status_code == 409


def test_archived_category_is_hidden_and_rejects_new_assets(client, institution):
    cripto = next(c for c in client.get(f"{API}/asset-classes").json() if c["key"] == "cripto")
    body = {"name": cripto["name"], "color": cripto["color"], "archived": True}
    assert client.put(f"{API}/asset-classes/{cripto['id']}", json=body).status_code == 200

    assert "cripto" not in [c["key"] for c in client.get(f"{API}/asset-classes").json()]
    everything = client.get(f"{API}/asset-classes?include_archived=true").json()
    assert "cripto" in [c["key"] for c in everything]

    asset = {
        "name": "BTC",
        "class_key": "cripto",
        "institution_id": institution["id"],
        "invested_cents": 1,
        "current_cents": 1,
    }
    assert client.post(f"{API}/assets", json=asset).status_code == 422

    # Reativar devolve a categoria.
    body["archived"] = False
    assert client.put(f"{API}/asset-classes/{cripto['id']}", json=body).status_code == 200
    assert client.post(f"{API}/assets", json=asset).status_code == 201


def test_cannot_archive_the_last_category(client):
    classes = client.get(f"{API}/asset-classes").json()
    for c in classes[:-1]:
        body = {"name": c["name"], "color": c["color"], "archived": True}
        assert client.put(f"{API}/asset-classes/{c['id']}", json=body).status_code == 200
    last = classes[-1]
    body = {"name": last["name"], "color": last["color"], "archived": True}
    assert client.put(f"{API}/asset-classes/{last['id']}", json=body).status_code == 422


# ---- manter posição (marca do ativo) -----------------------------------------------------

EDITABLE = (
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
    "hold_only",
)


def edit(client, asset, **changes):
    body = {key: asset[key] for key in EDITABLE} | changes
    return client.put(f"{API}/assets/{asset['id']}", json=body)


def test_new_asset_enters_without_the_mark_and_can_be_created_marked(
    client, institution, make_asset
):
    assert make_asset(name="Comum")["hold_only"] is False
    marked = make_asset(name="Mantido", hold_only=True)
    assert marked["hold_only"] is True
    listed = {a["name"]: a["hold_only"] for a in client.get(f"{API}/assets").json()}
    assert listed == {"Comum": False, "Mantido": True}
    assert client.get(f"{API}/assets/{marked['id']}").json()["hold_only"] is True


def put_without_mark(client, asset, **changes):
    body = {key: asset[key] for key in EDITABLE if key != "hold_only"} | changes
    return client.put(f"{API}/assets/{asset['id']}", json=body)


def test_asset_mark_can_be_turned_on_and_off(client, make_asset):
    asset = make_asset()
    on = edit(client, asset, hold_only=True).json()
    assert on["hold_only"] is True
    assert edit(client, on, hold_only=False).json()["hold_only"] is False


def test_put_without_the_field_keeps_the_current_mark(client, make_asset):
    marked = make_asset(name="Mantido", hold_only=True)
    plain = make_asset(name="Comum")
    # Editar outra coisa (o nome) sem enviar a marca não pode apagá-la nem criá-la.
    renamed = put_without_mark(client, marked, name="Mantido 2").json()
    assert (renamed["name"], renamed["hold_only"]) == ("Mantido 2", True)
    assert put_without_mark(client, plain, name="Comum 2").json()["hold_only"] is False
    assert client.get(f"{API}/assets/{marked['id']}").json()["hold_only"] is True
    assert client.get(f"{API}/assets/{plain['id']}").json()["hold_only"] is False


def test_archiving_without_the_field_clears_the_mark_and_explicit_true_is_refused(
    client, make_asset
):
    marked = make_asset(hold_only=True)
    refused = put_without_mark(client, marked, archived=True, hold_only=True)
    assert refused.status_code == 422
    assert refused.json()["detail"] == "Ativo arquivado não pode ser mantido."
    archived = put_without_mark(client, marked, archived=True)
    assert archived.status_code == 200
    assert archived.json()["hold_only"] is False
    # Reativar sem enviar a marca mantém desligada: ela não sobrevive ao arquivamento.
    assert put_without_mark(client, archived.json(), archived=False).json()["hold_only"] is False


def test_becoming_a_reserve_without_the_field_drops_the_mark(client, make_asset):
    marked = make_asset(hold_only=True)
    reserve = put_without_mark(client, marked, purpose="reserva")
    assert reserve.status_code == 200
    assert reserve.json()["hold_only"] is False
    assert put_without_mark(client, reserve.json(), purpose=None).json()["hold_only"] is False


def test_null_field_means_keep_the_mark(client, make_asset):
    marked = make_asset(hold_only=True)
    assert edit(client, marked, hold_only=None).json()["hold_only"] is True


def test_an_archived_asset_cannot_be_marked(client, make_asset):
    asset = make_asset()
    response = edit(client, asset, archived=True, hold_only=True)
    assert response.status_code == 422
    assert response.json()["detail"] == "Ativo arquivado não pode ser mantido."
    assert client.get(f"{API}/assets/{asset['id']}").json()["archived"] is False  # nada mudou

    archived = edit(client, asset, archived=True)
    assert archived.status_code == 200
    again = edit(client, archived.json(), hold_only=True)
    assert again.status_code == 422
    assert again.json()["detail"] == "Ativo arquivado não pode ser mantido."


def test_archiving_an_asset_clears_its_mark(client, make_asset):
    asset = make_asset(hold_only=True)
    archived = edit(client, asset, archived=True, hold_only=False).json()
    assert archived["hold_only"] is False
    # Ao reativar, volta sem a marca: ela não "sobrevive" ao arquivamento.
    assert edit(client, archived, archived=False).json()["hold_only"] is False


def test_a_reserve_asset_cannot_be_marked_and_is_never_reported_as_held(client, make_asset):
    response = client.post(
        f"{API}/assets",
        json={
            "name": "Reserva",
            "class_key": "renda_fixa",
            "institution_id": make_asset()["institution_id"],
            "current_cents": 1_000,
            "purpose": "reserva",
            "hold_only": True,
        },
    )
    assert response.status_code == 422
    assert "reserva" in response.json()["detail"]

    reserve = make_asset(name="Reserva", purpose="reserva")
    assert reserve["hold_only"] is False
    bad = edit(client, reserve, hold_only=True)
    assert bad.status_code == 422
    # Tornar um ativo marcado em reserva também exige desligar a marca.
    held = make_asset(name="Mantido", hold_only=True)
    assert edit(client, held, purpose="reserva").status_code == 422
    assert edit(client, held, purpose="reserva", hold_only=False).status_code == 200


def test_hold_status_per_category_follows_the_marks(client, make_asset):
    a = make_asset(name="A", class_key="renda_variavel", current=3_000)
    b = make_asset(name="B", class_key="renda_variavel", current=2_000)

    def status():
        # A comparação expõe o mesmo status que o serviço da carteira calcula.
        rows = client.get(f"{API}/allocation/comparison").json()["items"]
        return {r["class_key"]: r["hold_status"] for r in rows}

    assert status()["renda_variavel"] == "none"
    edit(client, a, hold_only=True)
    assert status()["renda_variavel"] == "partial"
    assert status()["cripto"] == "none"  # categoria sem ativos nunca é "all"
    edit(client, b, archived=True)  # B sai da conta: sobra só A, que está mantido
    assert status()["renda_variavel"] == "all"
    edit(client, client.get(f"{API}/assets/{a['id']}").json(), hold_only=False)
    assert status()["renda_variavel"] == "none"


# ---- saldo bruto ou líquido de IR ----------------------------------------------------------


def test_asset_balance_is_gross_unless_marked_net(client, make_asset):
    gross = make_asset(name="Tesouro Reserva")
    net = make_asset(name="Caixinha", balance_is_net=True)
    assert gross["balance_is_net"] is False
    assert net["balance_is_net"] is True
    listed = {a["name"]: a["balance_is_net"] for a in client.get(f"{API}/assets").json()}
    assert listed == {"Tesouro Reserva": False, "Caixinha": True}
    assert client.get(f"{API}/assets/{net['id']}").json()["balance_is_net"] is True


def test_balance_mark_can_be_turned_on_and_off(client, make_asset):
    asset = make_asset()
    on = edit(client, asset, balance_is_net=True).json()
    assert on["balance_is_net"] is True
    assert edit(client, on, balance_is_net=False).json()["balance_is_net"] is False


def test_put_without_the_balance_mark_keeps_the_current_one(client, make_asset):
    net = make_asset(name="Caixinha", balance_is_net=True)
    gross = make_asset(name="Tesouro")
    # Editar outro campo sem enviar a marca não pode apagá-la nem criá-la.
    renamed = put_without_mark(client, net, name="Caixinha 2").json()
    assert (renamed["name"], renamed["balance_is_net"]) == ("Caixinha 2", True)
    assert put_without_mark(client, gross, name="Tesouro 2").json()["balance_is_net"] is False
    assert client.get(f"{API}/assets/{net['id']}").json()["balance_is_net"] is True
