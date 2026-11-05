"""Metas: sequência mensal, progresso do patrimônio e projeção de longo prazo.

Quase tudo é calculado do histórico que já existe (aportes, plano do mês, saldos digitados); só as
metas e as premissas da projeção ficam guardadas.
"""

from datetime import date

from sqlalchemy.orm import Session

from app.core.money import BPS
from app.features.contributions.service import list_contributions
from app.features.goals import domain
from app.features.goals.models import GoalSetting
from app.features.goals.schemas import (
    ContributionPace,
    GoalSettingsIn,
    GoalSettingsOut,
    GoalsProgress,
    NetWorthProgress,
    PaceSuggestion,
    PaceWindow,
    ProjectionOut,
    ProjectionPoint,
    ProjectionScenario,
    StreakMonth,
    StreakOut,
    YearProgress,
)
from app.features.history.service import get_evolution, list_snapshot_rows
from app.features.portfolio.movements import aportes_by_month
from app.features.portfolio.service import get_summary, get_timeline

STREAK_WINDOW = 12  # meses mostrados na faixa da sequência
AVERAGE_WINDOW = 6  # aportes recentes que formam o aporte mensal automático

_FIELDS = tuple(GoalSettingsIn.model_fields)


def _today() -> date:
    return date.today()


def _setting(session: Session) -> GoalSetting:
    setting = session.get(GoalSetting, 1)
    if setting is None:
        setting = GoalSetting(id=1)
        session.add(setting)
        session.commit()
    return setting


def get_settings(session: Session) -> GoalSettingsOut:
    setting = _setting(session)
    return GoalSettingsOut(**{field: getattr(setting, field) for field in _FIELDS})


def save_settings(session: Session, data: GoalSettingsIn) -> GoalSettingsOut:
    setting = _setting(session)
    for field in _FIELDS:
        setattr(setting, field, getattr(data, field))
    session.commit()
    return get_settings(session)


