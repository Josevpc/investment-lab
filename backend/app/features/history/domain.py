"""Regra pura de quanto do crescimento do patrimônio veio de aportes."""

from dataclasses import dataclass


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
