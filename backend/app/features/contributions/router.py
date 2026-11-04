from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.features.contributions import service
from app.features.contributions.domain import calculate_contribution
from app.features.contributions.schemas import (
    MONTH_PATTERN,
    CalculateIn,
    CalculateOut,
    ContributionIn,
    ContributionOut,
    ContributionUpsert,
)

router = APIRouter(prefix="/contributions", tags=["contributions"])


@router.get("", response_model=list[ContributionOut])
def list_contributions(session: Session = Depends(get_session)):
    return service.list_contributions(session)


@router.post("", response_model=ContributionOut, status_code=status.HTTP_201_CREATED)
def create_contribution(data: ContributionIn, session: Session = Depends(get_session)):
    return service.create_contribution(session, data)


@router.post("/calculate", response_model=CalculateOut)
def calculate(data: CalculateIn):
    return CalculateOut(
        calculated_cents=calculate_contribution(data.salary_cents, data.percent_bps)
    )


@router.put("/{month}", response_model=ContributionOut)
def upsert_contribution(
    month: str,
    data: ContributionUpsert,
    response: Response,
    session: Session = Depends(get_session),
):
    if not MONTH_PATTERN.match(month):
        raise HTTPException(status_code=422, detail="O mês deve estar no formato AAAA-MM.")
    contribution, created = service.upsert_contribution(session, month, data)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return contribution
