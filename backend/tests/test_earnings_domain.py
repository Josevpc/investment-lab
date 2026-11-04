import datetime as dt

from app.features.earnings.domain import (
    ProventoPoint,
    RedemptionPoint,
    ValuationPoint,
    compute_earnings,
    share_of_salary_bps,
    work_minutes,
)

TODAY = dt.date(2026, 10, 17)


def day(text: str) -> dt.date:
    return dt.date.fromisoformat(text)


def val(asset: int, when: str, invested: int, current: int, observed: bool = True):
    return ValuationPoint(asset, day(when), invested, current, observed)


def prov(when: str, amount: int, credited: bool = False):
    return ProventoPoint(day(when), amount, credited)


def run(valuations, proventos=(), salary=None, redemptions=()):
    """`salary` pode ser um valor fixo, um dict mês -> salário ou None (sem salário)."""

    def salary_of(month):
        return salary.get(month) if isinstance(salary, dict) else salary

    return compute_earnings(list(valuations), list(proventos), salary_of, TODAY, list(redemptions))


def months(result):
    return {m.month: m for m in result.months}


def milestones(result):
    return {m.key: m.achieved_month for m in result.milestones}


# ---- o que conta como rendimento ----------------------------------------------------------


def test_a_contribution_adds_to_invested_and_balance_so_it_never_counts_as_earnings():
    result = run(
        [
            val(1, "2026-09-30", 100_000, 105_000),
            val(1, "2026-10-15", 120_000, 126_000),  # aporte de 20.000 e 1.000 de rendimento
        ]
    )

    assert months(result)["2026-10"].earned_cents == 1_000
    assert result.total.earned_cents == 6_000


def test_a_transfer_between_assets_does_not_change_the_total():
    result = run(
        [
            val(1, "2026-09-30", 100_000, 110_000),
            val(2, "2026-09-30", 50_000, 50_000),
            # Transferência de 55.000 de 1 para 2: o custo (50.000) vai junto.
            val(1, "2026-10-10", 50_000, 55_000, observed=False),
            val(2, "2026-10-10", 100_000, 105_000, observed=False),
        ]
    )

    assert result.total.earned_cents == 10_000
    assert months(result)["2026-10"].earned_cents == 0
    assert months(result)["2026-10"].has_update is False  # linhas de transferência não são saldo


def test_a_credited_provento_is_counted_once_through_the_balance_that_received_it():
    result = run(
        [
            val(1, "2026-09-30", 100_000, 100_000),
            val(2, "2026-09-30", 50_000, 50_000),
            val(2, "2026-10-10", 50_000, 51_000, observed=False),  # o provento entrou no saldo
        ],
        [prov("2026-10-10", 1_000, credited=True)],
    )

    october = months(result)["2026-10"]
    assert (october.appreciation_cents, october.proventos_cents) == (1_000, 0)
    assert result.total.earned_cents == 1_000
    assert result.total.uncredited_proventos_cents == 0
    assert october.has_update is True  # o provento é uma atualização do mês


def test_an_uncredited_provento_is_added_apart_from_the_balances():
    result = run([val(1, "2026-09-30", 100_000, 100_000)], [prov("2026-10-05", 700)])

    october = months(result)["2026-10"]
    assert (october.appreciation_cents, october.proventos_cents, october.earned_cents) == (
        0,
        700,
        700,
    )
    assert result.total.earned_cents == 700
    assert result.total.uncredited_proventos_cents == 700
    assert result.total.since_tracking_cents == 700
    assert october.has_update is True


def test_a_future_provento_has_not_earned_anything_yet():
    result = run([val(1, "2026-09-30", 100_000, 100_000)], [prov("2026-10-20", 700)])

    assert result.total.uncredited_proventos_cents == 0
    assert result.total.earned_cents == 0


