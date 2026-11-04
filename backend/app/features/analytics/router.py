from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.features.analytics import service
from app.features.analytics.schemas import (
    AssetPerformanceOut,
    PerformanceOut,
    TrajectoryIn,
    TrajectoryOut,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.post("/trajectory", response_model=TrajectoryOut)
def trajectory(data: TrajectoryIn | None = None, session: Session = Depends(get_session)):
    return service.get_trajectory(session, data or TrajectoryIn())


@router.get("/performance", response_model=PerformanceOut)
def performance(
    scope: str = "total",
    include_reserve: bool = False,
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = None,
    session: Session = Depends(get_session),
):
    return service.get_performance(session, scope, include_reserve, from_, to)


@router.get("/assets/{asset_id}/vs-cdi", response_model=AssetPerformanceOut)
def asset_vs_cdi(
    asset_id: int,
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = None,
    session: Session = Depends(get_session),
):
    return service.get_asset_performance(session, asset_id, from_, to)


@router.get("/assets-vs-cdi", response_model=list[AssetPerformanceOut])
def assets_vs_cdi(
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = None,
    session: Session = Depends(get_session),
):
    return service.list_assets_vs_cdi(session, from_, to)
