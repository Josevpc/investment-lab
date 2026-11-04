import datetime as dt

API = "/api/v1/contributions"
TODAY = dt.date.today().isoformat()  # os ativos nascem com a posição de hoje
MONTH = TODAY[:7]


def test_calculate_contribution(client):
    response = client.post(f"{API}/calculate", json={"salary_cents": 800_000, "percent_bps": 750})
    assert response.status_code == 200
    assert response.json() == {"calculated_cents": 60_000}  # 7,5% de R$ 8.000,00


def test_calculate_rejects_percent_above_100(client):
    response = client.post(f"{API}/calculate", json={"salary_cents": 1, "percent_bps": 10_001})
    assert response.status_code == 422


def test_create_and_list_contributions_newest_first(client):
    for month, salary in [("2026-08", 700_000), ("2026-10", 800_000), ("2026-09", 750_000)]:
        response = client.post(
            API, json={"month": month, "salary_cents": salary, "percent_bps": 1_000}
        )
        assert response.status_code == 201
        assert response.json()["final_cents"] == salary // 10

    months = [c["month"] for c in client.get(API).json()]
    assert months == ["2026-10", "2026-09", "2026-08"]


def test_duplicate_month_is_conflict(client):
    body = {"month": "2026-10", "salary_cents": 800_000, "percent_bps": 500}
    assert client.post(API, json=body).status_code == 201
    assert client.post(API, json=body).status_code == 409


def test_invalid_month_format(client):
    response = client.post(API, json={"month": "10/2026", "salary_cents": 1, "percent_bps": 500})
    assert response.status_code == 422
    assert (
        client.put(f"{API}/2026-13", json={"salary_cents": 1, "percent_bps": 500}).status_code
        == 422
    )


