from sqlalchemy.orm import Session

from app.features.allocation.service import ensure_default_plan
from app.features.portfolio.service import ensure_asset_classes


def seed(session: Session) -> None:
    """Dados iniciais idempotentes. A ordem importa: o plano usa as classes."""
    ensure_asset_classes(session)
    ensure_default_plan(session)
