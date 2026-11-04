import sqlite3
from datetime import datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

from app.core.config import BACKEND_DIR


def alembic_config(database_url: str) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return config


def head_revision(database_url: str = "sqlite://") -> str:
    """Revisão mais recente do esquema (a que o código espera)."""
    return ScriptDirectory.from_config(alembic_config(database_url)).get_current_head()


def revision_chain() -> list[str]:
    """Todas as revisões do esquema, da primeira à mais recente (a cadeia do Alembic é linear)."""
    script = ScriptDirectory.from_config(alembic_config("sqlite://"))
    return [item.revision for item in reversed(list(script.walk_revisions()))]


def sqlite_file(database_url: str) -> Path | None:
    """Caminho do arquivo SQLite, ou None se não for um arquivo (memória ou outro banco)."""
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        return None
    return Path(url.database)


def backup_database_file(database_url: str, label: str) -> Path | None:
    """Copia o arquivo SQLite para `backups/` ao lado dele, com um rótulo no nome.

    Usa a API de backup do SQLite, que gera uma cópia consistente mesmo com o banco aberto.
    Retorna o caminho da cópia, ou None se o banco não é um arquivo existente com conteúdo.
    """
    source = sqlite_file(database_url)
    if source is None or not source.is_file() or source.stat().st_size == 0:
        return None
    backups = source.parent / "backups"
    backups.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    # Duas cópias no mesmo segundo não podem se sobrescrever: a primeira pode ser a única boa.
    target = _free_name(backups, f"{source.stem}-{stamp}-{label}", source.suffix)
    try:
        with sqlite3.connect(source) as origin, sqlite3.connect(target) as copy:
            origin.backup(copy)
    except Exception:
        target.unlink(missing_ok=True)  # não deixa um arquivo vazio passando por cópia
        raise
    return target


def _free_name(folder: Path, base: str, suffix: str) -> Path:
    """Cria (vazio) e devolve um arquivo novo; se o nome existe, acrescenta -2, -3..."""
    number = 1
    while True:
        name = f"{base}{suffix}" if number == 1 else f"{base}-{number}{suffix}"
        path = folder / name
        try:
            path.touch(exist_ok=False)
            return path
        except FileExistsError:
            number += 1


def backup_before_upgrade(database_url: str, config: Config | None = None) -> Path | None:
    """Copia o banco para `backups/` quando há migração pendente.

    Só age em banco SQLite que já existe e já tem migrações aplicadas; um banco novo não tem o
    que preservar. Retorna o caminho do backup, ou None se não foi necessário.
    """
    source = sqlite_file(database_url)
    if source is None or not source.is_file() or source.stat().st_size == 0:
        return None

    config = config or alembic_config(database_url)
    head = ScriptDirectory.from_config(config).get_current_head()
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            current = MigrationContext.configure(connection).get_current_revision()
    finally:
        engine.dispose()
    if current is None or current == head:
        return None
    return backup_database_file(database_url, f"rev{current}")


def upgrade_to_head(database_url: str) -> None:
    config = alembic_config(database_url)
    backup_before_upgrade(database_url, config)
    command.upgrade(config, "head")
