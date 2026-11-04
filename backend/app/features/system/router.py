"""Status do ambiente de dados, mostrado na barra superior e em Configurações."""

from datetime import datetime

from alembic.runtime.migration import MigrationContext
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_session
from app.core.migrate import head_revision, sqlite_file
from app.features.benchmarks.service import get_status as benchmarks_status

router = APIRouter(prefix="/system", tags=["system"])

VERSION = "0.1.0"


class SystemStatus(BaseModel):
    version: str
    storage: str  # "local": os dados ficam neste computador
    database_file: str | None
    database_size_bytes: int | None
    schema_revision: str | None
    expected_revision: str
    backups_count: int
    last_backup_at: datetime | None
    benchmarks_updated_at: datetime | None
    demo: bool


@router.get("/status", response_model=SystemStatus)
def status(session: Session = Depends(get_session)):
    database_url = get_settings().database_url
    path = sqlite_file(database_url)
    backup_dir = path.parent / "backups" if path else None
    files = (
        sorted(backup_dir.glob("*.db"), key=lambda p: p.stat().st_mtime)
        if backup_dir and backup_dir.exists()
        else []
    )
    current = MigrationContext.configure(session.connection()).get_current_revision()
    return SystemStatus(
        version=VERSION,
        storage="local",
        database_file=path.name if path else None,
        database_size_bytes=path.stat().st_size if path and path.is_file() else None,
        schema_revision=current,
        expected_revision=head_revision(),
        backups_count=len(files),
        last_backup_at=datetime.fromtimestamp(files[-1].stat().st_mtime) if files else None,
        benchmarks_updated_at=benchmarks_status(session).updated_at,
        demo=get_settings().demo,
    )
