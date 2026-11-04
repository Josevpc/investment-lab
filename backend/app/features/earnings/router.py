from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.features.earnings import service
from app.features.earnings.schemas import EarningsOut

router = APIRouter(prefix="/earnings", tags=["earnings"])


@router.get("", response_model=EarningsOut)
def get_earnings(session: Session = Depends(get_session)):
    return service.get_earnings(session)
