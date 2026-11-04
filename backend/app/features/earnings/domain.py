"""Regras puras do "salário do seu dinheiro": quanto o dinheiro rendeu, sem contar o que foi
aportado. Sem banco, sem I/O.

A medida é o ganho de cada ativo (saldo atual menos investido) ao longo do tempo. Aporte soma o
mesmo valor ao investido e ao saldo, e transferência leva o custo junto, então nenhum dos dois
muda o ganho: só o que o dinheiro rendeu aparece. Proventos já creditados em algum ativo estão no
saldo dele (portanto no ganho); os não creditados não estão em saldo nenhum e entram à parte.

Resgate tira valor e custo do ativo, e a diferença (o ganho que saiu junto) derrubaria o ganho do
ativo como se fosse prejuízo. Por isso esse ganho realizado é somado de volta, a partir da data em
que as linhas de valor do ativo passam a refletir o resgate.
"""

import calendar
import datetime as dt
from bisect import bisect_right
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from app.core.money import BPS

WORK_HOURS_PER_MONTH = 220  # jornada mensal usada para traduzir o rendimento em tempo de trabalho
PACE_MONTHS = 3  # meses completos que formam o ritmo por dia

SHARE_THRESHOLDS_BPS = (100, 500, 1_000, 2_500, 5_000, 10_000)  # 1%, 5%, 10%, 25%, 50%, 100%
TOTAL_THRESHOLDS_CENTS = (10_000, 100_000, 1_000_000, 10_000_000)  # R$ 100 a R$ 100.000

MilestoneKind = Literal["first", "monthly_share", "total_amount"]


