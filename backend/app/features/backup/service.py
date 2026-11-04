"""Exportar, conferir, restaurar e reiniciar os dados.

O formato é um JSON com todas as tabelas de dados (a ordem e as colunas vêm do próprio modelo).
Restaurar e reiniciar apagam dados, então antes de mexer o app copia o arquivo do banco para
`data/backups/` e tudo roda em uma transação: se algo falhar, nada muda.

Um backup de uma versão anterior do esquema é convertido antes (`convert`), em um banco temporário,
e só então entra na restauração normal.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import Table, delete, func, insert, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import InvalidInputError
from app.core.migrate import backup_database_file, head_revision, revision_chain
from app.features.backup import serialization
from app.features.backup.convert import convert_tables
from app.features.backup.schemas import BackupInspection, DataChangeResult
from app.seed import seed

APP_NAME = "investment-lab"
FORMAT_VERSION = 1
RESET_CONFIRMATION = "APAGAR"
# Até esta revisão a marca de manter posição era do plano; a seguinte a passa para o ativo.
HOLD_MARK_REVISION = "0011"


def _tables() -> list[Table]:
    return serialization.data_tables()


def export_data(session: Session) -> dict[str, Any]:
    return {
        "app": APP_NAME,
        "format_version": FORMAT_VERSION,
        "schema_revision": head_revision(),
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "tables": serialization.dump_tables(session),
    }


def _convertible_from(revision: Any, current: str) -> bool:
    """A revisão do arquivo é conhecida e anterior à atual: as migrações sabem convertê-la."""
    chain = revision_chain()
    return revision in chain and chain.index(revision) < chain.index(current)


def _problems(payload: dict[str, Any]) -> tuple[list[str], list[str], bool]:
    """Retorna (problemas, avisos, compatível). Incompatível = o app não consegue restaurar.

    Problema impede a restauração; aviso (backup de versão anterior, que será convertido) não.
    """
    problems: list[str] = []
    warnings: list[str] = []
    if payload.get("app") != APP_NAME:
        problems.append("O arquivo não é um backup do Investment Lab.")
        return problems, warnings, False
    version = payload.get("format_version")
    if type(version) is not int or version != FORMAT_VERSION:  # `True == 1` não vale
        problems.append(f"Formato de backup não suportado: {version}.")
        return problems, warnings, False
    tables = payload.get("tables")
    if not isinstance(tables, dict):
        problems.append("O backup não traz a lista de tabelas.")
        return problems, warnings, False

    known = {t.name for t in _tables()}
    unknown = sorted(set(tables) - known)
    if unknown:
        problems.append("Tabelas desconhecidas no backup: " + ", ".join(unknown) + ".")
    if any(not isinstance(table_rows, list) for table_rows in tables.values()):
        problems.append("O conteúdo de uma tabela do backup está malformado.")

    current = head_revision()
    revision = payload.get("schema_revision")
    if revision != current:
        if _convertible_from(revision, current):
            notice = (
                f"Este backup é da versão {revision} e será convertido para a atual ({current}) "
                "ao restaurar. Os dados atuais são copiados para um arquivo de segurança antes."
            )
            chain = revision_chain()
            if chain.index(revision) <= chain.index(HOLD_MARK_REVISION):
                # A migração 0012 só registra isso no log; quem restaura precisa saber antes.
                notice += (
                    ' Atenção: as marcas de "manter posição" de planos inativos, e as de '
                    "categorias sem ativos, podem se perder na conversão."
                )
            warnings.append(notice)
        else:
            # Versão desconhecida ou mais nova que o app: não há como converter com segurança.
            problems.append(
                f"O backup é da versão {revision} do esquema e este app está na {current}. "
                "Restaure com a mesma versão do app que gerou o arquivo."
            )
    return problems, warnings, not problems


def inspect_backup(payload: dict[str, Any]) -> BackupInspection:
    problems, warnings, compatible = _problems(payload)
    revision = payload.get("schema_revision")
    raw_tables = payload.get("tables")
    tables = raw_tables if isinstance(raw_tables, dict) else {}
    counts = {
        name: len(table_rows) for name, table_rows in tables.items() if isinstance(table_rows, list)
    }

    exported_at = None
    raw_exported = payload.get("exported_at")
    if isinstance(raw_exported, str):
        try:
            exported_at = datetime.fromisoformat(raw_exported)
        except ValueError:
            problems.append("A data de exportação do backup é inválida.")
            compatible = False
    elif raw_exported is not None:  # número, lista, booleano...
        problems.append("A data de exportação do backup é inválida.")
        compatible = False

    snapshot_rows = tables.get("snapshot", [])
    snapshot_dates = sorted(
        row["date"]
        for row in (snapshot_rows if isinstance(snapshot_rows, list) else [])
        if isinstance(row, dict) and isinstance(row.get("date"), str)
    )
    return BackupInspection(
        valid=not problems,
        compatible=compatible,
        needs_conversion=bool(warnings) and compatible,
        # O aviso de conversão vai junto, depois dos problemas: a tela mostra tudo como está.
        problems=problems + warnings,
        exported_at=exported_at,
        schema_revision=revision if isinstance(revision, str) else None,
        current_revision=head_revision(),
        counts=counts,
        snapshots_from=snapshot_dates[0] if snapshot_dates else None,
        snapshots_to=snapshot_dates[-1] if snapshot_dates else None,
    )


def _count_rows(session: Session) -> dict[str, int]:
    return {t.name: session.scalar(select(func.count()).select_from(t)) or 0 for t in _tables()}


def _wipe(session: Session) -> None:
    for table in reversed(_tables()):  # filhos antes dos pais, por causa das chaves estrangeiras
        session.execute(delete(table))


def restore_backup(session: Session, payload: dict[str, Any]) -> DataChangeResult:
    inspection = inspect_backup(payload)
    if not inspection.valid:
        raise InvalidInputError(" ".join(inspection.problems))

    # Backup de versão anterior: converte antes de mexer em qualquer coisa. Se a conversão falhar,
    # o banco do usuário nem chegou a ser tocado (nem a cópia de segurança foi preciso fazer).
    tables = payload["tables"]
    converted_from = None
    if inspection.needs_conversion:
        converted_from = inspection.schema_revision
        tables = convert_tables(converted_from, tables)

    safety = _safety_copy("antes-da-restauracao")
    try:
        _wipe(session)
        for table in _tables():
            loaded = [serialization.from_json(table, row) for row in tables.get(table.name, [])]
            if loaded:
                session.execute(insert(table), loaded)
        _check_integrity(session)
        session.commit()
    except InvalidInputError:
        session.rollback()
        raise
    except Exception as exc:
        session.rollback()
        raise InvalidInputError(
            "Não foi possível restaurar o backup; nenhum dado foi alterado "
            f"({serialization.describe_error(exc)})."
        ) from exc
    return DataChangeResult(
        safety_backup=str(safety) if safety else None,
        counts=_count_rows(session),
        converted_from_revision=converted_from,
    )


def _safety_copy(label: str):
    """Copia o arquivo do banco antes de mexer; se não der, nada é alterado (422, não 500)."""
    try:
        return backup_database_file(get_settings().database_url, label)
    except Exception as exc:
        raise InvalidInputError(
            "Não foi possível criar a cópia de segurança do banco; nenhum dado foi alterado "
            f"({serialization.describe_error(exc)})."
        ) from exc


def _check_integrity(session: Session) -> None:
    """Confere o banco ainda dentro da transação: se algo estiver torto, o commit não acontece."""
    if session.execute(text("PRAGMA integrity_check")).scalars().all() != ["ok"]:
        raise InvalidInputError(
            "Os dados do backup deixariam o banco inconsistente; nenhum dado foi alterado."
        )
    if session.execute(text("PRAGMA foreign_key_check")).all():
        raise InvalidInputError(
            "O backup tem registros que apontam para outros que não existem; "
            "nenhum dado foi alterado."
        )


def reset_data(session: Session) -> DataChangeResult:
    """Apaga todos os dados e recria só o ponto de partida (categorias e plano padrão)."""
    safety = _safety_copy("antes-de-apagar")
    try:
        _wipe(session)
        session.commit()
    except Exception as exc:
        session.rollback()
        raise InvalidInputError(
            f"Não foi possível apagar os dados ({serialization.describe_error(exc)})."
        ) from exc
    seed(session)
    return DataChangeResult(
        safety_backup=str(safety) if safety else None, counts=_count_rows(session)
    )
