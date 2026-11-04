"""Importa os modelos de todas as features para que fiquem registrados no `Base.metadata`
(usado pelo Alembic e pelos testes)."""

from app.core.db import Base
from app.features.allocation import models as _allocation  # noqa: F401
from app.features.benchmarks import models as _benchmarks  # noqa: F401
from app.features.cash import models as _cash  # noqa: F401
from app.features.contributions import models as _contributions  # noqa: F401
from app.features.goals import models as _goals  # noqa: F401
from app.features.history import models as _history  # noqa: F401
from app.features.portfolio import models as _portfolio  # noqa: F401
from app.features.reserve import models as _reserve  # noqa: F401

__all__ = ["Base"]