def test_gain_the_assets_already_had_when_registered_belongs_to_no_month():
    result = run(
        [
            val(1, "2026-09-15", 100_000, 130_000),  # já chegou com 30.000 de ganho
            val(1, "2026-09-30", 100_000, 132_000),
            val(2, "2026-10-03", 50_000, 55_000),  # cadastrado em outubro, ganho de 5.000
            val(2, "2026-10-10", 50_000, 56_000),
        ]
    )

    assert result.tracking_since == day("2026-09-15")
    assert result.total.before_tracking_cents == 35_000
    assert result.total.earned_cents == 38_000
    assert result.total.since_tracking_cents == 3_000
    assert months(result)["2026-09"].earned_cents == 2_000
    assert months(result)["2026-10"].earned_cents == 1_000
    assert sum(m.earned_cents for m in result.months) == result.total.since_tracking_cents


def test_months_always_add_up_to_the_total_since_tracking_even_with_old_proventos():
    result = run(
        [val(1, "2026-09-30", 100_000, 100_000), val(1, "2026-10-12", 100_000, 101_500)],
        [prov("2026-08-10", 300), prov("2026-09-02", 200, credited=True)],
    )

    assert result.months[0].month == "2026-08"  # o provento antigo abre o histórico
    assert sum(m.earned_cents for m in result.months) == result.total.since_tracking_cents
    assert result.total.since_tracking_cents == 1_800


# ---- meses -------------------------------------------------------------------------------


def test_a_month_without_any_update_is_not_a_month_that_earned_zero():
    result = run(
        [
            val(1, "2026-08-31", 100_000, 100_000),  # só o cadastro
            val(1, "2026-10-05", 100_000, 101_000),
        ]
    )

    assert months(result)["2026-08"].has_update is False  # o cadastro é o ponto de partida
    assert months(result)["2026-09"].has_update is False
    assert months(result)["2026-10"].has_update is True


def test_the_current_month_is_partial_and_measured_until_today():
    result = run([val(1, "2026-09-30", 100_000, 105_000), val(1, "2026-10-15", 120_000, 126_000)])

    current, previous = result.months[-1], result.months[-2]
    assert (current.month, current.partial, current.through) == ("2026-10", True, TODAY)
    assert (previous.month, previous.partial, previous.through) == (
        "2026-09",
        False,
        day("2026-09-30"),
    )


def test_a_negative_month_is_negative_and_has_no_work_minutes():
    result = run(
        [val(1, "2026-08-31", 100_000, 110_000), val(1, "2026-09-30", 100_000, 104_000)],
        salary=500_000,
    )

    september = months(result)["2026-09"]
    assert september.earned_cents == -6_000
    assert september.salary_share_bps == -120
    assert result.vs_salary is not None
    assert (result.vs_salary.month, result.vs_salary.earned_cents) == ("2026-09", -6_000)
    assert (result.vs_salary.share_bps, result.vs_salary.work_minutes) == (-120, None)


def test_each_month_is_compared_with_the_salary_of_its_own_month():
    result = run(
        [
            val(1, "2026-08-31", 100_000, 100_000),
            val(1, "2026-09-30", 100_000, 101_000),
            val(1, "2026-10-10", 100_000, 102_000),
        ],
        salary={"2026-09": 100_000, "2026-10": 200_000},
    )

    assert months(result)["2026-08"].salary_share_bps is None  # sem salário nesse mês
    assert months(result)["2026-09"].salary_share_bps == 100
    assert months(result)["2026-10"].salary_share_bps == 50


# ---- ritmo -------------------------------------------------------------------------------


def test_pace_averages_the_last_three_complete_months_with_an_update_rounding_half_up():
    result = run(
        [
            val(1, "2026-05-31", 100_000, 100_000),
            val(1, "2026-06-30", 100_000, 101_000),  # quarto mês: fica de fora
            val(1, "2026-07-31", 100_000, 104_000),
            val(1, "2026-08-31", 100_000, 107_000),
            val(1, "2026-09-30", 100_000, 110_246),
        ]
    )

    # (3.000 + 3.000 + 3.246) em 92 dias (31 + 31 + 30) = 100,5 por dia
    assert result.pace is not None
    assert (result.pace.per_day_cents, result.pace.basis_months) == (101, 3)
    assert (result.pace.from_month, result.pace.to_month) == ("2026-07", "2026-09")


def test_pace_skips_complete_months_without_update():
    result = run(
        [
            val(1, "2026-07-31", 100_000, 100_000),
            val(1, "2026-08-31", 100_000, 103_100),  # 3.100 em 31 dias = 100 por dia
            # setembro sem atualização
        ]
    )

    assert result.pace is not None
    assert (result.pace.per_day_cents, result.pace.basis_months) == (100, 1)
    assert (result.pace.from_month, result.pace.to_month) == ("2026-08", "2026-08")


