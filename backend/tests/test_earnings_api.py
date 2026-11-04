import datetime as dt

import pytest

API = "/api/v1"


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr("app.features.earnings.service._today", lambda: dt.date(2026, 10, 17))


def earnings(client):
    response = client.get(f"{API}/earnings")
    assert response.status_code == 200, response.text
    return response.json()


def balance(client, asset, when, balance_cents, contribution_cents=0):
    response = client.post(
        f"{API}/assets/{asset['id']}/balance",
        json={
            "date": when,
            "balance_cents": balance_cents,
            "contribution_cents": contribution_cents,
        },
    )
    assert response.status_code == 200, response.text


def set_salary(client, month, salary_cents):
    response = client.put(
        f"{API}/contributions/{month}", json={"salary_cents": salary_cents, "percent_bps": 1_000}
    )
    assert response.status_code in (200, 201), response.text


def archive(client, asset):
    body = {
        "name": asset["name"],
        "class_key": asset["class_key"],
        "institution_id": asset["institution_id"],
        "archived": True,
    }
    assert client.put(f"{API}/assets/{asset['id']}", json=body).status_code == 200


# ---- contrato ----------------------------------------------------------------------------


def test_an_empty_portfolio_answers_with_zeros_and_no_error(client):
    body = earnings(client)

    assert body["as_of"] == "2026-10-17"
    assert body["tracking_since"] is None
    assert body["total"] == {
        "earned_cents": 0,
        "before_tracking_cents": 0,
        "since_tracking_cents": 0,
        "uncredited_proventos_cents": 0,
    }
    assert body["months"] == []
    assert body["last_complete_month"] is None
    assert (body["pace"], body["salary"], body["vs_salary"]) == (None, None, None)
    assert body["current_month"] == {
        "month": "2026-10",
        "earned_cents": 0,
        "appreciation_cents": 0,
        "proventos_cents": 0,
        "partial": True,
        "through": "2026-10-17",
        "has_update": False,
        "salary_share_bps": None,
        "measured_through": None,
        "per_day_cents": None,
        "work_minutes": None,
    }
    assert [m["key"] for m in body["milestones"]] == [
        "first_salary",
        "share_1",
        "share_5",
        "share_10",
        "share_25",
        "share_50",
        "share_100",
        "total_100",
        "total_1000",
        "total_10000",
        "total_100000",
    ]
    assert all(m["achieved_month"] is None for m in body["milestones"])
    assert body["next_milestone"] == {"key": "first_salary", "progress_bps": 0}


