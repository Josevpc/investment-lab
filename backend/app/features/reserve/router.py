from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.features.reserve import service
from app.features.reserve.schemas import ReserveIn, ReserveOut

router = APIRouter(prefix="/reserve", tags=["reserve"])


@router.get("", response_model=ReserveOut)
def get_reserve(session: Session = Depends(get_session)):
    return service.get_reserve(session)


@router.put("", response_model=ReserveOut)
def save_reserve(data: ReserveIn, session: Session = Depends(get_session)):
    return service.save_reserve(session, data)