def test_pace_can_be_negative():
    result = run([val(1, "2026-08-31", 100_000, 110_000), val(1, "2026-09-30", 100_000, 104_000)])

    assert result.pace is not None and result.pace.per_day_cents == -200  # -6.000 em 30 dias


def test_there_is_no_pace_without_a_complete_month_with_update():
    result = run([val(1, "2026-09-30", 100_000, 105_000), val(1, "2026-10-15", 120_000, 126_000)])

    assert result.pace is None


# ---- comparação com o salário -----------------------------------------------------------


def test_share_and_work_minutes_round_half_up():
    assert share_of_salary_bps(3, 20_000) == 2  # 1,5
    assert share_of_salary_bps(1, 20_000) == 1  # 0,5
    assert share_of_salary_bps(1, 40_000) == 0  # 0,25
    assert work_minutes(5, 26_400) == 3  # 2,5 minutos
    assert work_minutes(1, 26_400) == 1  # 0,5 minuto
    assert work_minutes(0, 26_400) is None
    assert work_minutes(-5, 26_400) is None


def test_share_is_unknown_without_a_usable_salary():
    assert share_of_salary_bps(1_000, None) is None
    assert share_of_salary_bps(1_000, 0) is None


def test_vs_salary_uses_the_last_complete_month():
    result = run(
        [val(1, "2026-08-31", 100_000, 100_000), val(1, "2026-09-30", 100_000, 101_500)],
        salary=500_000,
    )

    assert result.vs_salary is not None
    assert result.vs_salary.month == "2026-09"
    assert result.vs_salary.share_bps == 30
    assert result.vs_salary.work_minutes == 40  # 1.500 * 13.200 / 500.000 = 39,6


def test_vs_salary_falls_back_to_the_partial_current_month_when_nothing_is_complete():
    result = run(
        [val(1, "2026-10-03", 100_000, 100_000), val(1, "2026-10-10", 100_000, 100_900)],
        salary=500_000,
    )

    assert result.vs_salary is not None
    assert (result.vs_salary.month, result.vs_salary.earned_cents) == ("2026-10", 900)
    assert (result.vs_salary.share_bps, result.vs_salary.work_minutes) == (18, 24)


def test_vs_salary_is_missing_without_salary():
    result = run([val(1, "2026-08-31", 100_000, 100_000), val(1, "2026-09-30", 100_000, 101_500)])

    assert result.vs_salary is None


def test_vs_salary_skips_a_complete_month_without_update_instead_of_calling_it_zero():
    result = run(
        [
            val(1, "2026-07-31", 100_000, 100_000),
            val(1, "2026-08-31", 100_000, 101_500),
            # setembro sem saldo nem provento; outubro (parcial) também sem
        ],
        salary=500_000,
    )

    assert months(result)["2026-09"].has_update is False
    assert result.vs_salary is not None
    assert (result.vs_salary.month, result.vs_salary.earned_cents) == ("2026-08", 1_500)


def test_vs_salary_accepts_a_month_updated_only_by_a_provento():
    result = run(
        [val(1, "2026-08-31", 100_000, 100_000)],
        [prov("2026-09-10", 82)],
        salary=500_000,
    )

    assert result.vs_salary is not None
    assert (result.vs_salary.month, result.vs_salary.earned_cents) == ("2026-09", 82)


def test_vs_salary_uses_the_partial_month_only_if_no_complete_month_has_an_update():
    result = run(
        [val(1, "2026-08-31", 100_000, 100_000), val(1, "2026-10-10", 100_000, 100_900)],
        salary=500_000,
    )

    assert months(result)["2026-09"].has_update is False
    assert result.vs_salary is not None and result.vs_salary.month == "2026-10"


def test_vs_salary_is_missing_when_no_month_has_an_update():
    result = run([val(1, "2026-08-31", 100_000, 100_000)], salary=500_000)

    assert result.vs_salary is None


