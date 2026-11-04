from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.features.goals import service
from app.features.goals.schemas import (
    GoalSettingsIn,
    GoalSettingsOut,
    GoalsProgress,
    ProjectionOut,
)

router = APIRouter(prefix="/goals", tags=["goals"])


@router.get("/settings", response_model=GoalSettingsOut)
def get_settings(session: Session = Depends(get_session)):
    return service.get_settings(session)


@router.put("/settings", response_model=GoalSettingsOut)
def save_settings(data: GoalSettingsIn, session: Session = Depends(get_session)):
    return service.save_settings(session, data)


@router.get("/progress", response_model=GoalsProgress)
def get_progress(session: Session = Depends(get_session)):
    return service.get_progress(session)


@router.get("/projection", response_model=ProjectionOut)
def get_projection(session: Session = Depends(get_session)):
    return service.get_projection(session)
