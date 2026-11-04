from app.features.goals.domain import (
    MonthFacts,
    PaceWindow,
    compute_streak,
    first_month_reaching,
    month_add,
    month_met,
    months_range,
    pace_windows,
    project,
    suggested_goal,
    to_today_series,
    to_today_value,
)


def met(month):
    return MonthFacts(
        month, planned_cents=100_000, has_plan=True, executed_cents=100_000, closed=True
    )


# ---- meses --------------------------------------------------------------------------------


def test_month_add_crosses_years_in_both_directions():
    assert month_add("2026-11", 3) == "2027-02"
    assert month_add("2026-01", -1) == "2025-12"
    assert month_add("2026-10", 0) == "2026-10"


def test_months_range_is_inclusive():
    assert months_range("2026-11", "2027-01") == ["2026-11", "2026-12", "2027-01"]
    assert months_range("2026-10", "2026-10") == ["2026-10"]


# ---- mês cumprido -------------------------------------------------------------------------


def test_a_month_needs_a_defined_contribution():
    assert month_met(met("2026-09"))
    assert not month_met(MonthFacts("2026-09", executed_cents=50_000, closed=True))


def test_with_a_saved_plan_the_executed_contribution_must_cover_it():
    short = MonthFacts("2026-09", planned_cents=100_000, has_plan=True, executed_cents=99_999)
    extra = MonthFacts("2026-09", planned_cents=100_000, has_plan=True, executed_cents=150_000)
    assert not month_met(short)
    assert month_met(extra)


def test_the_month_counts_as_soon_as_the_plan_is_contributed_even_before_closing():
    contributed = MonthFacts(
        "2026-10", planned_cents=9_000, has_plan=True, executed_cents=9_000, closed=False
    )
    assert month_met(contributed)


def test_old_months_without_a_saved_plan_need_the_closing_as_proof():
    legacy = MonthFacts("2026-03", planned_cents=70_000, has_plan=False, closed=True)
    unclosed = MonthFacts("2026-03", planned_cents=70_000, has_plan=False, closed=False)
    assert month_met(legacy)
    assert not month_met(unclosed)


# ---- sequência ----------------------------------------------------------------------------


def test_streak_counts_consecutive_met_months():
    facts = {m: met(m) for m in ("2026-07", "2026-08", "2026-09", "2026-10")}
    streak = compute_streak(facts, "2026-10")
    assert (streak.current, streak.best, streak.current_month_met) == (4, 4, True)


def test_the_month_in_progress_does_not_break_the_streak():
    facts = {m: met(m) for m in ("2026-08", "2026-09")}
    facts["2026-10"] = MonthFacts("2026-10", planned_cents=100_000, has_plan=True)
    streak = compute_streak(facts, "2026-10")
    assert (streak.current, streak.current_month_met) == (2, False)
    assert streak.states["2026-10"] == "open"


def test_a_missed_month_resets_the_streak_but_keeps_the_best():
    facts = {m: met(m) for m in ("2026-05", "2026-06", "2026-07", "2026-09", "2026-10")}
    # 2026-08 não existe: mês sem aporte definido.
    streak = compute_streak(facts, "2026-10")
    assert (streak.current, streak.best) == (2, 3)
    assert streak.states["2026-08"] == "missed"


def test_a_past_month_without_data_is_missed_not_open():
    streak = compute_streak({"2026-08": met("2026-08")}, "2026-10")
    assert streak.states == {"2026-08": "met", "2026-09": "missed", "2026-10": "open"}
    assert streak.current == 0
    assert streak.best == 1


def test_streak_without_any_history_is_zero():
    streak = compute_streak({}, "2026-10")
    assert (streak.current, streak.best, streak.current_month_met) == (0, 0, False)


# ---- projeção -----------------------------------------------------------------------------


