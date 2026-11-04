import datetime as dt

import pytest

API = "/api/v1"


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr("app.features.goals.service._today", lambda: dt.date(2026, 10, 17))


def progress(client):
    response = client.get(f"{API}/goals/progress")
    assert response.status_code == 200, response.text
    return response.json()


def projection(client):
    response = client.get(f"{API}/goals/projection")
    assert response.status_code == 200, response.text
    return response.json()


def save_settings(client, **overrides):
    response = client.put(f"{API}/goals/settings", json=overrides)
    assert response.status_code == 200, response.text
    return response.json()


def define_contribution(client, month, final_cents=100_000):
    response = client.put(
        f"{API}/contributions/{month}",
        json={"salary_cents": 1_000_000, "percent_bps": 1_000, "final_cents": final_cents},
    )
    assert response.status_code in (200, 201), response.text


def close_month(client, asset, month, day, balance, *, contributed=100_000):
    """Aporte definido, aportado nos ativos e fechamento do mês: o mês cumprido."""
    define_contribution(client, month)
    response = client.post(
        f"{API}/assets/{asset['id']}/balance",
        json={"date": day, "balance_cents": balance, "contribution_cents": contributed},
    )
    assert response.status_code == 200, response.text
    assert client.post(f"{API}/snapshots", json={"date": day}).status_code == 201


def states(client):
    return {m["month"]: m["state"] for m in progress(client)["streak"]["months"]}


# ---- configurações ------------------------------------------------------------------------


def test_settings_start_with_neutral_defaults_and_can_be_saved(client):
    defaults = client.get(f"{API}/goals/settings").json()
    assert defaults["net_worth_goal_cents"] == 0
    assert defaults["horizon_years"] == 20
    assert (defaults["conservative_bps"], defaults["base_bps"], defaults["optimistic_bps"]) == (
        600,
        900,
        1_200,
    )

    saved = save_settings(client, net_worth_goal_cents=100_000_000, year_goal_cents=5_000_000)
    assert saved["net_worth_goal_cents"] == 100_000_000
    assert client.get(f"{API}/goals/settings").json() == saved


def test_scenario_returns_must_be_in_ascending_order(client):
    response = client.put(
        f"{API}/goals/settings",
        json={"conservative_bps": 1_000, "base_bps": 900, "optimistic_bps": 1_200},
    )
    assert response.status_code == 422
    assert "ordem crescente" in str(response.json()["detail"])


# ---- sequência ----------------------------------------------------------------------------


def test_progress_without_any_history_is_empty_and_has_no_goal(client):
    body = progress(client)
    assert body["month"] == "2026-10"
    assert (body["streak"]["current"], body["streak"]["best"]) == (0, 0)
    assert body["streak"]["months"] == []
    assert body["net_worth"]["goal_cents"] == 0
    assert body["net_worth"]["reached"] is False
    assert body["year"]["status"] == "sem_base"


