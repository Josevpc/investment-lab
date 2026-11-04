from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.features.history.models import Snapshot


def list_snapshots(
    session: Session, *, start: date | None = None, end: date | None = None, newest_first: bool
) -> list[Snapshot]:
    stmt = select(Snapshot)
    if start is not None:
        stmt = stmt.where(Snapshot.date >= start)
    if end is not None:
        stmt = stmt.where(Snapshot.date <= end)
    stmt = stmt.order_by(Snapshot.date.desc() if newest_first else Snapshot.date.asc())
    return list(session.scalars(stmt))


def get_snapshot(session: Session, snapshot_id: int) -> Snapshot | None:
    return session.get(Snapshot, snapshot_id)


def get_snapshot_by_date(session: Session, on_date: date) -> Snapshot | None:
    return session.scalar(select(Snapshot).where(Snapshot.date == on_date))
