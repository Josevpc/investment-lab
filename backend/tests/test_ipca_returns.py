"""IPCA acumulado pro rata dos dias corridos: função pura, com valores calculados à mão."""

import datetime as dt
import math
from decimal import Decimal

from app.features.analytics.performance import ipca_returns, to_bps

D = dt.date


def bps(values):
    return [to_bps(v) for v in values]


def test_a_whole_month_gives_the_published_rate():
    # 31/01 -> 28/02 cobre fevereiro inteiro: IPCA de 0,50% no mês = 50 bps. Janeiro não pesa
    # (a data-base é o último dia dele), então nem precisa estar divulgado.
    result = ipca_returns([D(2026, 1, 31), D(2026, 2, 28)], 0, {"2026-02": 5_000})
    assert result[0] == Decimal(0)
    assert bps(result) == [0, 50]
    assert result[1] == Decimal("0.005")  # exato, sem potência nem ponto flutuante


def test_half_a_month_applies_the_pro_rata_of_calendar_days():
    # Abril tem 30 dias: 15 dias = (1,005)^(15/30) - 1 = 0,24969% = 25 bps (e não 0,5% / 2 = 25,0).
    result = ipca_returns([D(2026, 3, 31), D(2026, 4, 15)], 0, {"2026-04": 5_000})
    assert bps(result) == [0, 25]
    assert math.isclose(float(result[1]), 1.005**0.5 - 1, rel_tol=1e-12)
    # É composto, não linear: a metade linear (0,25%) seria diferente na 5ª casa.
    assert result[1] != Decimal("0.0025")


def test_a_period_inside_the_month_only_takes_its_slice():
    # De 10/04 a 25/04, 15 dias de 30: a mesma fatia, vinda de uma data-base no meio do mês.
    result = ipca_returns([D(2026, 4, 10), D(2026, 4, 25)], 0, {"2026-04": 5_000})
    assert bps(result) == [0, 25]


def test_slices_of_one_month_multiply_back_to_the_whole_month():
    rates = {"2026-01": 4_300}
    whole = ipca_returns([D(2025, 12, 31), D(2026, 1, 31)], 0, rates)[1]
    first = ipca_returns([D(2025, 12, 31), D(2026, 1, 16)], 0, rates)[1]
    second = ipca_returns([D(2026, 1, 16), D(2026, 1, 31)], 0, rates)[1]
    assert abs((1 + first) * (1 + second) - (1 + whole)) < Decimal("1e-20")


def test_months_in_between_compose_whole_and_the_edges_are_pro_rata():
    # 16/01 a 10/03: 15/31 de janeiro (0,40%), fevereiro inteiro (0,50%) e 10/31 de março (0,30%).
    rates = {"2026-01": 4_000, "2026-02": 5_000, "2026-03": 3_000}
    result = ipca_returns([D(2026, 1, 16), D(2026, 2, 28), D(2026, 3, 10)], 0, rates)
    expected = 1.004 ** (15 / 31) * 1.005 * 1.003 ** (10 / 31) - 1
    assert math.isclose(float(result[2]), expected, rel_tol=1e-12)
    assert bps(result) == [0, 69, 79]  # até fevereiro 0,6943%; com março 0,7937%


def test_a_negative_month_is_deflation():
    result = ipca_returns([D(2026, 1, 31), D(2026, 2, 28)], 0, {"2026-02": -5_000})
    assert bps(result) == [0, -50]
    small = ipca_returns([D(2026, 1, 31), D(2026, 2, 28)], 0, {"2026-02": -200})
    assert bps(small) == [0, -2]  # -0,02% do exemplo da fonte


def test_it_rounds_half_up_to_basis_points():
    # 0,005% = 0,5 bp sobe para 1; -0,005% = -0,5 bp sobe para 0 (mesma regra dos demais).
    assert bps(ipca_returns([D(2026, 1, 31), D(2026, 2, 28)], 0, {"2026-02": 50}))[1] == 1
    assert bps(ipca_returns([D(2026, 1, 31), D(2026, 2, 28)], 0, {"2026-02": -50}))[1] == 0


def test_the_leap_day_counts_in_february_of_a_leap_year():
    # Fev/2028 tem 29 dias: 14/02 -> 29/02 são 15 de 29 dias.
    result = ipca_returns([D(2028, 2, 14), D(2028, 2, 29)], 0, {"2028-02": 5_000})
    assert math.isclose(float(result[1]), 1.005 ** (15 / 29) - 1, rel_tol=1e-12)


def test_it_crosses_the_year_boundary():
    rates = {"2025-12": 4_000, "2026-01": 5_000}
    result = ipca_returns([D(2025, 12, 16), D(2026, 1, 31)], 0, rates)
    assert math.isclose(float(result[1]), 1.004 ** (15 / 31) * 1.005 - 1, rel_tol=1e-12)


def test_a_month_not_yet_published_leaves_the_point_empty_without_an_estimate():
    rates = {"2026-02": 5_000}  # março ainda não saiu
    dates = [D(2026, 1, 31), D(2026, 2, 28), D(2026, 3, 15), D(2026, 3, 31)]
    assert ipca_returns(dates, 0, rates)[1:] == [Decimal("0.005"), None, None]


def test_a_gap_in_the_middle_empties_every_later_point():
    rates = {"2026-01": 4_000, "2026-03": 3_000}  # fevereiro faltando
    dates = [D(2026, 1, 15), D(2026, 1, 31), D(2026, 2, 10), D(2026, 3, 31)]
    result = ipca_returns(dates, 0, rates)
    assert result[0] == Decimal(0)
    assert result[1] is not None  # ainda dentro de janeiro
    assert result[2] is None and result[3] is None  # março depende de fevereiro


def test_the_base_month_without_rate_blocks_everything_after_the_base():
    dates = [D(2026, 1, 10), D(2026, 1, 20), D(2026, 2, 28)]
    assert ipca_returns(dates, 0, {"2026-02": 5_000}) == [Decimal(0), None, None]


def test_without_a_base_or_before_it_nothing_is_compared():
    assert ipca_returns([D(2026, 1, 31)], None, {"2026-01": 1}) == [None]
    result = ipca_returns([D(2026, 1, 15), D(2026, 1, 31), D(2026, 2, 28)], 1, {"2026-02": 5_000})
    assert result[0] is None and result[1] == Decimal(0) and bps(result)[2] == 50