def test_consecutive_closed_months_build_the_streak_and_the_open_month_keeps_it(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-06-30")
    close_month(client, asset, "2026-07", "2026-07-31", 205_000)
    close_month(client, asset, "2026-08", "2026-08-31", 310_000)
    close_month(client, asset, "2026-09", "2026-09-30", 415_000)
    define_contribution(client, "2026-10")  # outubro definido, mas ainda sem aporte nem fechamento

    body = progress(client)["streak"]

    assert (body["current"], body["best"], body["current_month_met"]) == (3, 3, False)
    assert states(client) == {
        "2026-07": "met",
        "2026-08": "met",
        "2026-09": "met",
        "2026-10": "open",
    }


def test_a_month_aported_below_the_plan_breaks_the_streak(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-06-30")
    close_month(client, asset, "2026-07", "2026-07-31", 205_000)
    close_month(client, asset, "2026-08", "2026-08-31", 255_000, contributed=50_000)  # faltou
    close_month(client, asset, "2026-09", "2026-09-30", 360_000)

    streak = progress(client)["streak"]

    assert (streak["current"], streak["best"]) == (1, 1)
    assert states(client)["2026-08"] == "missed"


def test_finishing_the_open_month_extends_the_streak(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-08-31")
    close_month(client, asset, "2026-09", "2026-09-30", 205_000)
    close_month(client, asset, "2026-10", "2026-10-15", 310_000)

    streak = progress(client)["streak"]

    assert (streak["current"], streak["current_month_met"]) == (2, True)


def test_contributing_the_planned_amount_counts_before_the_month_is_closed(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-09-30")
    define_contribution(client, "2026-10", 9_000)
    response = client.post(
        f"{API}/assets/{asset['id']}/balance",
        json={"date": "2026-10-10", "balance_cents": 109_000, "contribution_cents": 9_000},
    )
    assert response.status_code == 200
    assert client.get(f"{API}/snapshots").json() == []  # nenhum fechamento ainda

    streak = progress(client)["streak"]

    assert (streak["current"], streak["current_month_met"]) == (1, True)


# ---- patrimônio e ano ---------------------------------------------------------------------


def test_net_worth_progress_follows_the_goal(client, make_asset):
    make_asset(invested=200_000, current=300_000)
    save_settings(client, net_worth_goal_cents=1_000_000)

    net = progress(client)["net_worth"]

    assert net["current_cents"] == 300_000
    assert (net["progress_bps"], net["remaining_cents"], net["reached"]) == (3_000, 700_000, False)


def test_net_worth_goal_is_reached_and_progress_stops_at_one_hundred_percent(client, make_asset):
    make_asset(invested=200_000, current=300_000)
    save_settings(client, net_worth_goal_cents=250_000)

    net = progress(client)["net_worth"]

    assert (net["progress_bps"], net["remaining_cents"], net["reached"]) == (10_000, 0, True)


def test_year_accumulated_starts_from_the_last_closing_of_the_previous_year(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2025-12-31")
    assert client.post(f"{API}/snapshots", json={"date": "2025-12-31"}).status_code == 201
    client.post(
        f"{API}/assets/{asset['id']}/balance",
        json={"date": "2026-03-31", "balance_cents": 160_000, "contribution_cents": 20_000},
    )
    client.post(f"{API}/snapshots", json={"date": "2026-03-31"})
    save_settings(client, year_goal_cents=100_000)

    year = progress(client)["year"]

    assert year["status"] == "ok"
    assert (year["baseline_date"], year["last_date"]) == ("2025-12-31", "2026-03-31")
    assert year["accumulated_cents"] == 60_000
    assert (year["contributions_cents"], year["appreciation_cents"]) == (20_000, 40_000)
    assert (year["progress_bps"], year["remaining_cents"], year["reached"]) == (
        6_000,
        40_000,
        False,
    )


def test_year_without_a_previous_closing_starts_from_the_first_of_the_year(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-01-31")
    client.post(f"{API}/snapshots", json={"date": "2026-01-31"})
    client.post(
        f"{API}/assets/{asset['id']}/balance",
        json={"date": "2026-02-28", "balance_cents": 130_000},
    )
    client.post(f"{API}/snapshots", json={"date": "2026-02-28"})

    year = progress(client)["year"]

    assert (year["status"], year["baseline_date"]) == ("ok", "2026-01-31")
    assert year["accumulated_cents"] == 30_000


def test_year_with_a_single_closing_asks_for_another_one(client, make_asset):
    make_asset(valuation_date="2026-01-31")
    client.post(f"{API}/snapshots", json={"date": "2026-01-31"})

    year = progress(client)["year"]

    assert (year["status"], year["accumulated_cents"]) == ("sem_base", 0)
    assert (year["contributions_source"], year["estimated_months"]) == ("diario", [])


def year_between_closings(client, asset, *, diary_in=()):
    """Fechamentos em 31/01 e 31/03; `diary_in` lista os meses com aporte lançado no diário."""
    assert client.post(f"{API}/snapshots", json={"date": "2026-01-31"}).status_code == 201
    for month in diary_in:
        response = client.post(
            f"{API}/assets/{asset['id']}/balance",
            json={"date": f"{month}-20", "balance_cents": 130_000, "contribution_cents": 30_000},
        )
        assert response.status_code == 200, response.text
    response = client.post(
        f"{API}/assets/{asset['id']}/balance",
        json={"date": "2026-03-31", "balance_cents": 200_000},
    )
    assert response.status_code == 200, response.text
    assert client.post(f"{API}/snapshots", json={"date": "2026-03-31"}).status_code == 201


def test_year_with_only_the_diary_is_exact(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-01-31")
    define_contribution(client, "2026-02", 50_000)  # o plano existe, mas o diário é que vale
    year_between_closings(client, asset, diary_in=["2026-02"])

    year = progress(client)["year"]

    assert year["contributions_cents"] == 30_000
    assert (year["contributions_source"], year["estimated_months"]) == ("diario", [])


def test_year_with_months_without_diary_reports_the_plan_as_an_estimate(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-01-31")
    define_contribution(client, "2026-03", 70_000)
    define_contribution(client, "2026-02", 50_000)
    year_between_closings(client, asset)

    year = progress(client)["year"]

    assert year["contributions_cents"] == 120_000
    assert year["contributions_source"] == "planejado"
    assert year["estimated_months"] == ["2026-02", "2026-03"]  # crescente, "AAAA-MM"


def test_year_mixing_diary_and_plan_is_marked_as_mixed(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-01-31")
    define_contribution(client, "2026-02", 50_000)
    define_contribution(client, "2026-03", 70_000)
    year_between_closings(client, asset, diary_in=["2026-02"])

    year = progress(client)["year"]

    assert year["contributions_cents"] == 30_000 + 70_000
    assert (year["contributions_source"], year["estimated_months"]) == ("misto", ["2026-03"])


# ---- projeção -----------------------------------------------------------------------------


def test_projection_uses_the_manual_contribution_and_finds_the_goal_month(client, make_asset):
    make_asset(invested=300_000, current=300_000)
    save_settings(
        client,
        monthly_cents=100_000,
        horizon_years=2,
        net_worth_goal_cents=1_000_000,
        inflation_bps=0,
        conservative_bps=0,
        base_bps=0,
        optimistic_bps=0,
    )

    body = projection(client)

    assert (body["start_month"], body["start_cents"]) == ("2026-10", 300_000)
    assert (body["monthly_cents"], body["monthly_source"]) == (100_000, "manual")
    assert body["contributed_cents"] == 24 * 100_000
    base = next(s for s in body["scenarios"] if s["key"] == "base")
    assert [p["month"] for p in base["points"]] == ["2026-10", "2027-10", "2028-10"]
    assert base["final_nominal_cents"] == 300_000 + 24 * 100_000
    assert base["final_today_cents"] == base["final_nominal_cents"]  # sem inflação
    assert base["goal_month"] == "2027-05"  # 300 mil + 7 aportes de 100 mil


def test_projection_finds_the_goal_month_in_today_money(client, make_asset):
    make_asset(invested=0, current=0)
    # R$ 1.000,00 por mês, sem rendimento, meta de R$ 10.714,30. Nominalmente ela cai no mês 11
    # (2027-09, R$ 11.000,00). Com 12% de inflação ao ano o mês 12 vale só R$ 10.714,29 de hoje,
    # então em reais de hoje a meta cai no mês 13.
    flat = {
        "monthly_cents": 100_000,
        "horizon_years": 2,
        "net_worth_goal_cents": 1_071_430,
        "conservative_bps": 0,
        "base_bps": 0,
        "optimistic_bps": 0,
    }
    save_settings(client, **flat, inflation_bps=1_200)

    body = projection(client)

    assert body["goal_basis"] == "today"
    base = next(s for s in body["scenarios"] if s["key"] == "base")
    assert base["goal_month"] == "2027-11"  # 2026-10 + 13 meses
    assert base["final_nominal_cents"] == 24 * 100_000  # o contrato nominal segue igual
    assert base["final_today_cents"] < base["final_nominal_cents"]

    save_settings(client, **flat, inflation_bps=0)
    nominal = next(s for s in projection(client)["scenarios"] if s["key"] == "base")
    assert nominal["goal_month"] == "2027-09"  # sem inflação o resultado é o de antes


def test_projection_goal_already_reached_and_never_reached_in_the_horizon(client, make_asset):
    make_asset(invested=500_000, current=500_000)
    flat = {
        "monthly_cents": 0,
        "horizon_years": 1,
        "inflation_bps": 450,
        "conservative_bps": 0,
        "base_bps": 0,
        "optimistic_bps": 0,
    }
    save_settings(client, **flat, net_worth_goal_cents=500_000)
    # Já atingida: o mês de hoje, em todos os cenários.
    assert {s["goal_month"] for s in projection(client)["scenarios"]} == {"2026-10"}

    # Sem aporte nem rendimento e com inflação, o saldo só perde valor: uma meta um centavo acima
    # do patrimônio de hoje nunca chega dentro do horizonte.
    save_settings(client, **flat, net_worth_goal_cents=500_001)
    assert {s["goal_month"] for s in projection(client)["scenarios"]} == {None}


def test_projection_orders_the_scenarios_and_shows_today_money_below_nominal(client, make_asset):
    make_asset(invested=1_000_000, current=1_000_000)
    save_settings(client, monthly_cents=50_000, horizon_years=10)

    scenarios = projection(client)["scenarios"]

    assert [s["key"] for s in scenarios] == ["conservador", "base", "otimista"]
    finals = [s["final_nominal_cents"] for s in scenarios]
    assert finals == sorted(finals) and len(set(finals)) == 3
    assert all(s["final_today_cents"] < s["final_nominal_cents"] for s in scenarios)
    assert scenarios[1]["goal_month"] is None  # sem meta definida


def test_projection_averages_recent_contributions_when_none_is_set(client, make_asset):
    make_asset(invested=100_000, current=100_000)
    define_contribution(client, "2026-08", 100_000)
    define_contribution(client, "2026-09", 200_000)

    body = projection(client)

    assert (body["monthly_cents"], body["monthly_source"], body["monthly_considered"]) == (
        150_000,
        "media",
        2,
    )


def test_projection_without_contributions_says_so(client, make_asset):
    make_asset(invested=100_000, current=100_000)

    body = projection(client)

    assert (body["monthly_cents"], body["monthly_source"]) == (0, "nenhum")
    assert body["scenarios"][0]["final_nominal_cents"] > 100_000  # só o rendimento


# ---- ritmo de aporte ----------------------------------------------------------------------


def aporte(client, asset, day, cents):
    """Aporte lançado no fechamento do dia (saldo qualquer: só o diário importa aqui)."""
    response = client.post(
        f"{API}/assets/{asset['id']}/balance",
        json={"date": day, "balance_cents": 9_000_000, "contribution_cents": cents},
    )
    assert response.status_code == 200, response.text


def pace(client):
    return progress(client)["contribution_pace"]


def test_pace_without_any_contribution_is_empty_and_has_no_suggestion(client):
    body = pace(client)

    assert body["reference_month"] == "2026-09"  # outubro (mês corrente) ainda não terminou
    assert body["goal_cents"] == 0 and body["suggestion"] is None
    assert [(w["months"], w["average_cents"], w["months_with_data"]) for w in body["windows"]] == [
        (3, None, 0),
        (6, None, 0),
        (12, None, 0),
    ]


def test_pace_averages_the_closed_months_and_leaves_the_current_one_out(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-05-31")
    aporte(client, asset, "2026-07-31", 100_000)
    aporte(client, asset, "2026-09-30", 200_000)  # agosto ficou sem aporte
    aporte(client, asset, "2026-10-05", 9_000_000)  # mês corrente: fora da média

    windows = {w["months"]: w for w in pace(client)["windows"]}

    assert (windows[3]["average_cents"], windows[3]["months_with_data"]) == (150_000, 2)
    assert (windows[12]["average_cents"], windows[12]["months_with_data"]) == (150_000, 2)


def test_pace_counts_the_initial_contribution_of_a_new_asset(client, make_asset):
    make_asset(
        name="Novo",
        invested=300_000,
        current=310_000,
        valuation_date="2026-08-10",
        is_new_investment=True,
    )

    windows = {w["months"]: w for w in pace(client)["windows"]}

    assert (windows[3]["average_cents"], windows[3]["months_with_data"]) == (300_000, 1)


def test_pace_suggests_the_six_month_average_when_it_beats_the_goal(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-03-31")
    for day in ("2026-04-30", "2026-06-30", "2026-08-31"):
        aporte(client, asset, day, 120_000)
    save_settings(client, monthly_cents=100_000)

    body = pace(client)

    assert body["goal_cents"] == 100_000
    assert body["suggestion"] == {
        "window_months": 6,
        "average_cents": 120_000,
        "suggested_cents": 120_000,
    }


def test_pace_does_not_suggest_without_enough_months_or_a_higher_average(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-03-31")
    aporte(client, asset, "2026-07-31", 120_000)
    aporte(client, asset, "2026-08-31", 120_000)  # só 2 meses com dado
    save_settings(client, monthly_cents=100_000)
    assert pace(client)["suggestion"] is None

    aporte(client, asset, "2026-09-30", 120_000)  # 3 meses, mas a meta passa a ser igual à média
    save_settings(client, monthly_cents=120_000)
    assert pace(client)["suggestion"] is None

    save_settings(client, monthly_cents=0)  # meta automática: nada a sugerir
    assert pace(client)["suggestion"] is None


def test_year_progress_comes_from_typed_balances_and_not_from_snapshots(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2025-12-20")
    for day, balance in (("2025-12-31", 105_000), ("2026-03-31", 165_000)):
        body = {"date": day, "balance_cents": balance}
        assert client.post(f"{API}/assets/{asset['id']}/balance", json=body).status_code == 200
    assert client.get(f"{API}/snapshots").json() == []

    year = progress(client)["year"]

    # Parte do último saldo digitado de 2025 (31/12), e não do cadastro (20/12).
    assert (year["status"], year["baseline_date"], year["last_date"]) == (
        "ok",
        "2025-12-31",
        "2026-03-31",
    )
    assert year["accumulated_cents"] == 60_000


def test_year_without_two_typed_dates_has_no_base(client, make_asset):
    make_asset(valuation_date="2026-01-31")
    assert progress(client)["year"]["status"] == "sem_base"


def archive_asset(client, asset):
    body = {
        "name": asset["name"],
        "class_key": "renda_fixa",
        "institution_id": asset["institution_id"],
    }
    response = client.put(f"{API}/assets/{asset['id']}", json=body | {"archived": True})
    assert response.status_code == 200, response.text


def test_year_counts_an_archived_balance_as_an_exit_and_not_a_loss(client, make_asset):
    old = make_asset(name="Velho", invested=500_000, current=500_000, valuation_date="2026-01-31")
    parado = make_asset(
        name="Parado", invested=1_000_000, current=1_000_000, valuation_date="2026-01-31"
    )
    archive_asset(client, old)
    body = {"date": "2026-03-31", "balance_cents": 1_000_000}
    assert client.post(f"{API}/assets/{parado['id']}/balance", json=body).status_code == 200

    year = progress(client)["year"]

    assert year["accumulated_cents"] == -500_000
    assert year["archived_out_cents"] == 500_000
    assert year["withdrawals_cents"] == 0
    assert year["appreciation_cents"] == 0


def test_year_does_not_count_an_archived_balance_that_left_in_the_previous_year(client, make_asset):
    old = make_asset(name="Velho", invested=500_000, current=500_000, valuation_date="2025-11-30")
    parado = make_asset(
        name="Parado", invested=1_000_000, current=1_000_000, valuation_date="2025-11-30"
    )
    archive_asset(client, old)
    for day, balance in (("2025-12-31", 1_000_000), ("2026-03-31", 1_030_000)):
        body = {"date": day, "balance_cents": balance}
        assert client.post(f"{API}/assets/{parado['id']}/balance", json=body).status_code == 200

    year = progress(client)["year"]

    # O arquivado já tinha saído em 31/12 (a base do ano): o ano começa sem ele.
    assert (year["baseline_date"], year["accumulated_cents"]) == ("2025-12-31", 30_000)
    assert year["archived_out_cents"] == 0
    assert year["appreciation_cents"] == 30_000


def test_year_without_a_base_has_no_archived_out(client, make_asset):
    make_asset(valuation_date="2026-01-31")
    assert progress(client)["year"]["archived_out_cents"] == 0


def test_year_reports_the_initial_value_of_assets_brought_in_during_the_year(client, make_asset):
    old = make_asset(name="Antigo", invested=100_000, current=100_000, valuation_date="2025-12-31")
    make_asset(name="Trazido", invested=50_000, current=55_000, valuation_date="2026-02-15")
    body = {"date": "2026-03-31", "balance_cents": 160_000}
    assert client.post(f"{API}/assets/{old['id']}/balance", json=body).status_code == 200

    year = progress(client)["year"]

    assert year["new_assets_cents"] == 50_000  # o investido inicial, não os 55_000 de saldo
    # Já está dentro de contributions_cents: não muda o acumulado nem a valorização.
    assert year["accumulated_cents"] == 115_000
    assert year["contributions_cents"] == 50_000
    assert year["appreciation_cents"] == 65_000


def test_year_without_assets_brought_in_has_no_new_assets_value(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2025-12-31")
    body = {"date": "2026-03-31", "balance_cents": 160_000, "contribution_cents": 20_000}
    assert client.post(f"{API}/assets/{asset['id']}/balance", json=body).status_code == 200

    year = progress(client)["year"]

    assert year["new_assets_cents"] == 0
    assert (year["accumulated_cents"], year["contributions_cents"]) == (60_000, 20_000)


def test_year_without_a_base_has_no_new_assets_value(client, make_asset):
    make_asset(valuation_date="2026-01-31")
    assert progress(client)["year"]["new_assets_cents"] == 0
