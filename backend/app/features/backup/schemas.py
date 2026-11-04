from datetime import datetime
from typing import Any

from pydantic import BaseModel


class BackupInspection(BaseModel):
    """Resumo de um arquivo de backup, mostrado antes de qualquer confirmação."""

    valid: bool
    compatible: bool
    # True: o arquivo é de uma versão anterior do esquema e será convertido ao restaurar.
    needs_conversion: bool = False
    # Impedem a restauração; se `valid`, só traz o aviso de conversão de versão (não impede).
    problems: list[str]
    exported_at: datetime | None
    schema_revision: str | None
    current_revision: str
    counts: dict[str, int]
    snapshots_from: str | None
    snapshots_to: str | None


class RestoreIn(BaseModel):
    backup: dict[str, Any]
    confirm: bool = False


class ResetIn(BaseModel):
    confirm: str = ""


class DataChangeResult(BaseModel):
    safety_backup: str | None  # arquivo de segurança criado antes de alterar os dados
    counts: dict[str, int]
    # Só na restauração: a versão do esquema do arquivo, quando ele precisou ser convertido.
    converted_from_revision: str | None = None