def test_projection_at_zero_return_only_adds_the_contributions():
    balances = project(1_000_000, 50_000, 0, 24)
    assert len(balances) == 25
    assert balances[0] == 1_000_000
    assert balances[-1] == 1_000_000 + 24 * 50_000


def test_projection_compounds_to_the_annual_rate_after_twelve_months():
    # 12% ao ano sem aportes: 100.000,00 viram 112.000,00 (a conta mensal arredonda o centavo).
    final = project(10_000_000, 0, 1_200, 12)[-1]
    assert abs(final - 11_200_000) <= 12


def test_projection_adds_the_contribution_at_the_end_of_each_month():
    # Sem rendimento no primeiro mês: o aporte entra depois do juro do mês.
    balances = project(0, 100_000, 1_200, 1)
    assert balances == [0, 100_000]


def test_today_value_discounts_inflation_and_is_neutral_without_it():
    assert to_today_value(1_000_000, 0, 120) == 1_000_000
    # R$ 10.000,00 daqui a 10 anos com 4,5% ao ano valem uns R$ 6.439,28 de hoje.
    assert abs(to_today_value(1_000_000, 450, 120) - 643_928) <= 5


def goal_month_in_today_money(balances, goal, inflation_bps):
    return first_month_reaching(to_today_series(balances, inflation_bps), goal)


def test_today_series_without_inflation_is_the_nominal_series():
    balances = project(300_000, 100_000, 900, 36)
    assert to_today_series(balances, 0) == balances


def test_today_series_matches_the_single_value_conversion_at_every_month():
    balances = project(1_000_000, 50_000, 900, 30)
    series = to_today_series(balances, 450)
    assert series == [to_today_value(value, 450, month) for month, value in enumerate(balances)]


def test_goal_month_without_inflation_is_the_same_as_the_nominal_one():
    balances = project(300_000, 100_000, 0, 24)
    assert goal_month_in_today_money(balances, 1_000_000, 0) == first_month_reaching(
        balances, 1_000_000
    )
    assert goal_month_in_today_money(balances, 1_000_000, 0) == 7  # 300 mil + 7 aportes


def test_goal_month_in_today_money_by_hand():
    # Sem rendimento e com R$ 1.000,00 por mês: no mês 12 há R$ 12.000,00 nominais. Com 12% de
    # inflação ao ano, o mês 12 vale 12.000 / 1,12 = R$ 10.714,2857 de hoje, ou 1.071.429 centavos.
    balances = project(0, 100_000, 0, 24)
    # Meta de 1.071.429: o mês 12 chega exatamente nela (e o mês 11, com 11.000 / 1,12^(11/12),
    # fica em uns 9.915 reais, abaixo).
    assert goal_month_in_today_money(balances, 1_071_429, 1_200) == 12
    # Um centavo acima, o mês 12 não basta: nominalmente a meta cairia no mês 11 (R$ 11.000,00),
    # mas em reais de hoje só chega no mês 13 (13.000 / 1,12^(13/12) = uns R$ 11.498 de hoje).
    assert first_month_reaching(balances, 1_071_430) == 11
    assert goal_month_in_today_money(balances, 1_071_430, 1_200) == 13


def test_goal_month_with_inflation_is_never_before_the_nominal_one():
    for annual_bps in (0, 600, 1_200):
        balances = project(500_000, 80_000, annual_bps, 120)
        nominal = first_month_reaching(balances, 4_000_000)
        for inflation_bps in (0, 100, 450, 1_500):
            today = goal_month_in_today_money(balances, 4_000_000, inflation_bps)
            assert nominal is not None
            assert today is None or today >= nominal, (annual_bps, inflation_bps)


def test_goal_already_reached_is_month_zero_whatever_the_inflation():
    balances = project(5_000_000, 0, 900, 12)
    assert goal_month_in_today_money(balances, 5_000_000, 450) == 0
    assert goal_month_in_today_money(balances, 4_000_000, 1_500) == 0


