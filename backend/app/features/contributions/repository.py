from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.features.contributions.models import Contribution


def list_all(session: Session) -> list[Contribution]:
    return list(session.scalars(select(Contribution).order_by(Contribution.month.desc())))


def get_by_month(session: Session, month: str) -> Contribution | None:
    return session.scalar(select(Contribution).where(Contribution.month == month))


def salary_on_or_before(session: Session, month: str) -> int | None:
    """Salário do aporte do mês ou, não havendo, o do mais recente antes dele.

    Para um mês anterior ao primeiro aporte registrado, o salário mais antigo registrado é a
    melhor aproximação disponível (aproximação documentada: vale para meses anteriores ao
    primeiro registro).
    """
    salary = session.scalar(
        select(Contribution.salary_cents)
        .where(Contribution.month <= month)
        .order_by(Contribution.month.desc())
        .limit(1)
    )
    if salary is not None:
        return salary
    return session.scalar(
        select(Contribution.salary_cents).order_by(Contribution.month.asc()).limit(1)
    )


def final_by_month(session: Session, after_month: str, up_to_month: str) -> dict[str, int]:
    """Aporte planejado de cada mês no intervalo (after_month, up_to_month]."""
    rows = session.execute(
        select(Contribution.month, Contribution.final_cents).where(
            Contribution.month > after_month, Contribution.month <= up_to_month
        )
    )
    return {month: int(cents) for month, cents in rows}


def sum_final_between(session: Session, after_month: str, up_to_month: str) -> int:
    """Soma dos aportes dos meses no intervalo (after_month, up_to_month]."""
    total = session.scalar(
        select(func.coalesce(func.sum(Contribution.final_cents), 0)).where(
            Contribution.month > after_month, Contribution.month <= up_to_month
        )
    )
    return int(total or 0)