def test_a_valuation_dated_after_today_does_not_count_yet():
    result = run(
        [
            val(1, "2026-09-30", 100_000, 105_000),
            val(1, "2026-10-25", 100_000, 120_000),  # futuro
            val(2, "2026-11-01", 100_000, 150_000),  # ativo só com registro futuro
        ]
    )

    assert result.total.earned_cents == 5_000
    assert result.total.before_tracking_cents == 5_000
    assert result.tracking_since == day("2026-09-30")


# ---- carteira vazia ----------------------------------------------------------------------


def test_an_empty_portfolio_is_all_zeros_without_errors():
    result = run([], salary=500_000)

    assert result.tracking_since is None
    assert (result.total.earned_cents, result.total.since_tracking_cents) == (0, 0)
    assert [(m.month, m.earned_cents, m.partial) for m in result.months] == [("2026-10", 0, True)]
    assert result.pace is None and result.vs_salary is None
    assert all(achieved is None for achieved in milestones(result).values())
    assert result.next_milestone is not None
    assert (result.next_milestone.key, result.next_milestone.progress_bps) == ("first_salary", 0)


# ---- marcos ------------------------------------------------------------------------------


def test_all_milestones_are_listed_in_order_with_their_kinds_and_thresholds():
    result = run([])

    assert [(m.key, m.kind, m.threshold) for m in result.milestones] == [
        ("first_salary", "first", None),
        ("share_1", "monthly_share", 100),
        ("share_5", "monthly_share", 500),
        ("share_10", "monthly_share", 1_000),
        ("share_25", "monthly_share", 2_500),
        ("share_50", "monthly_share", 5_000),
        ("share_100", "monthly_share", 10_000),
        ("total_100", "total_amount", 10_000),
        ("total_1000", "total_amount", 100_000),
        ("total_10000", "total_amount", 1_000_000),
        ("total_100000", "total_amount", 10_000_000),
    ]


def test_first_salary_is_the_first_complete_month_that_earned_something():
    result = run(
        [
            val(1, "2026-07-31", 100_000, 100_000),
            val(1, "2026-08-31", 100_000, 100_500),
        ]
    )

    assert milestones(result)["first_salary"] == "2026-08"
    assert result.next_milestone is not None and result.next_milestone.key != "first_salary"


def test_a_gain_only_in_the_partial_month_does_not_give_the_first_salary():
    result = run(
        [val(1, "2026-09-30", 100_000, 100_000), val(1, "2026-10-10", 100_000, 120_000)],
        salary=1_000,
    )

    assert milestones(result)["first_salary"] is None
    assert milestones(result)["share_1"] is None  # mês em andamento ainda pode perder o ganho
    assert result.next_milestone is not None
    assert (result.next_milestone.key, result.next_milestone.progress_bps) == ("first_salary", 0)


def test_monthly_share_milestone_is_reached_by_a_complete_month_and_next_shows_progress():
    result = run(
        [val(1, "2026-07-31", 100_000, 100_000), val(1, "2026-08-31", 100_000, 101_500)],
        salary=100_000,  # 1.500 de 100.000 = 1,5% do salário
    )

    reached = milestones(result)
    assert reached["share_1"] == "2026-08"
    assert reached["share_5"] is None
    assert result.next_milestone is not None
    # 150 bps do melhor mês contra os 500 bps do marco de 5%: 30%
    assert (result.next_milestone.key, result.next_milestone.progress_bps) == ("share_5", 3_000)


def test_total_amount_milestone_follows_what_was_earned_since_tracking_without_any_salary():
    result = run(
        [
            val(1, "2026-07-31", 100_000, 100_000),
            val(1, "2026-08-31", 100_000, 106_000),
            val(1, "2026-09-30", 100_000, 111_000),
        ]
    )

    reached = milestones(result)
    assert reached["total_100"] == "2026-09"  # 6.000 em agosto, 11.000 acumulados em setembro
    assert reached["total_1000"] is None
    assert reached["share_1"] is None  # sem salário não há marco de proporção
    assert result.next_milestone is not None
    assert (result.next_milestone.key, result.next_milestone.progress_bps) == ("share_1", 0)


