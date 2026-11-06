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


class OffsiteFolderIn(BaseModel):
    # Nulo desliga a cópia externa. Desligar ou trocar de pasta zera a data e o arquivo da última
    # cópia, que descrevem uma cópia na pasta atual.
    folder: str | None


class OffsiteStatus(BaseModel):
    """Estado da cópia fora deste computador, como a tela mostra."""

    folder: str | None
    # A pasta existe agora (pendrive/Drive desconectado = falso). Poder escrever nela só é provado
    # ao salvar e ao copiar; ler o estado não grava nada.
    folder_available: bool
    # A pasta está no mesmo disco do banco: não protege contra a perda do disco.
    same_drive: bool
    last_copy_at: datetime | None
    last_copy_file: str | None
    days_since_last_copy: int | None
    # Sem cópia nenhuma, ou a última tem mais de 7 dias.
    stale: bool


class OffsiteCopyResult(BaseModel):
    file: str
    size_bytes: int
    copied_at: datetime
    # Quantas cópias do app ficam na pasta depois da limpeza (no máximo 10).
    kept: int


class DataChangeResult(BaseModel):
    safety_backup: str | None  # arquivo de segurança criado antes de alterar os dados
    counts: dict[str, int]
    # Só na restauração: a versão do esquema do arquivo, quando ele precisou ser convertido.
    converted_from_revision: str | None = None
