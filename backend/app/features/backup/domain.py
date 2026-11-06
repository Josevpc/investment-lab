"""Regras puras da cópia do banco fora deste computador: nome, retenção e cópia velha."""

import re
from datetime import datetime

# As 10 cópias mais recentes ficam; a cópia seguinte apaga a mais antiga.
KEEP_COPIES = 10
# Passou disso sem cópia nova, a tela avisa.
STALE_AFTER_DAYS = 7

# Âncora nos dois lados: a retenção só pode apagar o que o app mesmo gravou, nunca um arquivo da
# pessoa que esteja na mesma pasta.
# `re.ASCII`: sem isso `\d` casa dígitos de outros alfabetos, que o app nunca grava.
_COPY_NAME = re.compile(r"investment-\d{4}-\d{2}-\d{2}-\d{6}\.db", re.ASCII)


def copy_file_name(moment: datetime) -> str:
    """`investment-AAAA-MM-DD-HHMMSS.db`, em hora local: ordenar pelo nome é ordenar pela data."""
    return f"investment-{moment:%Y-%m-%d-%H%M%S}.db"


def is_app_copy(name: str) -> bool:
    return _COPY_NAME.fullmatch(name) is not None


def copies_to_delete(
    names: list[str], keep: int = KEEP_COPIES, protect: str | None = None
) -> list[str]:
    """Cópias do app além das `keep` mais recentes. `protect` (a recém-gravada) nunca entra.

    Sem o `protect`, um relógio atrasado faria a cópia que acabou de ser gravada parecer a mais
    velha e ela seria apagada.
    """
    ordered = sorted((n for n in names if is_app_copy(n)), reverse=True)
    if protect in ordered:
        ordered.remove(protect)
        ordered.insert(0, protect)
    return ordered[keep:]


def days_since(last_copy_at: datetime | None, now: datetime) -> int | None:
    """Dias de calendário desde a última cópia (nunca negativo, mesmo com o relógio atrasado)."""
    if last_copy_at is None:
        return None
    return max(0, (now.date() - last_copy_at.date()).days)


def is_stale(last_copy_at: datetime | None, now: datetime) -> bool:
    """Sem cópia nenhuma, ou a última tem mais de 7 dias."""
    days = days_since(last_copy_at, now)
    return days is None or days > STALE_AFTER_DAYS
