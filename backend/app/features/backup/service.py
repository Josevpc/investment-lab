"""Exportar, conferir, restaurar e reiniciar os dados.

O formato é um JSON com todas as tabelas de dados (a ordem e as colunas vêm do próprio modelo).
Restaurar e reiniciar apagam dados, então antes de mexer o app copia o arquivo do banco para
`data/backups/` e tudo roda em uma transação: se algo falhar, nada muda.

Um backup de uma versão anterior do esquema é convertido antes (`convert`), em um banco temporário,
e só então entra na restauração normal.

No fim ficam a cópia do banco para uma pasta fora deste computador (OneDrive, Drive, pendrive)
e a configuração dela. Essa configuração é deste computador e não entra no JSON.
"""

import os
import sqlite3
import threading
import uuid
from contextlib import closing, suppress
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Table, delete, func, insert, select, text
from sqlalchemy.orm import Session

from app.core.config import REAL_DATABASE_PATH, get_settings
from app.core.errors import ConflictError, DomainError, InvalidInputError
from app.core.migrate import backup_database_file, head_revision, revision_chain, sqlite_file
from app.features.backup import domain, serialization
from app.features.backup.convert import convert_tables
from app.features.backup.models import OffsiteBackupSetting
from app.features.backup.schemas import (
    BackupInspection,
    DataChangeResult,
    OffsiteCopyResult,
    OffsiteStatus,
)
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


# ---- Cópia fora deste computador ----------------------------------------------------------------

# Nome fixo do arquivo de trabalho: se uma cópia anterior morreu no meio, a seguinte o apaga em vez
# de acumular lixo na pasta sincronizada com a nuvem.
_TEMP_NAME = ".investment-lab-copia.tmp"
# Dois cliques seguidos em "Copiar agora" não podem escrever no mesmo arquivo de trabalho.
_copy_lock = threading.Lock()


class CopyFailedError(DomainError):
    status_code = 500


def _now() -> datetime:
    """Hora local sem fuso. Isolada para os testes controlarem o "agora"."""
    return datetime.now()


def _setting(session: Session) -> OffsiteBackupSetting:
    """A linha única; nasce vazia (cópia desligada). Quem grava confirma com `commit`."""
    setting = session.get(OffsiteBackupSetting, 1)
    if setting is None:
        setting = OffsiteBackupSetting(id=1)
        session.add(setting)
    return setting


def _can_write(folder: Path) -> bool:
    """Prova de escrita de verdade: `os.access` mente no Windows e em pastas de nuvem.

    Grava e apaga um arquivo de prova na pasta. Ele começa com ponto, mas no Windows isso não o
    deixa oculto: um programa de sincronização pode vê-lo por um instante. Por isso só quem grava
    de fato (salvar a pasta e copiar) a usa; a leitura do estado não.
    """
    probe = folder / f".investment-lab-prova-{uuid.uuid4().hex}.tmp"
    try:
        with open(probe, "xb") as handle:
            handle.write(b"ok")
        probe.unlink()
        return True
    except OSError:
        with suppress(OSError):
            probe.unlink()
        return False


def _usable(folder: Path) -> bool:
    return folder.is_dir() and _can_write(folder)


def _same_folder(first: str | None, second: str | None) -> bool:
    """Mesma pasta mesmo escrita de outro jeito (maiúsculas no Windows, `..`, link simbólico)."""
    if first is None or second is None:
        return False
    try:
        return os.path.normcase(os.path.realpath(first)) == os.path.normcase(
            os.path.realpath(second)
        )
    except (OSError, ValueError):
        return first == second


def _volume(path: Path) -> str | int:
    """Identifica o disco do caminho, mesmo que a pasta ainda não exista."""
    resolved = path.resolve()
    if os.name == "nt":
        return resolved.drive.casefold()
    existing = resolved
    while not existing.exists() and existing != existing.parent:
        existing = existing.parent
    return os.stat(existing).st_dev