def test_total_amount_progress_is_shown_once_the_share_milestones_are_done():
    result = run(
        [
            val(1, "2026-07-31", 100_000, 100_000),
            val(1, "2026-08-31", 100_000, 106_000),
            val(1, "2026-09-30", 100_000, 111_000),
        ],
        salary=1_000,
    )

    assert milestones(result)["share_100"] == "2026-08"
    assert result.next_milestone is not None
    # 11.000 de 100.000 (R$ 1.000)
    assert (result.next_milestone.key, result.next_milestone.progress_bps) == ("total_1000", 1_100)


def test_the_gain_assets_had_before_tracking_does_not_count_for_the_total_milestone():
    result = run([val(1, "2026-09-30", 100_000, 2_000_000)])

    assert milestones(result)["total_100"] is None


def test_the_partial_month_counts_for_the_total_milestone():
    result = run(
        [val(1, "2026-09-30", 100_000, 100_000), val(1, "2026-10-10", 100_000, 120_000)],
    )

    assert milestones(result)["total_100"] == "2026-10"


def test_total_milestone_counts_the_partial_month_and_can_go_back_if_the_balance_drops():
    reached = run([val(1, "2026-09-30", 100_000, 100_000), val(1, "2026-10-10", 100_000, 120_000)])
    assert milestones(reached)["total_100"] == "2026-10"  # 20.000 no mês em andamento

    dropped = run([val(1, "2026-09-30", 100_000, 100_000), val(1, "2026-10-15", 100_000, 105_000)])
    assert milestones(dropped)["total_100"] is None  # o saldo recuou: deixa de contar


def test_there_is_no_next_milestone_when_everything_was_reached():
    result = run(
        [val(1, "2026-08-31", 100_000, 100_000), val(1, "2026-09-30", 100_000, 10_100_000)],
        salary=1_000,
    )

    assert all(achieved == "2026-09" for achieved in milestones(result).values())
    assert result.next_milestone is None


def test_progress_never_shows_one_hundred_percent_for_a_pending_milestone():
    # Falta 1 centavo para R$ 100.000: 9.999,9999 bps arredondaria para 10.000.
    result = run(
        [val(1, "2026-08-31", 100_000, 100_000), val(1, "2026-09-30", 100_000, 10_099_999)],
        salary=1_000,
    )

    assert result.next_milestone is not None
    assert (result.next_milestone.key, result.next_milestone.progress_bps) == (
        "total_100000",
        9_999,
    )


# ---- o mês corrente, acompanhado durante o mês --------------------------------------------


def test_the_current_month_is_measured_until_the_last_balance_typed_not_until_today():
    result = run(
        [
            val(1, "2026-09-30", 100_000, 100_000),
            val(1, "2026-10-06", 100_000, 100_500),
            val(1, "2026-10-13", 100_000, 101_300),
        ]
    )

    october = months(result)["2026-10"]
    assert october.through == TODAY  # o mês vai até hoje
    assert october.measured_through == day("2026-10-13")  # mas o saldo vai até a última digitação
    assert october.earned_cents == 1_300


def test_only_typed_balances_and_proventos_move_the_measured_date():
    result = run(
        [
            val(1, "2026-09-30", 100_000, 100_000),
            val(1, "2026-10-06", 100_000, 100_500),
            val(
                1, "2026-10-12", 90_000, 90_800, observed=False
            ),  # transferência: não é saldo digitado
        ],
        proventos=[prov("2026-10-15", 300)],
    )

    assert months(result)["2026-10"].measured_through == day("2026-10-15")  # o provento conta

    without_provento = run(
        [
            val(1, "2026-09-30", 100_000, 100_000),
            val(1, "2026-10-06", 100_000, 100_500),
            val(1, "2026-10-12", 90_000, 90_800, observed=False),
        ]
    )
    assert months(without_provento)["2026-10"].measured_through == day("2026-10-06")


def test_a_month_without_update_has_no_measured_date_pace_or_work_minutes():
    result = run([val(1, "2026-09-30", 100_000, 100_000)], salary=500_000)

    october = months(result)["2026-10"]
    assert october.has_update is False
    assert (october.measured_through, october.per_day_cents, october.work_minutes) == (
        None,
        None,
        None,
    )


