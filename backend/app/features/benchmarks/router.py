from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.features.benchmarks import service
from app.features.benchmarks.schemas import BenchmarkStatus, RefreshResult

router = APIRouter(prefix="/benchmarks", tags=["benchmarks"])


@router.get("/status", response_model=BenchmarkStatus)
def status(session: Session = Depends(get_session)):
    return service.get_status(session)


@router.post("/refresh", response_model=RefreshResult)
def refresh(session: Session = Depends(get_session)):
    result = service.refresh(session)
    if not result.ok:
        raise HTTPException(
            status_code=502,
            detail="Não foi possível buscar as taxas no Banco Central e o Ibovespa na B3: "
            + "; ".join(result.errors),
        )
    return result