def _same_drive(folder: Path | None, database_file: Path | None) -> bool:
    if folder is None or database_file is None:
        return False
    try:
        return _volume(folder) == _volume(database_file)
    except OSError:
        return False


def _status(setting: OffsiteBackupSetting) -> OffsiteStatus:
    now = _now()
    folder = Path(setting.folder) if setting.folder else None
    database_file = sqlite_file(get_settings().database_url)
    return OffsiteStatus(
        folder=setting.folder,
        # Só olha se a pasta existe: ler o estado (a tela consulta sempre) não pode gravar nem
        # apagar nada numa pasta de nuvem. A prova de escrita fica em salvar e em copiar.
        folder_available=folder is not None and folder.is_dir(),
        same_drive=_same_drive(folder, database_file),
        last_copy_at=setting.last_copy_at,
        last_copy_file=setting.last_copy_file,
        days_since_last_copy=domain.days_since(setting.last_copy_at, now),
        stale=domain.is_stale(setting.last_copy_at, now),
    )


def get_offsite(session: Session) -> OffsiteStatus:
    return _status(_setting(session))


def _folder_error(message: str, code: str) -> InvalidInputError:
    return InvalidInputError(message, code=code)


def _inside_app_data(folder: Path) -> bool:
    """A pasta é a `data/` do app (ou está dentro dela), ou a pasta do banco em uso.

    Uma "cópia externa" ali morre junto com o banco; e, no modo demonstração, o banco em uso fica
    dentro da `data/` real, que não pode virar destino por engano.
    """
    data_dirs = {REAL_DATABASE_PATH.parent.resolve()}
    database_file = sqlite_file(get_settings().database_url)
    if database_file is not None:
        data_dirs.add(database_file.parent.resolve())
    resolved = folder.resolve()
    return any(resolved.is_relative_to(data_dir) for data_dir in data_dirs)


def _prepare_folder(raw: str) -> Path:
    """Valida a pasta escolhida e a cria (um nível só) se faltar. Nada é criado se algo falhar."""
    # O Explorer copia caminhos entre aspas ("Copiar como caminho").
    text_path = raw.strip().strip('"').strip()
    folder = Path(text_path) if text_path else None
    if folder is None or not folder.is_absolute():
        raise _folder_error(
            "Informe o caminho completo da pasta, por exemplo C:\\Users\\Nome\\OneDrive\\Backups.",
            "folder_not_absolute",
        )
    created = False
    try:
        if _inside_app_data(folder):
            raise _folder_error(
                "Esta pasta fica dentro da pasta de dados do app e se perderia junto com o banco. "
                "Escolha uma pasta fora dela, de preferência sincronizada com a nuvem.",
                "folder_inside_data",
            )
        if not folder.exists():
            if not folder.parent.is_dir():
                raise _folder_error(
                    "Não encontrei esta pasta nem a pasta que a contém. Confira o caminho "
                    "e se o OneDrive, o Google Drive ou o pendrive está conectado.",
                    "folder_not_found",
                )
            folder.mkdir()
            created = True
    except (OSError, ValueError, RuntimeError):
        raise _folder_error(
            "Não consegui acessar este caminho. Confira se ele está correto.", "folder_not_found"
        ) from None
    if not folder.is_dir() or not _can_write(folder):
        if created:
            with suppress(OSError):
                folder.rmdir()  # não deixa para trás a pasta que acabou de criar
        raise _folder_error(
            "Não consigo gravar nesta pasta. Escolha uma onde você tenha permissão de escrita.",
            "folder_not_writable",
        )
    return folder


def save_offsite_folder(session: Session, raw_folder: str | None) -> OffsiteStatus:
    """Escolhe a pasta da cópia, ou desliga (nulo).

    A data e o arquivo da última cópia descrevem uma cópia na pasta atual: trocar de pasta ou
    desligar zera os dois (senão a tela diria "protegido" sem cópia na pasta nova). Salvar a mesma
    pasta de novo mantém.
    """
    setting = _setting(session)
    new_folder = None if raw_folder is None else str(_prepare_folder(raw_folder))
    if not _same_folder(setting.folder, new_folder):
        setting.last_copy_at = None
        setting.last_copy_file = None
    setting.folder = new_folder
    session.commit()
    return _status(setting)


