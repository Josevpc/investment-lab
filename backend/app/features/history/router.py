from datetime import date

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.features.history import service
from app.features.history.schemas import (
    ContributionsByMonthOut,
    EvolutionOut,
    SnapshotCreate,
    SnapshotOut,
    SnapshotUpdate,
)

router = APIRouter(tags=["history"])


@router.get("/snapshots", response_model=list[SnapshotOut])
def list_snapshots(session: Session = Depends(get_session)):
    return service.list_snapshots(session)


@router.post("/snapshots", response_model=SnapshotOut, status_code=status.HTTP_201_CREATED)
def create_snapshot(data: SnapshotCreate | None = None, session: Session = Depends(get_session)):
    return service.create_snapshot(session, data or SnapshotCreate())


@router.put("/snapshots/{snapshot_id}", response_model=SnapshotOut)
def update_snapshot(
    snapshot_id: int, data: SnapshotUpdate, session: Session = Depends(get_session)
):
    return service.update_snapshot(session, snapshot_id, data)


@router.delete("/snapshots/{snapshot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_snapshot(snapshot_id: int, session: Session = Depends(get_session)):
    service.delete_snapshot(session, snapshot_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _today() -> date:
    return date.today()


@router.get("/history/contributions-by-month", response_model=ContributionsByMonthOut)
def contributions_by_month(
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    session: Session = Depends(get_session),
):
    # O formato (AAAA-MM) é conferido no serviço, para a mensagem de erro sair em português.
    return service.contributions_by_month(session, from_, to, _today())


@router.get("/history/evolution", response_model=EvolutionOut)
def evolution(
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = None,
    session: Session = Depends(get_session),
):
    return service.get_evolution(session, from_, to)