def test_the_current_month_pace_divides_by_the_days_until_the_last_balance():
    result = run(
        [val(1, "2026-09-30", 100_000, 100_000), val(1, "2026-10-13", 100_000, 101_300)],
    )

    # R$ 13,00 em 13 dias (de 1 a 13 de outubro): R$ 1,00 por dia, e não 13/17.
    assert months(result)["2026-10"].per_day_cents == 100


def test_the_pace_of_a_complete_month_divides_by_all_its_days_and_rounds_half_up():
    result = run(
        [val(1, "2026-08-31", 100_000, 100_000), val(1, "2026-09-30", 100_000, 100_135)],
    )

    # 135 centavos em 30 dias = 4,5: arredonda meio para cima.
    assert months(result)["2026-09"].per_day_cents == 5


def test_the_current_month_work_minutes_follow_the_salary_of_that_month():
    result = run(
        [val(1, "2026-09-30", 100_000, 100_000), val(1, "2026-10-13", 100_000, 101_000)],
        salary={"2026-10": 500_000},
    )

    october = months(result)["2026-10"]
    # R$ 10,00 sobre R$ 5.000,00 de salário, jornada de 220 h: 26,4 minutos.
    assert october.work_minutes == 26
    assert october.salary_share_bps == 20


def test_work_minutes_need_a_salary_and_a_gain():
    no_salary = run(
        [val(1, "2026-09-30", 100_000, 100_000), val(1, "2026-10-13", 100_000, 101_000)]
    )
    assert months(no_salary)["2026-10"].work_minutes is None

    loss = run(
        [val(1, "2026-09-30", 100_000, 100_000), val(1, "2026-10-13", 100_000, 99_000)],
        salary=500_000,
    )
    assert months(loss)["2026-10"].work_minutes is None
    assert months(loss)["2026-10"].per_day_cents == -77  # -1.000 em 13 dias = -76,9 por dia


# ---- resgate: o ganho que saiu junto com o dinheiro volta à conta ---------------------------


def redemption(when: str, amount: int, cost: int, asset: int = 1):
    return RedemptionPoint(asset, day(when), amount, cost)


def test_a_redemption_does_not_turn_the_withdrawn_gain_into_a_loss():
    # Ganho de 10.000; sai R$ 110 com custo 100 (ganho realizado 10): sobra (90, 99).
    valuations = [val(1, "2026-09-30", 100_000, 110_000), val(1, "2026-10-10", 90_000, 99_000)]

    without = run(valuations)
    result = run(valuations, redemptions=[redemption("2026-10-10", 11_000, 10_000)])

    assert months(without)["2026-10"].earned_cents == -1_000  # sem o ajuste parece prejuízo
    assert months(result)["2026-10"].earned_cents == 0
    assert result.total.earned_cents == 10_000


def test_a_redemption_only_counts_from_its_effective_date():
    valuations = [
        val(1, "2026-08-31", 100_000, 110_000),
        val(1, "2026-09-30", 100_000, 121_000),
        val(1, "2026-10-10", 90_000, 108_900),  # saldo digitado já sem os R$ 121,00
    ]

    result = run(valuations, redemptions=[redemption("2026-10-10", 12_100, 10_000)])

    assert months(result)["2026-09"].earned_cents == 11_000  # setembro não é tocado
    assert (
        months(result)["2026-10"].earned_cents == 0
    )  # 18.900 + 2.100 de ganho realizado = 21.000, como antes


def test_a_redemption_on_the_first_day_does_not_inflate_the_first_month():
    # A linha de cadastro já saiu reduzida (90.000, 99.000): o ganho realizado é "de antes".
    valuations = [val(1, "2026-09-30", 90_000, 99_000), val(1, "2026-10-31", 90_000, 99_000)]

    result = run(valuations, redemptions=[redemption("2026-09-30", 11_000, 10_000)])

    assert result.total.before_tracking_cents == 10_000
    assert months(result)["2026-09"].earned_cents == 0
    assert result.total.earned_cents == 10_000


def test_redemptions_of_unknown_assets_and_future_dates_are_ignored():
    valuations = [val(1, "2026-09-30", 100_000, 110_000)]

    result = run(
        valuations,
        redemptions=[
            redemption("2026-10-10", 500, 100, asset=9),
            redemption("2026-12-01", 500, 100),
        ],
    )

    assert result.total.earned_cents == 10_000