def _write_copy(source: Path | None, folder: Path, name: str) -> int:
    """Grava a cópia consistente em arquivo de trabalho, confere e só então dá o nome final.

    A API de backup do SQLite lê o banco aberto com segurança (copiar o arquivo no meio de uma
    gravação pode gerar uma cópia quebrada). O banco em uso é aberto só para leitura. Devolve o
    tamanho do arquivo final; em qualquer falha o arquivo de trabalho é apagado.
    """
    if source is None or not source.is_file():
        raise FileNotFoundError("o banco em uso não é um arquivo SQLite")
    temp = folder / _TEMP_NAME
    temp.unlink(missing_ok=True)
    try:
        with (
            closing(sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True)) as origin,
            closing(sqlite3.connect(temp)) as target,
        ):
            origin.backup(target)
        # Conexão nova e já fechada antes do `replace`: o Windows não renomeia arquivo aberto.
        with closing(sqlite3.connect(temp)) as check:
            if [row[0] for row in check.execute("PRAGMA integrity_check")] != ["ok"]:
                raise sqlite3.DatabaseError("a cópia não passou na conferência de integridade")
        final = folder / name
        os.replace(temp, final)
        return final.stat().st_size
    except BaseException:
        with suppress(OSError):
            temp.unlink(missing_ok=True)
        raise


def _prune(folder: Path, newest: str) -> int:
    """Apaga as cópias do app além das 10 mais recentes. Devolve quantas ficam.

    A retenção conta tudo o que tem o nome do app na pasta. Se bancos diferentes (por exemplo o da
    demonstração) apontarem para a mesma pasta, as cópias deles competem pelas mesmas 10 vagas;
    isso é aceito porque a configuração da pasta é por banco.
    """
    names = [
        entry.name
        for entry in os.scandir(folder)
        if entry.is_file(follow_symlinks=False) and domain.is_app_copy(entry.name)
    ]
    remaining = len(names)
    for old in domain.copies_to_delete(names, protect=newest):
        try:
            (folder / old).unlink()
            remaining -= 1
        except OSError:
            pass  # fica uma cópia a mais por ora; a próxima tenta de novo
    return remaining


def copy_offsite(session: Session) -> OffsiteCopyResult:
    setting = _setting(session)
    if not setting.folder:
        raise ConflictError(
            "Escolha antes a pasta da cópia fora deste computador.", code="no_folder"
        )
    folder = Path(setting.folder)
    # A pasta sumiu (pendrive tirado, Drive desconectado): não recria, porque criar a pasta no
    # lugar errado daria a falsa impressão de que a cópia está protegida.
    if not _usable(folder):
        raise InvalidInputError(
            "A pasta da cópia não está acessível agora. Confira se o OneDrive, o Google Drive ou "
            "o pendrive está conectado e se a pasta ainda existe.",
            code="folder_unavailable",
        )
    moment = _now().replace(microsecond=0)
    name = domain.copy_file_name(moment)
    source = sqlite_file(get_settings().database_url)
    with _copy_lock:
        try:
            size = _write_copy(source, folder, name)
        except Exception as exc:
            raise CopyFailedError(
                "Não foi possível gravar a cópia. Nada foi gravado e a última cópia válida "
                f"continua valendo ({serialization.describe_error(exc)}).",
                code="copy_failed",
            ) from exc
        # Registra antes de limpar: a cópia nova já está pronta e conferida, e a limpeza é esforço
        # extra. Se ela falhar, a cópia boa continua registrada.
        setting.last_copy_at = moment
        setting.last_copy_file = name
        session.commit()
        try:
            kept = _prune(folder, name)
        except OSError:
            kept = 1  # estimativa: pelo menos a que acabou de ser gravada; a próxima limpa
    return OffsiteCopyResult(file=name, size_bytes=size, copied_at=moment, kept=kept)
