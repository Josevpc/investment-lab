"""Converte as tabelas de um backup de uma versão anterior do esquema para a versão atual.

Em vez de reescrever cada mudança de esquema à mão, reaproveita as migrações do próprio app: monta
um banco SQLite temporário na revisão do arquivo, carrega as linhas ali, migra até a atual (as
migrações é que sabem converter os dados) e lê o resultado. Nada aqui toca o banco do usuário: o
endereço é sempre o do arquivo temporário, que é apagado no fim, com sucesso ou não.
"""

import logging
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

from alembic import command
from sqlalchemy import MetaData, create_engine, delete, insert
from sqlalchemy.orm import Session

from app.core.errors import InvalidInputError
from app.core.migrate import alembic_config
from app.features.backup import serialization

_VERSION_TABLE = "alembic_version"
log = logging.getLogger(__name__)


def _load(url: str, revision: str, tables: dict[str, Any]) -> None:
    """Esvazia o banco temporário e carrega nele as linhas do backup, só nas colunas da revisão."""
    engine = create_engine(url)
    try:
        metadata = MetaData()
        metadata.reflect(engine)
        present = [t for t in metadata.sorted_tables if t.name != _VERSION_TABLE]
        names = {t.name for t in present}
        for name, table_rows in tables.items():
            if table_rows and name not in names:
                raise InvalidInputError(
                    f"O backup traz a tabela {name}, que não existe na versão {revision}."
                )
        with engine.begin() as connection:
            # As migrações podem ter criado linhas iniciais; vale só o backup, como na restauração.
            for table in reversed(present):
                connection.execute(delete(table))
            for table in present:
                loaded = [
                    serialization.from_json(table, row, ignore_unknown=True)
                    for row in tables.get(table.name, [])
                ]
                if loaded:
                    connection.execute(insert(table), loaded)
    finally:
        engine.dispose()


def _read(url: str) -> dict[str, list[dict[str, Any]]]:
    engine = create_engine(url)
    try:
        with Session(engine) as session:
            return serialization.dump_tables(session)
    finally:
        engine.dispose()


def _remove_folder(folder: str) -> None:
    """Apaga a pasta temporária, que guarda uma cópia completa das finanças.

    No Windows o arquivo pode ficar preso por instantes (antivírus, indexador): tenta de novo. Se
    mesmo assim não sair, avisa no log com o caminho, para a pessoa poder apagar à mão.
    """
    for attempt in range(5):
        try:
            shutil.rmtree(folder)
            return
        except FileNotFoundError:
            return
        except OSError:
            time.sleep(0.2 * (attempt + 1))
    log.warning("Não foi possível apagar a pasta temporária da conversão do backup: %s", folder)


def convert_tables(revision: str, tables: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Tabelas do backup da `revision` já no formato da revisão atual, prontas para restaurar.

    `revision` precisa ser uma revisão anterior à atual (quem chama confere). Qualquer falha vira
    `InvalidInputError`: o banco do usuário ainda não foi tocado neste ponto.
    """
    folder = tempfile.mkdtemp(prefix="investment-lab-conversao-")
    try:
        url = f"sqlite:///{(Path(folder) / 'conversao.db').as_posix()}"
        command.upgrade(alembic_config(url), revision)
        _load(url, revision, tables)
        command.upgrade(alembic_config(url), "head")
        return _read(url)
    except InvalidInputError:
        raise
    except Exception as exc:
        raise InvalidInputError(
            f"Não foi possível converter o backup da versão {revision} para a atual; "
            f"nenhum dado foi alterado ({serialization.describe_error(exc)})."
        ) from exc
    finally:
        _remove_folder(folder)
