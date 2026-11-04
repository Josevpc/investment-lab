API = "/api/v1"


def salary(client, month, cents):
    assert client.put(
        f"{API}/contributions/{month}", json={"salary_cents": cents, "percent_bps": 1_000}
    ).status_code in (200, 201)


def reserve_asset(client, institution, current, *, name="Cofrinho MP"):
    response = client.post(
        f"{API}/assets",
        json={
            "name": name,
            "class_key": "renda_fixa",
            "institution_id": institution["id"],
            "current_cents": current,
            "purpose": "reserva",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_default_reserve_is_empty(client):
    body = client.get(f"{API}/reserve").json()
    assert body["goal_cents"] == 0
    assert body["months"] == 6
    assert body["balance_cents"] == 0
    assert body["progress_bps"] == 0
    assert body["reached"] is False
    assert body["suggested_goal_cents"] is None
    assert body["assets"] == []


def test_suggested_goal_is_six_times_the_average_salary(client):
    salary(client, "2026-08", 800_000)
    salary(client, "2026-09", 1_000_000)
    body = client.get(f"{API}/reserve").json()
    assert body["average_salary_cents"] == 900_000
    assert body["salaries_considered"] == 2
    assert body["suggested_goal_cents"] == 5_400_000  # 6 x R$ 9.000,00


def test_goal_progress_and_coverage(client, institution):
    salary(client, "2026-09", 900_000)
    reserve_asset(client, institution, 1_350_000)
    saved = client.put(
        f"{API}/reserve", json={"goal_cents": 5_400_000, "months": 6, "monthly_cents": 100_000}
    )
    assert saved.status_code == 200

    body = client.get(f"{API}/reserve").json()
    assert body["balance_cents"] == 1_350_000
    assert body["remaining_cents"] == 4_050_000
    assert body["progress_bps"] == 2_500  # 25%
    assert body["coverage_months"] == 1.5  # 1,5 salário guardado
    assert body["monthly_cents"] == 100_000
    assert body["reached"] is False
    assert [a["name"] for a in body["assets"]] == ["Cofrinho MP"]


def test_goal_reached_is_capped_at_100_percent(client, institution):
    reserve_asset(client, institution, 6_000_000)
    client.put(f"{API}/reserve", json={"goal_cents": 5_400_000, "months": 6})
    body = client.get(f"{API}/reserve").json()
    assert body["reached"] is True
    assert body["progress_bps"] == 10_000
    assert body["remaining_cents"] == 0


def test_reserve_validation(client):
    assert client.put(f"{API}/reserve", json={"goal_cents": -1, "months": 6}).status_code == 422
    assert client.put(f"{API}/reserve", json={"goal_cents": 1, "months": 0}).status_code == 422


# ---- a reserva fica fora da estratégia de alocação ---------------------------------------


def test_reserve_assets_are_excluded_from_allocation_and_class_shares(
    client, institution, make_asset
):
    make_asset(name="CDB", class_key="renda_fixa", invested=1_000_000, current=1_000_000)
    reserve_asset(client, institution, 9_000_000)

    comparison = client.get(f"{API}/allocation/comparison").json()
    assert comparison["total_cents"] == 1_000_000  # a reserva não entra

    split = client.post(
        f"{API}/allocation/split", json={"amount_cents": 100_000, "mode": "rebalance"}
    ).json()
    assert (
        next(i for i in split["items"] if i["class_key"] == "renda_fixa")["current_cents"]
        == 1_000_000
    )

    summary = client.get(f"{API}/portfolio/summary").json()
    assert summary["total_current_cents"] == 10_000_000  # patrimônio total inclui a reserva
    assert summary["investments_current_cents"] == 1_000_000
    assert summary["reserve_current_cents"] == 9_000_000
    fixed = next(c for c in summary["by_class"] if c["class_key"] == "renda_fixa")
    assert fixed["current_cents"] == 1_000_000
    assert fixed["share_bps"] == 10_000


def test_asset_purpose_can_be_set_and_removed(client, institution):
    asset = reserve_asset(client, institution, 100)
    assert asset["purpose"] == "reserva"
    body = {
        "name": asset["name"],
        "class_key": asset["class_key"],
        "institution_id": asset["institution_id"],
        "archived": False,
        "purpose": None,
    }
    assert client.put(f"{API}/assets/{asset['id']}", json=body).json()["purpose"] is None
    assert client.get(f"{API}/reserve").json()["balance_cents"] == 0


def test_trajectory_ignores_the_reserve(client, institution, make_asset):
    make_asset(name="CDB", class_key="renda_fixa", invested=100_000, current=100_000)
    reserve_asset(client, institution, 5_000_000)
    body = client.post(
        f"{API}/analytics/trajectory", json={"months": 1, "monthly_contribution_cents": 0}
    ).json()
    assert body["points"][0]["total_cents"] == 100_000


# ---- histórico com reserva ---------------------------------------------------------------


def test_snapshot_keeps_reserve_apart_from_investments(client, institution, make_asset):
    make_asset(name="CDB", class_key="renda_fixa", invested=1_000_000, current=1_100_000)
    reserve_asset(client, institution, 900_000)

    snapshot = client.post(f"{API}/snapshots", json={"date": "2026-10-31"}).json()
    assert snapshot["total_cents"] == 2_000_000
    assert snapshot["reserve_cents"] == 900_000
    assert snapshot["assets_count"] == 1
    assert {c["class_key"]: c["current_cents"] for c in snapshot["by_class"]} == {
        "renda_fixa": 1_100_000
    }

    evolution = client.get(f"{API}/history/evolution").json()
    point = evolution["points"][0]
    assert point["total_cents"] == 2_000_000
    assert point["reserve_cents"] == 900_000
    assert point["by_class"]["renda_fixa"] == 1_100_000


def test_manual_snapshot_with_reserve_only_and_editing(client):
    created = client.post(f"{API}/snapshots", json={"date": "2026-01-31", "reserve_cents": 500_000})
    assert created.status_code == 201
    snapshot = created.json()
    assert (snapshot["total_cents"], snapshot["reserve_cents"], snapshot["manual"]) == (
        500_000,
        500_000,
        True,
    )

    items = [{"class_key": "cripto", "invested_cents": 1, "current_cents": 300_000}]
    updated = client.put(
        f"{API}/snapshots/{snapshot['id']}",
        json={"date": "2026-01-31", "items": items, "reserve_cents": 700_000},
    ).json()
    assert updated["total_cents"] == 1_000_000
    assert updated["reserve_cents"] == 700_000

    empty = client.put(
        f"{API}/snapshots/{snapshot['id']}",
        json={"date": "2026-01-31", "items": [], "reserve_cents": 0},
    )
    assert empty.status_code == 422


def test_monthly_reserve_can_be_a_percent_of_the_contribution(client):
    default = client.get(f"{API}/reserve").json()
    assert default["monthly_mode"] == "fixed" and default["percent_bps"] == 0

    saved = client.put(
        f"{API}/reserve",
        json={
            "goal_cents": 5_400_000,
            "months": 6,
            "monthly_cents": 100_000,
            "monthly_mode": "percent",
            "percent_bps": 2_000,
        },
    ).json()
    assert saved["monthly_mode"] == "percent"
    assert saved["percent_bps"] == 2_000
    assert saved["monthly_cents"] == 100_000  # o valor fixo continua guardado para quem voltar
    assert client.get(f"{API}/reserve").json()["percent_bps"] == 2_000


def test_reserve_percent_is_limited_to_100_percent(client):
    response = client.put(
        f"{API}/reserve",
        json={"goal_cents": 0, "monthly_mode": "percent", "percent_bps": 10_001},
    )
    assert response.status_code == 422
    response = client.put(f"{API}/reserve", json={"goal_cents": 0, "monthly_mode": "weekly"})
    assert response.status_code == 422