def test_put_upserts_and_keeps_manual_override(client):
    created = client.put(f"{API}/2026-10", json={"salary_cents": 800_000, "percent_bps": 500})
    assert created.status_code == 201
    assert created.json()["overridden"] is False

    updated = client.put(
        f"{API}/2026-10",
        json={"salary_cents": 800_000, "percent_bps": 500, "final_cents": 150_000},
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["calculated_cents"] == 40_000
    assert body["final_cents"] == 150_000
    assert body["overridden"] is True
    assert len(client.get(API).json()) == 1


# ---- plano do mês gravado ----------------------------------------------------------------


def make_portfolio(make_asset):
    """Renda fixa bem acima da meta (25%); as demais abaixo."""
    make_asset(name="CDB", class_key="renda_fixa", invested=100_000, current=100_000)
    make_asset(name="FII", class_key="renda_variavel", invested=10_000, current=10_000)
    make_asset(name="ETF", class_key="acoes_etfs", invested=10_000, current=10_000)
    return make_asset(name="BTC", class_key="cripto", invested=10_000, current=10_000)


def plan_of(body):
    return {item["class_key"]: item["amount_cents"] for item in body["plan"]}


def test_saving_freezes_the_split_by_category(client, make_asset):
    make_portfolio(make_asset)
    # R$ 1.800,00 x 5% = R$ 90,00: renda fixa já passou da meta, então não recebe nada.
    body = client.put(f"{API}/2026-09", json={"salary_cents": 180_000, "percent_bps": 500}).json()

    assert body["final_cents"] == 9_000
    assert body["mode"] == "rebalance"
    assert body["plan_name"]
    assert plan_of(body) == {
        "renda_fixa": 0,
        "renda_variavel": 3_000,
        "acoes_etfs": 3_000,
        "cripto": 3_000,
    }
    assert plan_of(client.get(API).json()[0]) == plan_of(body)  # a listagem traz o plano gravado


def test_reserve_part_is_taken_out_of_the_split(client, make_asset):
    make_portfolio(make_asset)
    body = client.put(
        f"{API}/2026-09",
        json={"salary_cents": 180_000, "percent_bps": 500, "reserve_cents": 2_000},
    ).json()
    assert body["reserve_cents"] == 2_000
    assert sum(plan_of(body).values()) == 7_000


def test_reserve_cannot_exceed_the_contribution(client, make_asset):
    make_portfolio(make_asset)
    response = client.put(
        f"{API}/2026-09",
        json={"salary_cents": 180_000, "percent_bps": 500, "reserve_cents": 9_001},
    )
    assert response.status_code == 422
    assert client.get(API).json() == []  # nada foi gravado


def test_proportional_mode_follows_the_targets(client, make_asset):
    make_portfolio(make_asset)
    body = client.put(
        f"{API}/2026-09",
        json={"salary_cents": 400_000, "percent_bps": 1_000, "mode": "proportional"},
    ).json()
    assert body["mode"] == "proportional"
    assert set(plan_of(body).values()) == {10_000}  # 25% de R$ 400,00 para cada categoria


def test_saving_again_keeps_the_plan_from_the_pre_contribution_position(client, make_asset):
    btc = make_portfolio(make_asset)
    payload = {"salary_cents": 180_000, "percent_bps": 500}
    first = client.put(f"{API}/{MONTH}", json=payload).json()

    # Parte do plano é executada no mês: R$ 30,00 em cripto.
    executed = client.post(
        f"/api/v1/assets/{btc['id']}/balance",
        json={"date": TODAY, "balance_cents": 13_000, "contribution_cents": 3_000},
    )
    assert executed.status_code in (200, 201), executed.text

    # Salvar de novo não conta esse aporte duas vezes: o plano continua o mesmo.
    again = client.put(f"{API}/{MONTH}", json=payload).json()
    assert plan_of(again) == plan_of(first)


def test_old_contributions_without_a_plan_still_list(client):
    body = client.put(f"{API}/2026-09", json={"salary_cents": 100, "percent_bps": 100}).json()
    assert isinstance(body["plan"], list)


def test_split_with_month_ignores_what_was_already_contributed(client, make_asset):
    btc = make_portfolio(make_asset)
    saved = client.put(f"{API}/{MONTH}", json={"salary_cents": 180_000, "percent_bps": 500}).json()
    executed = client.post(
        f"/api/v1/assets/{btc['id']}/balance",
        json={"date": TODAY, "balance_cents": 13_000, "contribution_cents": 3_000},
    )
    assert executed.status_code in (200, 201), executed.text

    def split(**extra):
        body = {"amount_cents": 9_000, "mode": "rebalance", **extra}
        items = client.post("/api/v1/allocation/split", json=body).json()["items"]
        return {i["class_key"]: i["amount_cents"] for i in items}

    assert split(month=MONTH) == plan_of(saved)  # a sugestão do mês não "anda"
    assert split() != plan_of(saved)  # sem o mês, a carteira atual já inclui o aporte feito
    assert (
        client.post(
            "/api/v1/allocation/split", json={"amount_cents": 1, "month": "2026-13"}
        ).status_code
        == 422
    )


def test_saved_plan_gives_nothing_to_a_category_with_every_asset_held(client, make_asset):
    btc = make_portfolio(make_asset)
    keys = (
        "name", "class_key", "institution_id", "ticker", "indexer", "rate_bps", "maturity_date",
        "quantity", "purpose", "asset_type", "fii_segment", "account_id", "archived",
    )  # fmt: skip
    held = {key: btc[key] for key in keys} | {"hold_only": True}
    assert client.put(f"/api/v1/assets/{btc['id']}", json=held).status_code == 200
    plans = "/api/v1/allocation/plans"
    plan = client.post(
        plans,
        json={
            "name": "Cripto suspensa",
            "targets": [
                {"class_key": "renda_fixa", "percent_bps": 1_800},
                {"class_key": "renda_variavel", "percent_bps": 3_600},
                {"class_key": "acoes_etfs", "percent_bps": 3_600},
                {"class_key": "cripto", "percent_bps": 1_000},  # fica gravada, mas suspensa
            ],
        },
    ).json()
    client.post(f"{plans}/{plan['id']}/activate")

    for mode in ("rebalance", "proportional"):
        body = client.put(
            f"{API}/2026-09", json={"salary_cents": 180_000, "percent_bps": 500, "mode": mode}
        ).json()
        assert body["plan_name"] == "Cripto suspensa"
        assert plan_of(body)["cripto"] == 0
        assert sum(plan_of(body).values()) == body["final_cents"] == 9_000
    assert plan_of(body) == {
        "renda_fixa": 1_800,
        "renda_variavel": 3_600,
        "acoes_etfs": 3_600,
        "cripto": 0,
    }


def hold_every_asset(client, make_asset):
    make_portfolio(make_asset)
    keys = (
        "name", "class_key", "institution_id", "ticker", "indexer", "rate_bps", "maturity_date",
        "quantity", "purpose", "asset_type", "fii_segment", "account_id", "archived",
    )  # fmt: skip
    for asset in client.get("/api/v1/assets").json():
        body = {key: asset[key] for key in keys} | {"hold_only": True}
        assert client.put(f"/api/v1/assets/{asset['id']}", json=body).status_code == 200


def test_saving_a_contribution_with_every_category_fully_held_says_why(client, make_asset):
    hold_every_asset(client, make_asset)

    response = client.put(f"{API}/2026-09", json={"salary_cents": 180_000, "percent_bps": 500})

    assert response.status_code == 422
    assert response.json()["code"] == "all_held"
    assert "Desmarque algum ativo" in response.json()["detail"]
    assert client.get(API).json() == []  # nada foi gravado


def test_with_every_category_fully_held_the_whole_amount_can_go_to_the_reserve(client, make_asset):
    hold_every_asset(client, make_asset)

    # R$ 1.800,00 x 5% = R$ 90,00, todos para a reserva: não há nada para investir.
    # O primeiro PUT cria o mês (201); o segundo o atualiza (200).
    for mode, status in (("rebalance", 201), ("proportional", 200)):
        response = client.put(
            f"{API}/2026-09",
            json={
                "salary_cents": 180_000,
                "percent_bps": 500,
                "reserve_cents": 9_000,
                "mode": mode,
            },
        )
        assert response.status_code == status, response.text
        body = response.json()
        assert (body["final_cents"], body["reserve_cents"]) == (9_000, 9_000)
        assert plan_of(body) == dict.fromkeys(
            ("renda_fixa", "renda_variavel", "acoes_etfs", "cripto"), 0
        )
    assert [c["month"] for c in client.get(API).json()] == ["2026-09"]

    # Sobrando qualquer centavo para investir, volta a recusar com o código estável.
    leftover = client.put(
        f"{API}/2026-09",
        json={"salary_cents": 180_000, "percent_bps": 500, "reserve_cents": 8_999},
    )
    assert leftover.status_code == 422
    assert leftover.json()["code"] == "all_held"
    saved = client.get(API).json()[0]
    assert (saved["reserve_cents"], plan_of(saved)["renda_fixa"]) == (9_000, 0)  # nada mudou
