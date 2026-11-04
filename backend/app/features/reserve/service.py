from sqlalchemy.orm import Session

from app.core.money import BPS
from app.features.contributions.service import average_salary
from app.features.portfolio.service import list_assets
from app.features.reserve.models import ReserveSetting
from app.features.reserve.schemas import ReserveAsset, ReserveIn, ReserveOut

DEFAULT_MONTHS = 6


def _setting(session: Session) -> ReserveSetting:
    setting = session.get(ReserveSetting, 1)
    if setting is None:
        setting = ReserveSetting(id=1, goal_cents=0, months=DEFAULT_MONTHS, monthly_cents=0)
        session.add(setting)
        session.commit()
    return setting


def goal_cents(session: Session) -> int:
    """Meta da reserva; 0 se ainda não foi definida. Só lê: `_setting` cria a linha padrão."""
    setting = session.get(ReserveSetting, 1)
    return setting.goal_cents if setting is not None else 0


def get_reserve(session: Session) -> ReserveOut:
    setting = _setting(session)
    assets = [a for a in list_assets(session) if a.purpose == "reserva"]
    balance = sum(a.current_cents for a in assets)
    average, considered = average_salary(session)

    goal = setting.goal_cents
    progress = min(BPS, (2 * balance * BPS + goal) // (2 * goal)) if goal > 0 else 0
    return ReserveOut(
        goal_cents=goal,
        months=setting.months,
        monthly_cents=setting.monthly_cents,
        monthly_mode=setting.monthly_mode,
        percent_bps=setting.percent_bps,
        balance_cents=balance,
        remaining_cents=max(0, goal - balance),
        progress_bps=progress,
        reached=goal > 0 and balance >= goal,
        average_salary_cents=average,
        salaries_considered=considered,
        suggested_goal_cents=setting.months * average if average is not None else None,
        coverage_months=round(balance / average, 1) if average else None,
        assets=[
            ReserveAsset(
                id=a.id,
                name=a.name,
                institution_name=a.institution_name,
                current_cents=a.current_cents,
            )
            for a in assets
        ],
    )


def save_reserve(session: Session, data: ReserveIn) -> ReserveOut:
    setting = _setting(session)
    setting.goal_cents = data.goal_cents
    setting.months = data.months
    setting.monthly_cents = data.monthly_cents
    setting.monthly_mode = data.monthly_mode
    setting.percent_bps = data.percent_bps
    session.commit()
    return get_reserve(session)