def _round(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def month_of(day: dt.date) -> str:
    return day.strftime("%Y-%m")


def _month_add(month: str, delta: int) -> str:
    index = int(month[:4]) * 12 + (int(month[5:7]) - 1) + delta
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def _months_range(first: str, last: str) -> list[str]:
    months, current = [], first
    while current <= last:
        months.append(current)
        current = _month_add(current, 1)
    return months


def _month_end(month: str) -> dt.date:
    year, number = int(month[:4]), int(month[5:7])
    return dt.date(year, number, calendar.monthrange(year, number)[1])


def _days_in(month: str) -> int:
    return calendar.monthrange(int(month[:4]), int(month[5:7]))[1]


# ---- entradas e saídas -------------------------------------------------------------------


@dataclass(frozen=True)
class ValuationPoint:
    asset_id: int
    date: dt.date
    invested_cents: int
    current_cents: int
    observed: bool  # saldo digitado do extrato (as demais linhas nascem de transferência/provento)


@dataclass(frozen=True)
class ProventoPoint:
    date: dt.date
    amount_cents: int
    credited: bool  # já somado ao saldo de algum ativo


@dataclass(frozen=True)
class RedemptionPoint:
    asset_id: int
    date: dt.date  # a partir dela as linhas de valor do ativo já refletem o resgate
    amount_cents: int
    cost_cents: int

    @property
    def realized_cents(self) -> int:
        """Ganho que saiu junto com o dinheiro (negativo se o ativo estava no prejuízo)."""
        return self.amount_cents - self.cost_cents


@dataclass(frozen=True)
class MonthEarnings:
    month: str
    appreciation_cents: int  # variação do ganho dos ativos no mês (aporte não entra)
    proventos_cents: int  # só os proventos não creditados
    partial: bool  # mês corrente, ainda em andamento
    through: dt.date  # até que dia o mês foi medido
    has_update: bool  # houve saldo digitado ou provento no mês
    salary_cents: int | None  # salário vigente no mês
    # Data do último saldo digitado ou provento do mês. `through` é até onde o mês foi olhado (hoje,
    # no corrente); o rendimento, porém, só vale até a última atualização.
    measured_through: dt.date | None

    @property
    def earned_cents(self) -> int:
        return self.appreciation_cents + self.proventos_cents

    @property
    def salary_share_bps(self) -> int | None:
        return share_of_salary_bps(self.earned_cents, self.salary_cents)

    @property
    def work_minutes(self) -> int | None:
        if not self.has_update or self.salary_cents is None:
            return None
        return work_minutes(self.earned_cents, self.salary_cents)

    @property
    def per_day_cents(self) -> int | None:
        """Rendimento por dia: no mês corrente, até a última atualização; nos outros, o mês todo."""
        if not self.has_update or self.measured_through is None:
            return None
        days = self.measured_through.day if self.partial else _days_in(self.month)
        return _round(Decimal(self.earned_cents) / days)


@dataclass(frozen=True)
class Total:
    earned_cents: int
    before_tracking_cents: int  # ganho que os ativos já tinham ao serem cadastrados
    since_tracking_cents: int
    uncredited_proventos_cents: int


@dataclass(frozen=True)
class Pace:
    per_day_cents: int
    basis_months: int
    from_month: str
    to_month: str


@dataclass(frozen=True)
class VsSalary:
    month: str
    earned_cents: int
    share_bps: int
    work_minutes: int | None  # só quando o mês rendeu


@dataclass(frozen=True)
class Milestone:
    key: str
    kind: MilestoneKind
    threshold: int | None  # bps (monthly_share), centavos (total_amount) ou None (first)
    achieved_month: str | None


@dataclass(frozen=True)
class NextMilestone:
    key: str
    progress_bps: int  # 0 a 9.999: ao chegar a 100% o marco deixa de ser o próximo


@dataclass(frozen=True)
class Earnings:
    as_of: dt.date
    tracking_since: dt.date | None
    total: Total
    months: list[MonthEarnings]  # do primeiro mês com dados ao corrente (o último, parcial)
    pace: Pace | None
    vs_salary: VsSalary | None
    milestones: list[Milestone]
    next_milestone: NextMilestone | None


# ---- cálculos ----------------------------------------------------------------------------


def share_of_salary_bps(earned_cents: int, salary_cents: int | None) -> int | None:
    if salary_cents is None or salary_cents <= 0:
        return None
    return _round(Decimal(earned_cents) * BPS / salary_cents)


def work_minutes(earned_cents: int, salary_cents: int) -> int | None:
    """Minutos de trabalho que o rendimento equivale, pela jornada de 220 h por mês."""
    if earned_cents <= 0 or salary_cents <= 0:
        return None
    return _round(Decimal(earned_cents) * WORK_HOURS_PER_MONTH * 60 / salary_cents)


class _GainCurves:
    """Ganho (saldo menos investido) de cada ativo ao longo do tempo, com os resgates devolvidos."""

    def __init__(
        self, valuations: list[ValuationPoint], redemptions: Sequence[RedemptionPoint] = ()
    ):
        self._dates: dict[int, list[dt.date]] = {}
        self._gains: dict[int, list[int]] = {}
        for point in sorted(valuations, key=lambda v: (v.asset_id, v.date)):
            self._dates.setdefault(point.asset_id, []).append(point.date)
            self._gains.setdefault(point.asset_id, []).append(
                point.current_cents - point.invested_cents
            )
        # Ganho realizado acumulado por ativo: (datas dos resgates, soma até cada uma).
        self._realized: dict[int, tuple[list[dt.date], list[int]]] = {}
        for redemption in sorted(redemptions, key=lambda r: (r.asset_id, r.date)):
            if redemption.asset_id not in self._dates:
                continue  # sem linhas de valor não há ganho do que descontar
            days, sums = self._realized.setdefault(redemption.asset_id, ([], []))
            days.append(redemption.date)
            sums.append((sums[-1] if sums else 0) + redemption.realized_cents)

    def _realized_until(self, asset_id: int, day: dt.date) -> int:
        days, sums = self._realized.get(asset_id, ([], []))
        index = bisect_right(days, day) - 1
        return sums[index] if index >= 0 else 0

    def first_gain_total(self) -> int:
        """Ganho que os ativos já tinham no primeiro registro: não pertence a nenhum mês."""
        return sum(
            gains[0] + self._realized_until(asset_id, self._dates[asset_id][0])
            for asset_id, gains in self._gains.items()
        )

    def total_at(self, day: dt.date) -> int:
        """Ganho total até `day`. Antes do primeiro registro de um ativo vale o do primeiro."""
        total = 0
        for asset_id, dates in self._dates.items():
            index = max(bisect_right(dates, day) - 1, 0)
            total += self._gains[asset_id][index] + self._realized_until(
                asset_id, max(day, dates[0])
            )
        return total


def _last_update_by_month(
    valuations: list[ValuationPoint], proventos: list[ProventoPoint]
) -> dict[str, dt.date]:
    """Meses com atualização (saldo digitado ou provento) e a data da última de cada um.

    O primeiro registro de cada ativo é só o ponto de partida (o cadastro), não uma atualização:
    contá-lo faria o mês do cadastro parecer um mês que rendeu zero.
    """
    first_dates: dict[int, dt.date] = {}
    for point in valuations:
        if point.asset_id not in first_dates or point.date < first_dates[point.asset_id]:
            first_dates[point.asset_id] = point.date
    last: dict[str, dt.date] = {}
    dates = [p.date for p in valuations if p.observed and p.date != first_dates[p.asset_id]]
    for day in dates + [p.date for p in proventos]:
        month = month_of(day)
        last[month] = max(day, last.get(month, day))
    return last


def compute_earnings(
    valuations: list[ValuationPoint],
    proventos: list[ProventoPoint],
    salary_of: Callable[[str], int | None],
    today: dt.date,
    redemptions: Sequence[RedemptionPoint] = (),
) -> Earnings:
    """Calcula meses, total, ritmo, comparação com o salário e marcos a partir do histórico."""
    current_month = month_of(today)
    # Valor, provento ou resgate com data futura ainda não aconteceu: não entra em nenhuma conta.
    valuations = [v for v in valuations if v.date <= today]
    proventos = [p for p in proventos if p.date <= today]
    redemptions = [r for r in redemptions if r.date <= today]
    uncredited = [p for p in proventos if not p.credited]
    curves = _GainCurves(valuations, redemptions)
    tracking_since = min((v.date for v in valuations), default=None)

    first_month = min(
        [current_month]
        + ([month_of(tracking_since)] if tracking_since else [])
        + [month_of(p.date) for p in uncredited]
    )
    last_update = _last_update_by_month(valuations, proventos)
    uncredited_by_month: dict[str, int] = {}
    for provento in uncredited:
        month = month_of(provento.date)
        uncredited_by_month[month] = uncredited_by_month.get(month, 0) + provento.amount_cents

    months: list[MonthEarnings] = []
    previous_gain = curves.first_gain_total()
    for month in _months_range(first_month, current_month):
        partial = month == current_month
        through = today if partial else _month_end(month)
        gain = curves.total_at(through)
        months.append(
            MonthEarnings(
                month=month,
                appreciation_cents=gain - previous_gain,
                proventos_cents=uncredited_by_month.get(month, 0),
                partial=partial,
                through=through,
                has_update=month in last_update,
                salary_cents=salary_of(month),
                measured_through=last_update.get(month),
            )
        )
        previous_gain = gain

    uncredited_total = sum(p.amount_cents for p in uncredited)
    before = curves.first_gain_total()
    earned = curves.total_at(today) + uncredited_total
    total = Total(
        earned_cents=earned,
        before_tracking_cents=before,
        since_tracking_cents=earned - before,
        uncredited_proventos_cents=uncredited_total,
    )

    milestones = _milestones(months)
    return Earnings(
        as_of=today,
        tracking_since=tracking_since,
        total=total,
        months=months,
        pace=_pace(months),
        vs_salary=_vs_salary(months) if tracking_since else None,
        milestones=milestones,
        next_milestone=_next_milestone(milestones, months),
    )


def _pace(months: list[MonthEarnings]) -> Pace | None:
    """Rendimento por dia dos últimos meses completos que tiveram atualização."""
    basis = [m for m in months if not m.partial and m.has_update][-PACE_MONTHS:]
    if not basis:
        return None
    days = sum(_days_in(m.month) for m in basis)
    return Pace(
        per_day_cents=_round(Decimal(sum(m.earned_cents for m in basis)) / days),
        basis_months=len(basis),
        from_month=basis[0].month,
        to_month=basis[-1].month,
    )


def _vs_salary(months: list[MonthEarnings]) -> VsSalary | None:
    """Rendimento do último mês completo com atualização contra o salário.

    Sem mês completo atualizado, usa o corrente (parcial) se ele tiver atualização. Mês sem
    atualização não é "rendeu zero": não serve de base.
    """
    complete = [m for m in months if not m.partial and m.has_update]
    candidates = complete or [m for m in months if m.partial and m.has_update]
    if not candidates:
        return None
    base = candidates[-1]
    share = base.salary_share_bps
    if share is None or base.salary_cents is None:
        return None
    return VsSalary(
        month=base.month,
        earned_cents=base.earned_cents,
        share_bps=share,
        work_minutes=work_minutes(base.earned_cents, base.salary_cents),
    )


# ---- marcos ------------------------------------------------------------------------------


def _milestones(months: list[MonthEarnings]) -> list[Milestone]:
    """Todos os marcos, com o mês em que foram atingidos (ou None).

    `first_salary` e `share_*` esperam o mês fechar: só olham meses completos, porque um mês em
    andamento ainda pode perder o que ganhou.

    `total_*` é diferente, por decisão: usa o rendimento acumulado desde o cadastro
    (`since_tracking`, a soma dos meses, mês corrente parcial incluído), sem o ganho que os
    ativos já tinham ao entrar. A recompensa vem na hora, mas o marco pode voltar a "não
    conquistado" se o saldo recuar depois; o front lembra o que já foi visto para não repetir
    a comemoração.
    """
    complete = [m for m in months if not m.partial]
    first_salary = next((m.month for m in complete if m.earned_cents > 0), None)
    result = [Milestone("first_salary", "first", None, first_salary)]

    for threshold in SHARE_THRESHOLDS_BPS:
        reached = next(
            (m.month for m in complete if (m.salary_share_bps or 0) >= threshold),
            None,
        )
        result.append(Milestone(f"share_{threshold // 100}", "monthly_share", threshold, reached))

    cumulative, running = {}, 0
    for m in months:
        running += m.earned_cents
        cumulative[m.month] = running
    for threshold in TOTAL_THRESHOLDS_CENTS:
        reached = next((month for month, value in cumulative.items() if value >= threshold), None)
        result.append(Milestone(f"total_{threshold // 100}", "total_amount", threshold, reached))
    return result


def _next_milestone(
    milestones: list[Milestone], months: list[MonthEarnings]
) -> NextMilestone | None:
    """Primeiro marco ainda não atingido e o quanto falta: o melhor mês, ou o total acumulado."""
    pending = next((m for m in milestones if m.achieved_month is None), None)
    if pending is None:
        return None
    if pending.threshold is None:  # primeiro salário: ou rendeu num mês completo, ou não
        return NextMilestone(pending.key, 0)
    if pending.kind == "monthly_share":
        value = max((m.salary_share_bps or 0 for m in months if not m.partial), default=0)
    else:
        value = sum(m.earned_cents for m in months)
    progress = _round(Decimal(max(value, 0)) * BPS / pending.threshold)
    return NextMilestone(pending.key, min(progress, BPS - 1))
