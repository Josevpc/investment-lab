from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.errors import InvalidInputError
from app.features.backup import service
from app.features.backup.schemas import (
    BackupInspection,
    DataChangeResult,
    OffsiteCopyResult,
    OffsiteFolderIn,
    OffsiteStatus,
    ResetIn,
    RestoreIn,
)

router = APIRouter(prefix="/backup", tags=["backup"])


@router.get("/export")
def export_backup(session: Session = Depends(get_session)):
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return JSONResponse(
        content=service.export_data(session),
        headers={
            "Content-Disposition": f'attachment; filename="investment-lab-backup-{stamp}.json"'
        },
    )


@router.post("/inspect", response_model=BackupInspection)
def inspect_backup(payload: dict):
    return service.inspect_backup(payload)


@router.post("/restore", response_model=DataChangeResult)
def restore_backup(data: RestoreIn, session: Session = Depends(get_session)):
    if not data.confirm:
        raise InvalidInputError("Confirme a restauração: ela substitui todos os dados atuais.")
    return service.restore_backup(session, data.backup)


@router.get("/offsite", response_model=OffsiteStatus)
def get_offsite(session: Session = Depends(get_session)):
    return service.get_offsite(session)


@router.put("/offsite", response_model=OffsiteStatus)
def save_offsite(data: OffsiteFolderIn, session: Session = Depends(get_session)):
    return service.save_offsite_folder(session, data.folder)


@router.post("/offsite/copy", response_model=OffsiteCopyResult)
def copy_offsite(session: Session = Depends(get_session)):
    return service.copy_offsite(session)


@router.post("/reset", response_model=DataChangeResult)
def reset_data(data: ResetIn, session: Session = Depends(get_session)):
    if data.confirm != service.RESET_CONFIRMATION:
        raise InvalidInputError(
            f'Para apagar tudo, envie a confirmação "{service.RESET_CONFIRMATION}".'
        )
    return service.reset_data(session)
