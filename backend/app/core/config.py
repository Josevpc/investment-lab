import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
BACKEND_DIR = PROJECT_ROOT / "backend"


@dataclass(frozen=True)
class Settings:
    database_url: str
    cors_origins: tuple[str, ...]
    # Nomes aceitos no cabeçalho Host: só o próprio computador (ver `core/protection.py`).
    allowed_hosts: tuple[str, ...]
    auto_migrate: bool
    # Busca CDI e Selic no Banco Central ao subir, se os dados estiverem velhos.
    benchmarks_auto: bool
    # Modo demonstração: banco separado com dados fictícios e selo na tela.
    demo: bool
    # Pasta com a tela compilada (`npm run build`). Se existir, a API a serve em "/".
    static_dir: Path | None


REAL_DATABASE_PATH = PROJECT_ROOT / "data" / "investment.db"


def _default_database_url() -> str:
    REAL_DATABASE_PATH.parent.mkdir(exist_ok=True)
    return f"sqlite:///{REAL_DATABASE_PATH.as_posix()}"


@lru_cache
def get_settings() -> Settings:
    origins = os.environ.get(
        "INVESTMENT_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    )
    hosts = os.environ.get("INVESTMENT_ALLOWED_HOSTS", "localhost,127.0.0.1")
    return Settings(
        database_url=os.environ.get("INVESTMENT_DATABASE_URL") or _default_database_url(),
        cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
        allowed_hosts=tuple(h.strip() for h in hosts.split(",") if h.strip()),
        auto_migrate=os.environ.get("INVESTMENT_AUTO_MIGRATE", "1") != "0",
        benchmarks_auto=os.environ.get("INVESTMENT_BENCHMARKS_AUTO", "1") != "0",
        # "true" e "yes" também valem: quem pede demonstração não pode cair no banco real sem aviso.
        demo=os.environ.get("INVESTMENT_DEMO", "").strip().lower() in ("1", "true", "yes", "on"),
        static_dir=_static_dir(),
    )


def _static_dir() -> Path | None:
    """`INVESTMENT_STATIC_DIR` aponta para outra pasta; vazio desliga o servir da tela."""
    configured = os.environ.get("INVESTMENT_STATIC_DIR")
    if configured is None:
        return PROJECT_ROOT / "frontend" / "dist"
    return Path(configured) if configured.strip() else None
