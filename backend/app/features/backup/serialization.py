"""Linhas do banco <-> JSON do backup. Serve à exportação, à restauração e à conversão de versão."""

from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, Integer, String, Table, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.errors import InvalidInputError
from app.registry import Base

# Configuração que vale só para este computador (caminho de pasta): não vai no JSON, e restaurar ou
# reiniciar os dados não a apaga. Quem restaura um backup não deve perder a pasta da cópia externa.
LOCAL_TABLES = frozenset({"offsite_backup_setting"})


def data_tables() -> list[Table]:
    """Tabelas de dados em ordem de dependência (pais antes dos filhos)."""
    return [t for t in Base.metadata.sorted_tables if t.name not in LOCAL_TABLES]


def to_json(value: Any) -> Any:
    if isinstance(value, datetime | date):
        return value.isoformat()
    return value


def _invalid(table: Table, column: str, expected: str) -> InvalidInputError:
    # Sem o valor na mensagem: ele é dado financeiro e a mensagem aparece na tela e em logs.
    return InvalidInputError(
        f"Valor inválido na tabela {table.name}, coluna {column}: esperado {expected}; "
        "nenhum dado foi alterado."
    )


def _typed(table: Table, name: str, column_type: Any, value: Any) -> Any:
    """Valor da coluna com o tipo certo, ou erro. O SQLite guardaria qualquer coisa que viesse."""
    if value is None:
        return None
    if isinstance(column_type, Boolean):
        # `true`/`false` do JSON; 0 e 1 aparecem em arquivos gerados direto do SQLite.
        if isinstance(value, bool) or (type(value) is int and value in (0, 1)):
            return value
        raise _invalid(table, name, "verdadeiro ou falso")
    if isinstance(column_type, Integer):
        if type(value) is int:  # exclui bool, float ("100.5") e texto
            return value
        raise _invalid(table, name, "número inteiro")
    if isinstance(column_type, DateTime | Date):
        if not isinstance(value, str):
            raise _invalid(table, name, "data em texto (AAAA-MM-DD)")
        try:
            if isinstance(column_type, DateTime):
                return datetime.fromisoformat(value)
            return date.fromisoformat(value)
        except ValueError:
            raise _invalid(table, name, "data válida (AAAA-MM-DD)") from None
    if isinstance(column_type, String):
        if isinstance(value, str):
            return value
        raise _invalid(table, name, "texto")
    return value


def from_json(table: Table, row: dict[str, Any], *, ignore_unknown: bool = False) -> dict[str, Any]:
    """Linha do JSON com os tipos da tabela (datas viram `date`/`datetime`), já conferidos.

    Coluna que a tabela não conhece é erro, a menos que `ignore_unknown`: na conversão de um backup
    antigo, a tabela é a da versão do arquivo e colunas de fora dela simplesmente não existiam.
    """
    if not isinstance(row, dict):
        raise InvalidInputError(f"Há uma linha malformada na tabela {table.name} do backup.")
    converted = {}
    for name, value in row.items():
        column = table.columns.get(name)
        if column is None:
            if ignore_unknown:
                continue
            raise InvalidInputError(f"Coluna desconhecida na tabela {table.name}: {name}.")
        converted[name] = _typed(table, name, column.type, value)
    return converted


def describe_error(exc: Exception) -> str:
    """Resumo curto de um erro para a tela: sem SQL, sem parâmetros e sem valores financeiros.

    O texto de um erro do SQLAlchemy traz a instrução e os valores da linha; só a mensagem do
    próprio SQLite ("FOREIGN KEY constraint failed", "UNIQUE constraint failed: tabela.coluna")
    é segura.
    """
    if isinstance(exc, DBAPIError) and exc.orig is not None:
        return str(exc.orig).splitlines()[0][:200]
    if isinstance(exc, ValueError | TypeError | KeyError | AttributeError):
        return type(exc).__name__
    return (str(exc).splitlines() or [type(exc).__name__])[0][:200]


def dump_tables(session: Session) -> dict[str, list[dict[str, Any]]]:
    """Todas as tabelas de dados como listas de linhas em JSON, na ordem da chave primária."""
    tables: dict[str, list[dict[str, Any]]] = {}
    for table in data_tables():
        order = list(table.primary_key.columns)
        rows = session.execute(select(table).order_by(*order)).mappings().all()
        tables[table.name] = [{k: to_json(v) for k, v in row.items()} for row in rows]
    return tables
