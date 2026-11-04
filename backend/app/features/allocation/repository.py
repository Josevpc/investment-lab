from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.features.allocation.models import AllocationPlan


def list_plans(session: Session) -> list[AllocationPlan]:
    return list(session.scalars(select(AllocationPlan).order_by(AllocationPlan.id)))


def get_plan(session: Session, plan_id: int) -> AllocationPlan | None:
    return session.get(AllocationPlan, plan_id)


def get_active_plan(session: Session) -> AllocationPlan | None:
    return session.scalar(select(AllocationPlan).where(AllocationPlan.is_active.is_(True)))


def get_plan_by_name(session: Session, name: str) -> AllocationPlan | None:
    return session.scalar(select(AllocationPlan).where(AllocationPlan.name == name))


def deactivate_all(session: Session) -> None:
    session.execute(update(AllocationPlan).values(is_active=False))
    session.flush()
