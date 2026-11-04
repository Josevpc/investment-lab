import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.engine import make_url

import app.registry  # noqa: F401  (registra os modelos)
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.errors import register_error_handlers
from app.core.migrate import upgrade_to_head
from app.core.protection import add_local_protection
from app.core.spa import mount_frontend
from app.demo import ensure_not_real_database, seed_demo
from app.features.allocation.router import router as allocation_router
from app.features.analytics.router import router as analytics_router
from app.features.backup.router import router as backup_router
from app.features.benchmarks.router import router as benchmarks_router
from app.features.benchmarks.service import refresh_if_stale as refresh_benchmarks_if_stale
from app.features.cash.router import router as cash_router
from app.features.contributions.router import router as contributions_router
from app.features.earnings.router import router as earnings_router
from app.features.goals.router import router as goals_router
from app.features.history.router import router as history_router
from app.features.portfolio.router import router as portfolio_router
from app.features.quotes.router import router as quotes_router
from app.features.reserve.router import router as reserve_router
from app.features.system.router import router as system_router
from app.seed import seed


def _refresh_benchmarks_in_background() -> None:
    """Atualiza CDI e Selic sem atrasar a subida do servidor. Falha de rede é ignorada."""
    try:
        with SessionLocal() as session:
            refresh_benchmarks_if_stale(session)
    except Exception:  # sem internet o app continua funcionando, só sem os índices novos
        pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    if settings.demo:
        # Antes de migrar: a demonstração não pode encostar no banco real nem para atualizá-lo.
        ensure_not_real_database(make_url(settings.database_url).database)
    if settings.auto_migrate:
        upgrade_to_head(settings.database_url)
    with SessionLocal() as session:
        seed(session)
        if settings.demo:
            seed_demo(session)
    if settings.benchmarks_auto:
        threading.Thread(target=_refresh_benchmarks_in_background, daemon=True).start()
    yield


def create_app(static_dir: Path | None | str = "auto") -> FastAPI:
    """`static_dir="auto"` usa a configuração; `None` não serve a tela (usado nos testes)."""
    settings = get_settings()
    app = FastAPI(title="Investment Lab", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    add_local_protection(app, settings.allowed_hosts)

    api = APIRouter(prefix="/api/v1")
    api.include_router(contributions_router)
    api.include_router(allocation_router)
    api.include_router(portfolio_router)
    api.include_router(cash_router)
    api.include_router(history_router)
    api.include_router(analytics_router)
    api.include_router(benchmarks_router)
    api.include_router(quotes_router)
    api.include_router(reserve_router)
    api.include_router(goals_router)
    api.include_router(earnings_router)
    api.include_router(backup_router)
    api.include_router(system_router)
    app.include_router(api)

    @app.get("/health", tags=["meta"])
    def health():
        return {"status": "ok"}

    # A tela entra por último: as rotas da API e /health têm prioridade sobre o fallback.
    mount_frontend(app, settings.static_dir if static_dir == "auto" else static_dir)
    return app


app = create_app()
