"""Salário do seu dinheiro: quanto o dinheiro rendeu, sem contar o que a pessoa aportou.

Só leitura. Tudo sai do histórico de valores dos ativos e dos proventos; não depende de
fechamentos. As regras estão em `domain`.
"""

import datetime as dt
from functools import cache

from sqlalchemy.orm import Session

from app.features.contributions.service import salary_for_month
from app.features.earnings import domain
from app.features.earnings.schemas import (
    EarningsOut,
    EarningsTotal,
    MilestoneOut,
    MonthEarningsOut,
    NextMilestoneOut,
    PaceOut,
    SalaryOut,
    VsSalaryOut,
)
from app.features.portfolio.service import get_value_history

MONTHS_SHOWN = 12


def _today() -> dt.date:
    return dt.date.today()


def _month_out(month: domain.MonthEarnings) -> MonthEarningsOut:
    return MonthEarningsOut(
        month=month.month,
        earned_cents=month.earned_cents,
        appreciation_cents=month.appreciation_cents,
        proventos_cents=month.proventos_cents,
        partial=month.partial,
        through=month.through,
        has_update=month.has_update,
        salary_share_bps=month.salary_share_bps,
        measured_through=month.measured_through,
        per_day_cents=month.per_day_cents,
        work_minutes=month.work_minutes,
    )


def get_earnings(session: Session) -> EarningsOut:
    today = _today()
    history = get_value_history(session)

    @cache
    def salary_of(month: str) -> int | None:
        return salary_for_month(session, month)

    result = domain.compute_earnings(
        [domain.ValuationPoint(**v.model_dump()) for v in history.valuations],
        [domain.ProventoPoint(**p.model_dump()) for p in history.proventos],
        salary_of,
        today,
        [domain.RedemptionPoint(**r.model_dump()) for r in history.redemptions],
    )

    shown = [_month_out(m) for m in result.months[-MONTHS_SHOWN:]]
    current_month = domain.month_of(today)
    current_salary = salary_of(current_month)
    return EarningsOut(
        as_of=result.as_of,
        tracking_since=result.tracking_since,
        total=EarningsTotal(**vars(result.total)),
        current_month=shown[-1],
        last_complete_month=shown[-2] if len(shown) > 1 else None,
        pace=PaceOut(**vars(result.pace)) if result.pace else None,
        salary=(
            SalaryOut(salary_cents=current_salary, month=current_month)
            if current_salary is not None
            else None
        ),
        vs_salary=VsSalaryOut(**vars(result.vs_salary)) if result.vs_salary else None,
        # Sem ativos não há histórico a mostrar; o mês corrente segue zerado em `current_month`.
        months=shown if result.tracking_since else [],
        milestones=[MilestoneOut(**vars(m)) for m in result.milestones],
        next_milestone=(
            NextMilestoneOut(**vars(result.next_milestone)) if result.next_milestone else None
        ),
    )
