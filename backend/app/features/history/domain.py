"""Regras puras de aportes: quanto do crescimento do patrimônio veio deles e a linha do tempo."""

import re
from dataclasses import dataclass

# Mais que isso vira gráfico ilegível e uma conta cara à toa.
MAX_MONTHS = 120
_MONTH = re.compile(r"(\d{4})-(0[1-9]|1[0-2])")


def parse_month(value: str) -> tuple[int, int] | None:
    """("YYYY-MM") -> (ano, mês); None se o texto não for um mês válido."""
    # fullmatch, não `$`: o `$` aceitaria uma quebra de linha no fim ("2026-03\n").
    match = _MONTH.fullmatch(value)
    return (int(match[1]), int(match[2])) if match else None


def month_index(month: str) -> int:
    """Meses corridos desde o ano 0: subtrair dois meses dá a distância entre eles."""
    year, number = parse_month(month) or (0, 0)
    return year * 12 + number - 1


def month_name(index: int) -> str:
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def month_span(first: str, last: str) -> list[str]:
    """Todos os meses de `first` a `last`, inclusive e em ordem crescente."""
    return [month_name(i) for i in range(month_index(first), month_index(last) + 1)]


@dataclass(frozen=True)
class Contributions:
    cents: int  # diário + planejado dos meses estimados
    source: str  # "diario" (exato), "misto" ou "planejado"
    estimated_months: list[str]  # meses que usaram o planejado, em ordem crescente


def combine_contributions(diary: dict[str, int], planned: dict[str, int]) -> Contributions:
    """Junta o diário (aportes lançados, por mês) com o plano (aporte planejado, por mês).

    Mês com aporte no diário usa só o diário, mesmo que o plano seja maior ou menor: o que foi
    lançado é o que aconteceu. Mês sem diário mas com plano usa o plano e conta como estimado.
    """
    estimated = sorted(
        month for month, cents in planned.items() if cents > 0 and month not in diary
    )
    cents = sum(diary.values()) + sum(planned[month] for month in estimated)
    if not estimated:
        source = "diario"
    elif diary:
        source = "misto"
    else:
        source = "planejado"
    return Contributions(cents=cents, source=source, estimated_months=estimated)