def _progress_bps(value: int, goal: int) -> int:
    if goal <= 0:
        return 0
    return min(BPS, (2 * max(value, 0) * BPS + goal) // (2 * goal))


# ---- progresso ---------------------------------------------------------------------------


def _month_facts(session: Session, current_month: str) -> dict[str, domain.MonthFacts]:
    contributions = {c.month: c for c in list_contributions(session)}
    if not contributions:
        return {}
    first = min(contributions)
    # Aporte "fora da meta" não cumpre o plano do mês: a sequência só conta o que entrou na meta.
    executed = aportes_by_month(
        session, domain.month_add(first, -1), current_month, include_off_goal=False
    )
    closed = {row.date.strftime("%Y-%m") for row in list_snapshot_rows(session)}
    return {
        month: domain.MonthFacts(
            month=month,
            planned_cents=contributions[month].final_cents if month in contributions else 0,
            has_plan=month in contributions and contributions[month].mode is not None,
            executed_cents=executed.get(month, 0),
            closed=month in closed,
        )
        for month in domain.months_range(first, current_month)
    }


def _streak(session: Session, current_month: str) -> StreakOut:
    streak = domain.compute_streak(_month_facts(session, current_month), current_month)
    recent = domain.months_range(domain.month_add(current_month, 1 - STREAK_WINDOW), current_month)
    return StreakOut(
        current=streak.current,
        best=streak.best,
        current_month_met=streak.current_month_met,
        months=[
            StreakMonth(month=month, state=streak.states.get(month, "missed"))
            for month in recent
            if month in streak.states
        ],
    )


def _year_progress(session: Session, year: int, goal: int) -> YearProgress:
    """Quanto o patrimônio cresceu no ano, entre a última data com saldo digitado do ano anterior
    e a mais recente.

    Sem saldo digitado no ano anterior, parte da primeira data do próprio ano.
    """
    timeline = get_timeline(session)
    dates = timeline.dates
    previous = [d for d in dates if d.year < year]
    this_year = [d for d in dates if d.year == year]
    baseline = previous[-1] if previous else (this_year[0] if this_year else None)
    summary = None
    if baseline is not None and this_year and this_year[-1] > baseline:
        summary = get_evolution(session, baseline, this_year[-1], timeline).summary

    accumulated = summary.change_cents if summary else 0
    contributions = summary.contributions_cents if summary else 0
    withdrawals = summary.withdrawals_cents if summary else 0
    archived_out = summary.archived_out_cents if summary else 0
    return YearProgress(
        year=year,
        goal_cents=goal,
        status="ok" if summary else "sem_base",
        baseline_date=baseline.isoformat() if summary and baseline else None,
        last_date=this_year[-1].isoformat() if summary else None,
        accumulated_cents=accumulated,
        contributions_cents=contributions,
        contributions_source=summary.contributions_source if summary else "diario",
        estimated_months=list(summary.estimated_months) if summary else [],
        withdrawals_cents=withdrawals,
        archived_out_cents=archived_out,
        new_assets_cents=summary.new_assets_cents if summary else 0,
        appreciation_cents=accumulated - contributions + withdrawals + archived_out,
        remaining_cents=max(0, goal - accumulated) if goal > 0 else 0,
        progress_bps=_progress_bps(accumulated, goal),
        reached=goal > 0 and accumulated >= goal,
    )


def _contribution_pace(session: Session, current_month: str, goal: int) -> ContributionPace:
    """Média de aporte dos últimos meses completos (inclui o aporte inicial dos ativos novos).

    Os aportes fora da meta ficam de fora: um aporte avulso não é o ritmo mensal do usuário.
    """
    reference = domain.month_add(current_month, -1)
    longest = max(domain.PACE_WINDOWS)
    by_month = aportes_by_month(
        session, domain.month_add(reference, -longest), reference, include_off_goal=False
    )
    windows = domain.pace_windows(by_month, reference)
    suggestion = domain.suggested_goal(windows, goal)
    return ContributionPace(
        reference_month=reference,
        windows=[
            PaceWindow(
                months=w.months, average_cents=w.average_cents, months_with_data=w.months_with_data
            )
            for w in windows
        ],
        goal_cents=goal,
        suggestion=PaceSuggestion(
            window_months=suggestion.months,
            average_cents=suggestion.average_cents,
            suggested_cents=suggestion.average_cents,
        )
        if suggestion and suggestion.average_cents is not None
        else None,
    )


def get_progress(session: Session) -> GoalsProgress:
    setting = _setting(session)
    today = _today()
    current_month = today.strftime("%Y-%m")
    current = get_summary(session).total_current_cents
    goal = setting.net_worth_goal_cents
    return GoalsProgress(
        month=current_month,
        streak=_streak(session, current_month),
        net_worth=NetWorthProgress(
            current_cents=current,
            goal_cents=goal,
            remaining_cents=max(0, goal - current) if goal > 0 else 0,
            progress_bps=_progress_bps(current, goal),
            reached=goal > 0 and current >= goal,
        ),
        year=_year_progress(session, today.year, setting.year_goal_cents),
        contribution_pace=_contribution_pace(session, current_month, setting.monthly_cents),
    )


# ---- projeção ----------------------------------------------------------------------------


def _monthly_contribution(session: Session, setting: GoalSetting) -> tuple[int, str, int]:
    """Aporte mensal da projeção, de onde veio e quantos aportes formaram a média."""
    if setting.monthly_cents > 0:
        return setting.monthly_cents, "manual", 0
    recent = sorted(list_contributions(session), key=lambda c: c.month, reverse=True)[
        :AVERAGE_WINDOW
    ]
    if not recent:
        return 0, "nenhum", 0
    total = sum(c.final_cents for c in recent)
    return (2 * total + len(recent)) // (2 * len(recent)), "media", len(recent)


SCENARIOS = (
    ("conservador", "Conservador", "conservative_bps"),
    ("base", "Base", "base_bps"),
    ("otimista", "Otimista", "optimistic_bps"),
)


def get_projection(session: Session) -> ProjectionOut:
    setting = _setting(session)
    start_month = _today().strftime("%Y-%m")
    start = get_summary(session).total_current_cents
    monthly, source, considered = _monthly_contribution(session, setting)
    months = setting.horizon_years * 12

    scenarios = []
    for key, name, attribute in SCENARIOS:
        annual_bps = getattr(setting, attribute)
        balances = domain.project(start, monthly, annual_bps, months)
        # A meta é em reais de hoje: compara o saldo já deflacionado, não o nominal.
        reached = domain.first_month_reaching(
            domain.to_today_series(balances, setting.inflation_bps), setting.net_worth_goal_cents
        )
        scenarios.append(
            ProjectionScenario(
                key=key,
                name=name,
                annual_bps=annual_bps,
                final_nominal_cents=balances[-1],
                final_today_cents=domain.to_today_value(
                    balances[-1], setting.inflation_bps, months
                ),
                goal_month=domain.month_add(start_month, reached) if reached is not None else None,
                points=[
                    ProjectionPoint(
                        month=domain.month_add(start_month, offset),
                        nominal_cents=balances[offset],
                        today_cents=domain.to_today_value(
                            balances[offset], setting.inflation_bps, offset
                        ),
                    )
                    for offset in range(0, months + 1, 12)
                ],
            )
        )
    return ProjectionOut(
        start_month=start_month,
        start_cents=start,
        monthly_cents=monthly,
        monthly_source=source,
        monthly_considered=considered,
        horizon_years=setting.horizon_years,
        inflation_bps=setting.inflation_bps,
        net_worth_goal_cents=setting.net_worth_goal_cents,
        goal_basis="today",
        contributed_cents=monthly * months,
        scenarios=scenarios,
    )
