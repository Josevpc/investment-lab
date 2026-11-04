"""Regras puras das metas: sequência mensal e projeção do patrimônio. Sem banco, sem I/O."""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from app.core.money import BPS

_ONE = Decimal(1)


def month_add(month: str, delta: int) -> str:
    year, number = int(month[:4]), int(month[5:7])
    index = year * 12 + (number - 1) + delta
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def months_range(first: str, last: str) -> list[str]:
    """Todos os meses de `first` a `last`, inclusive."""
    months, current = [], first
    while current <= last:
        months.append(current)
        current = month_add(current, 1)
    return months


# ---- sequência mensal --------------------------------------------------------------------


@dataclass(frozen=True)
class MonthFacts:
    month: str
    planned_cents: int = 0  # aporte do mês definido em "Aporte" (0 = não definido)
    has_plan: bool = False  # o plano foi gravado: o que foi lançado precisa cobri-lo
    executed_cents: int = 0  # aportes lançados nos ativos no mês
    closed: bool = False  # existe fechamento (snapshot) no mês


def month_met(facts: MonthFacts) -> bool:
    """Mês cumprido: aporte definido e, havendo plano gravado, todo o planejado já aportado.

    A recompensa vem ao aportar, não ao fechar o mês. Meses antigos, sem plano gravado, não têm
    como provar o aporte lançado; nesses o fechamento do mês é a prova.
    """
    if facts.planned_cents <= 0:
        return False
    if facts.has_plan:
        return facts.executed_cents >= facts.planned_cents
    return facts.closed


@dataclass(frozen=True)
class Streak:
    current: int
    best: int
    current_month_met: bool
    # mês -> "met" (cumprido), "missed" (passou sem cumprir) ou "open" (mês corrente em andamento)
    states: dict[str, str]


def compute_streak(facts: dict[str, MonthFacts], current_month: str) -> Streak:
    """Sequência de meses cumpridos. O mês corrente ainda em andamento não quebra a sequência."""
    if not facts:
        return Streak(0, 0, False, {})
    first = min(facts)
    states: dict[str, str] = {}
    run = best = 0
    for month in months_range(first, current_month):
        if month_met(facts.get(month, MonthFacts(month))):
            states[month] = "met"
            run += 1
        elif month == current_month:
            states[month] = "open"
        else:
            states[month] = "missed"
            run = 0
        best = max(best, run)
    return Streak(
        current=run,
        best=best,
        current_month_met=states[current_month] == "met",
        states=states,
    )


# ---- projeção ----------------------------------------------------------------------------


def _round(value: Decimal) -> int:
    return int(value.quantize(_ONE, rounding=ROUND_HALF_UP))


def monthly_factor(annual_bps: int) -> Decimal:
    """Fator de crescimento de um mês equivalente à taxa anual (juros compostos)."""
    return (_ONE + Decimal(annual_bps) / BPS) ** (_ONE / 12)


def project(start_cents: int, monthly_cents: int, annual_bps: int, months: int) -> list[int]:
    """Saldo ao fim de cada mês (índice 0 = hoje), com o aporte entrando no fim do mês.

    Arredonda para o centavo a cada mês, meio para cima, como o resto do app.
    """
    factor = monthly_factor(annual_bps)
    balance = start_cents
    balances = [balance]
    for _ in range(months):
        balance = _round(Decimal(balance) * factor) + monthly_cents
        balances.append(balance)
    return balances


def to_today_value(cents: int, inflation_bps: int, months: int) -> int:
    """Poder de compra de hoje de um valor futuro, descontada a inflação."""
    return _round(Decimal(cents) / monthly_factor(inflation_bps) ** months)


def to_today_series(balances: list[int], inflation_bps: int) -> list[int]:
    """Cada saldo mensal (índice 0 = hoje) em poder de compra de hoje.

    A meta de patrimônio é um valor de hoje: R$ 1 milhão daqui a 20 anos compra menos que R$ 1
    milhão agora. Por isso a data de chegada compara a série deflacionada, mês a mês, e não o saldo
    nominal. Arredonda meio para cima, igual a `to_today_value` (os pontos do gráfico batem).
    """
    factor = monthly_factor(inflation_bps)
    return [_round(Decimal(cents) / factor**month) for month, cents in enumerate(balances)]


def first_month_reaching(balances: list[int], goal_cents: int) -> int | None:
    """Quantos meses a partir de hoje até o saldo chegar à meta (0 = já chegou)."""
    if goal_cents <= 0:
        return None
    return next((index for index, value in enumerate(balances) if value >= goal_cents), None)


# ---- ritmo de aporte ---------------------------------------------------------------------

PACE_WINDOWS = (3, 6, 12)  # janelas, em meses completos, que terminam no último mês fechado
SUGGESTION_WINDOW = 6
SUGGESTION_MIN_MONTHS = 3  # menos que isso é pouco dado para sugerir uma meta


@dataclass(frozen=True)
class PaceWindow:
    months: int
    average_cents: int | None  # None: nenhum mês da janela teve aporte
    months_with_data: int


def pace_windows(by_month: dict[str, int], reference_month: str) -> list[PaceWindow]:
    """Média de aporte dos últimos 3, 6 e 12 meses completos, até `reference_month` (inclusive).

    A média é só dos meses em que houve aporte (> 0): mês sem aporte não puxa a média para baixo,
    e `months_with_data` diz em quantos meses ela se apoia. Meio para cima, em centavos.
    """
    windows = []
    for size in PACE_WINDOWS:
        months = months_range(month_add(reference_month, 1 - size), reference_month)
        values = [by_month.get(month, 0) for month in months]
        values = [value for value in values if value > 0]
        average = (2 * sum(values) + len(values)) // (2 * len(values)) if values else None
        windows.append(PaceWindow(size, average, len(values)))
    return windows


def suggested_goal(windows: list[PaceWindow], goal_cents: int) -> PaceWindow | None:
    """A janela de 6 meses, se ela sustenta sugerir uma meta maior.

    Só com meta definida (> 0), média acima dela e ao menos 3 meses com aporte na janela.
    """
    window = next(w for w in windows if w.months == SUGGESTION_WINDOW)
    if goal_cents <= 0 or window.average_cents is None:
        return None
    if window.months_with_data < SUGGESTION_MIN_MONTHS or window.average_cents <= goal_cents:
        return None
    return window
