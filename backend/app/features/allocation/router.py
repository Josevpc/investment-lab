from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.features.allocation import service
from app.features.allocation.schemas import ComparisonOut, PlanIn, PlanOut, SplitIn, SplitOut

router = APIRouter(prefix="/allocation", tags=["allocation"])


@router.get("/plans", response_model=list[PlanOut])
def list_plans(session: Session = Depends(get_session)):
    return service.list_plans(session)


@router.post("/plans", response_model=PlanOut, status_code=status.HTTP_201_CREATED)
def create_plan(data: PlanIn, session: Session = Depends(get_session)):
    return service.create_plan(session, data)


@router.get("/plans/{plan_id}", response_model=PlanOut)
def get_plan(plan_id: int, session: Session = Depends(get_session)):
    return service.get_plan(session, plan_id)


@router.put("/plans/{plan_id}", response_model=PlanOut)
def update_plan(plan_id: int, data: PlanIn, session: Session = Depends(get_session)):
    return service.update_plan(session, plan_id, data)


@router.post("/plans/{plan_id}/activate", response_model=PlanOut)
def activate_plan(plan_id: int, session: Session = Depends(get_session)):
    return service.activate_plan(session, plan_id)


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(plan_id: int, session: Session = Depends(get_session)):
    service.delete_plan(session, plan_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/split", response_model=SplitOut)
def split(data: SplitIn, session: Session = Depends(get_session)):
    return service.split_contribution(session, data)


@router.get("/comparison", response_model=ComparisonOut)
def comparison(plan_id: int | None = None, session: Session = Depends(get_session)):
    return service.compare_portfolio(session, plan_id)
