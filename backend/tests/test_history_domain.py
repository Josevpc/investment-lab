from app.features.history.domain import combine_contributions


def test_diary_month_ignores_the_plan_even_when_the_plan_is_larger():
    result = combine_contributions({"2026-02": 30_000}, {"2026-02": 50_000})
    assert (result.cents, result.source, result.estimated_months) == (30_000, "diario", [])


def test_month_without_diary_uses_the_plan_and_is_estimated():
    result = combine_contributions({}, {"2026-03": 70_000, "2026-02": 50_000})
    assert (result.cents, result.source) == (120_000, "planejado")
    assert result.estimated_months == ["2026-02", "2026-03"]


def test_mixed_when_there_are_diary_and_estimated_months():
    result = combine_contributions({"2026-02": 30_000}, {"2026-02": 50_000, "2026-03": 70_000})
    assert (result.cents, result.source, result.estimated_months) == (
        100_000,
        "misto",
        ["2026-03"],
    )


def test_nothing_at_all_is_exact_zero():
    result = combine_contributions({}, {})
    assert (result.cents, result.source, result.estimated_months) == (0, "diario", [])


def test_a_zero_plan_is_not_an_estimate():
    result = combine_contributions({}, {"2026-02": 0})
    assert (result.cents, result.source, result.estimated_months) == (0, "diario", [])


def test_diary_month_netted_to_zero_still_has_diary():
    # O aporte já estava no valor de um ativo novo e saiu do diário: o mês não volta ao plano.
    result = combine_contributions({"2026-02": 0}, {"2026-02": 50_000})
    assert (result.cents, result.source, result.estimated_months) == (0, "diario", [])