def test_the_response_has_the_agreed_shape_for_a_portfolio_with_history(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-07-31")
    balance(client, asset, "2026-08-31", 103_100)
    balance(client, asset, "2026-09-30", 106_200)
    set_salary(client, "2026-09", 500_000)

    body = earnings(client)

    assert body["tracking_since"] == "2026-07-31"
    assert [m["month"] for m in body["months"]] == ["2026-07", "2026-08", "2026-09", "2026-10"]
    assert body["current_month"] == body["months"][-1]
    assert body["last_complete_month"] == body["months"][-2]
    assert body["last_complete_month"]["partial"] is False
    assert body["last_complete_month"]["through"] == "2026-09-30"
    assert body["pace"] == {
        "per_day_cents": 102,  # 6.200 em 61 dias (31 + 30) = 101,6
        "basis_months": 2,
        "from_month": "2026-08",
        "to_month": "2026-09",
    }
    assert body["salary"] == {"salary_cents": 500_000, "month": "2026-10"}
    assert body["vs_salary"] == {
        "month": "2026-09",
        "earned_cents": 3_100,
        "share_bps": 62,
        "work_minutes": 82,
    }
    assert {m["kind"] for m in body["milestones"]} == {"first", "monthly_share", "total_amount"}


def test_the_history_is_limited_to_the_last_twelve_months(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2025-01-31")
    balance(client, asset, "2026-10-10", 120_000)

    months = earnings(client)["months"]

    assert len(months) == 12
    assert (months[0]["month"], months[-1]["month"]) == ("2025-11", "2026-10")


def test_the_current_month_can_be_followed_during_the_month(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-09-30")
    set_salary(client, "2026-10", 500_000)
    balance(client, asset, "2026-10-06", 100_500)
    balance(client, asset, "2026-10-13", 101_300)  # hoje é 17: o saldo mais novo é o do dia 13

    month = earnings(client)["current_month"]

    assert month["through"] == "2026-10-17"
    assert month["measured_through"] == "2026-10-13"
    assert month["earned_cents"] == 1_300
    assert month["per_day_cents"] == 100  # R$ 13,00 em 13 dias
    assert month["salary_share_bps"] == 26  # 13 / 5.000
    assert month["work_minutes"] == 34  # 1.300 x 220 h x 60 / 500.000 = 34,3 minutos


# ---- o que conta como rendimento ---------------------------------------------------------


def test_a_contribution_does_not_count_as_earnings(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-09-30")
    balance(client, asset, "2026-10-10", 152_000, contribution_cents=50_000)

    body = earnings(client)

    assert body["current_month"]["earned_cents"] == 2_000
    assert body["total"]["earned_cents"] == 2_000


def test_a_transfer_does_not_change_the_total(client, make_asset):
    source = make_asset(
        name="Origem", invested=100_000, current=110_000, valuation_date="2026-09-30"
    )
    target = make_asset(
        name="Destino", invested=50_000, current=50_000, valuation_date="2026-09-30"
    )
    before = earnings(client)["total"]

    response = client.post(
        f"{API}/transfers",
        json={
            "from_asset_id": source["id"],
            "to_asset_id": target["id"],
            "amount_cents": 55_000,
            "date": "2026-10-10",
        },
    )
    assert response.status_code == 201

    after = earnings(client)
    assert after["total"] == before
    assert after["total"]["earned_cents"] == 10_000
    assert after["current_month"]["earned_cents"] == 0


def test_a_credited_provento_is_not_counted_twice(client, make_asset):
    fii = make_asset(name="FII", invested=100_000, current=100_000, valuation_date="2026-09-30")
    cash = make_asset(name="Conta", invested=50_000, current=50_000, valuation_date="2026-09-30")
    response = client.post(
        f"{API}/proventos",
        json={
            "asset_id": fii["id"],
            "amount_cents": 1_000,
            "date": "2026-10-10",
            "credited_asset_id": cash["id"],
        },
    )
    assert response.status_code == 201

    body = earnings(client)

    assert body["total"]["earned_cents"] == 1_000
    assert body["total"]["uncredited_proventos_cents"] == 0
    month = body["current_month"]
    assert (month["appreciation_cents"], month["proventos_cents"]) == (1_000, 0)
    assert month["has_update"] is True


def test_an_uncredited_provento_is_added_to_the_month_and_to_the_total(client, make_asset):
    fii = make_asset(name="FII", invested=100_000, current=100_000, valuation_date="2026-09-30")
    response = client.post(
        f"{API}/proventos",
        json={"asset_id": fii["id"], "amount_cents": 700, "date": "2026-10-05"},
    )
    assert response.status_code == 201

    body = earnings(client)

    month = body["current_month"]
    assert (month["appreciation_cents"], month["proventos_cents"], month["earned_cents"]) == (
        0,
        700,
        700,
    )
    assert body["total"]["earned_cents"] == 700
    assert body["total"]["uncredited_proventos_cents"] == 700


def test_gain_from_before_the_registration_is_kept_out_of_every_month(client, make_asset):
    make_asset(invested=100_000, current=130_000, valuation_date="2026-10-03")

    body = earnings(client)

    assert body["total"]["earned_cents"] == 30_000
    assert body["total"]["before_tracking_cents"] == 30_000
    assert body["total"]["since_tracking_cents"] == 0
    assert [m["earned_cents"] for m in body["months"]] == [0]
    assert body["tracking_since"] == "2026-10-03"
    assert body["current_month"]["has_update"] is False  # só o cadastro
    assert body["last_complete_month"] is None


def test_the_current_month_is_partial_and_the_last_complete_month_is_not(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-08-31")
    balance(client, asset, "2026-09-30", 101_000)

    body = earnings(client)

    assert (body["current_month"]["partial"], body["current_month"]["through"]) == (
        True,
        "2026-10-17",
    )
    assert body["last_complete_month"]["partial"] is False
    assert body["last_complete_month"]["earned_cents"] == 1_000
    assert body["current_month"]["has_update"] is False  # outubro ainda sem saldo nem provento


def test_there_is_no_pace_without_a_complete_month(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-10-03")
    balance(client, asset, "2026-10-10", 101_000)

    assert earnings(client)["pace"] is None


def test_a_losing_month_is_negative_everywhere(client, make_asset):
    asset = make_asset(invested=100_000, current=110_000, valuation_date="2026-08-31")
    balance(client, asset, "2026-09-30", 104_000)
    set_salary(client, "2026-09", 500_000)

    body = earnings(client)

    september = body["last_complete_month"]
    assert (september["earned_cents"], september["salary_share_bps"]) == (-6_000, -120)
    assert body["vs_salary"]["work_minutes"] is None
    assert body["pace"]["per_day_cents"] == -200


def test_archiving_an_asset_keeps_its_history_in_the_past_months(client, make_asset):
    """Arquivar significa "não está mais na carteira", não "nunca esteve": agosto não muda."""
    keep = make_asset(name="Fica", invested=100_000, current=100_000, valuation_date="2026-07-31")
    gone = make_asset(name="Sai", invested=100_000, current=100_000, valuation_date="2026-07-31")
    balance(client, keep, "2026-08-31", 100_000)
    balance(client, gone, "2026-08-31", 110_000)  # rendeu R$ 100 em agosto
    balance(client, keep, "2026-09-30", 100_000)
    balance(client, gone, "2026-09-30", 110_000)

    def months():
        return {m["month"]: m["earned_cents"] for m in earnings(client)["months"]}

    before = months()
    assert before["2026-08"] == 10_000
    assert before["2026-09"] == 0

    archive(client, gone)

    assert months() == before
    assert earnings(client)["total"]["earned_cents"] == 10_000


def test_an_archived_asset_earns_nothing_after_it_left_the_portfolio(client, make_asset):
    gone = make_asset(name="Sai", invested=100_000, current=100_000, valuation_date="2026-08-31")
    balance(client, gone, "2026-09-10", 105_000)
    archive(client, gone)
    keep = make_asset(name="Fica", invested=100_000, current=100_000, valuation_date="2026-09-30")
    balance(client, keep, "2026-10-10", 101_000)

    months = {m["month"]: m["earned_cents"] for m in earnings(client)["months"]}

    assert months["2026-09"] == 5_000
    assert months["2026-10"] == 1_000  # o ganho parado do arquivado não se repete


def test_proventos_of_archived_assets_stay_in_the_months_they_were_paid(client, make_asset):
    gone = make_asset(name="Sai", invested=100_000, current=100_000, valuation_date="2026-09-30")
    assert (
        client.post(
            f"{API}/proventos",
            json={"asset_id": gone["id"], "amount_cents": 900, "date": "2026-10-11"},
        ).status_code
        == 201
    )
    archive(client, gone)

    body = earnings(client)

    assert body["total"]["uncredited_proventos_cents"] == 900
    assert body["current_month"]["proventos_cents"] == 900


def test_the_emergency_reserve_counts_as_earnings(client, make_asset):
    reserve = make_asset(
        name="Reserva",
        invested=100_000,
        current=100_000,
        purpose="reserva",
        valuation_date="2026-09-30",
    )
    balance(client, reserve, "2026-10-10", 101_200)

    assert earnings(client)["total"]["earned_cents"] == 1_200


# ---- salário -----------------------------------------------------------------------------


def test_the_salary_comes_from_the_same_month_or_the_most_recent_one_before(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-07-31")
    balance(client, asset, "2026-08-31", 101_000)
    balance(client, asset, "2026-09-30", 102_000)
    assert earnings(client)["salary"] is None  # nenhum aporte registrado

    set_salary(client, "2026-08", 400_000)
    set_salary(client, "2026-09", 500_000)

    body = earnings(client)

    assert body["salary"] == {"salary_cents": 500_000, "month": "2026-10"}  # herdado de setembro
    by_month = {m["month"]: m["salary_share_bps"] for m in body["months"]}
    assert by_month["2026-07"] == 0  # antes do primeiro salário vale o mais antigo (agosto)
    assert by_month["2026-08"] == 25  # 1.000 de 400.000
    assert by_month["2026-09"] == 20  # 1.000 de 500.000
    assert by_month["2026-10"] == 0  # outubro herda o salário de setembro


def test_the_oldest_salary_stands_in_for_months_before_the_first_one(client, make_asset):
    # Caso do banco real: só há salário em outubro, e o último mês completo é setembro.
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-08-31")
    balance(client, asset, "2026-09-30", 101_500)
    set_salary(client, "2026-10", 500_000)

    body = earnings(client)

    assert body["vs_salary"] == {
        "month": "2026-09",
        "earned_cents": 1_500,
        "share_bps": 30,
        "work_minutes": 40,
    }
    assert body["last_complete_month"]["salary_share_bps"] == 30
    assert body["salary"] == {"salary_cents": 500_000, "month": "2026-10"}


def test_vs_salary_ignores_a_complete_month_without_update(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-07-31")
    balance(client, asset, "2026-08-31", 101_500)  # setembro sem atualização
    set_salary(client, "2026-08", 500_000)

    body = earnings(client)

    assert body["last_complete_month"]["has_update"] is False
    assert body["vs_salary"]["month"] == "2026-08"