def test_goal_that_inflation_keeps_out_of_reach_has_no_month():
    # Sem rendimento nem aporte o saldo não cresce: uma meta um centavo acima nunca chega.
    flat = project(1_000_000, 0, 0, 24)
    assert goal_month_in_today_money(flat, 1_000_001, 450) is None
    # Rendimento de 4,5% igual à inflação de 4,5%: o saldo real não cresce, a meta acima não chega.
    real_flat = project(1_000_000, 0, 450, 24)
    assert first_month_reaching(real_flat, 1_040_000) is not None  # nominalmente chega
    assert goal_month_in_today_money(real_flat, 1_040_000, 450) is None  # em reais de hoje, não


def test_first_month_reaching_the_goal():
    balances = [100, 200, 300, 400]
    assert first_month_reaching(balances, 300) == 2
    assert first_month_reaching(balances, 50) == 0
    assert first_month_reaching(balances, 999) is None
    assert first_month_reaching(balances, 0) is None  # sem meta


# ---- ritmo de aporte ----------------------------------------------------------------------


def window(windows, size):
    return next(w for w in windows if w.months == size)


def test_pace_averages_only_the_months_with_contributions_and_rounds_half_up():
    by_month = {"2026-07": 100_001, "2026-08": 0, "2026-09": 100_000}  # agosto sem aporte

    three = window(pace_windows(by_month, "2026-09"), 3)

    # (100.001 + 100.000) / 2 = 100.000,5 -> 100.001; agosto não entra na média nem na contagem.
    assert (three.average_cents, three.months_with_data) == (100_001, 2)


def test_pace_windows_end_on_the_reference_month_and_have_the_right_size():
    # Um aporte por mês, valendo o próprio número do mês: 2026-01 -> 1 ... 2026-09 -> 9.
    by_month = {f"2026-{m:02d}": m * 1_000 for m in range(1, 10)}
    by_month["2025-12"] = 99_000  # fora das janelas de 3 e 6 meses, dentro da de 12
    by_month["2026-10"] = 77_000_000  # o mês corrente nunca entra: a janela termina em setembro

    windows = pace_windows(by_month, "2026-09")

    assert [w.months for w in windows] == [3, 6, 12]
    assert window(windows, 3).average_cents == 8_000  # jul, ago, set = 7, 8, 9
    assert window(windows, 6).average_cents == 6_500  # abr..set = 4..9
    assert window(windows, 12).months_with_data == 10  # dez/25 + jan..set/26
    assert window(windows, 12).average_cents == 14_400  # (99.000 + 45.000) / 10


def test_pace_without_any_contribution_has_no_average():
    windows = pace_windows({}, "2026-09")

    assert all(w.average_cents is None and w.months_with_data == 0 for w in windows)


def test_pace_window_crosses_the_year_boundary():
    windows = pace_windows({"2025-12": 300, "2026-01": 100}, "2026-01")

    assert window(windows, 3).average_cents == 200
    assert window(windows, 3).months_with_data == 2


def pace(average, months_with_data):
    """Janelas em que só a de 6 meses interessa à sugestão."""
    return [
        PaceWindow(3, None, 0),
        PaceWindow(6, average, months_with_data),
        PaceWindow(12, None, 0),
    ]


def test_suggestion_needs_a_goal_an_average_above_it_and_three_months_of_data():
    assert suggested_goal(pace(150_000, 6), 100_000).average_cents == 150_000
    assert suggested_goal(pace(150_000, 3), 100_000).average_cents == 150_000
    assert suggested_goal(pace(150_000, 2), 100_000) is None  # pouco dado
    assert suggested_goal(pace(100_000, 6), 100_000) is None  # igual à meta
    assert suggested_goal(pace(90_000, 6), 100_000) is None  # abaixo da meta
    assert suggested_goal(pace(150_000, 6), 0) is None  # meta automática
    assert suggested_goal(pace(None, 0), 100_000) is None
