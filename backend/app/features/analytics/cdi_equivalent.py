"""Quanto % do CDI um ativo rendeu em um período (funções puras, sem banco).

Um produto "a 120% do CDI" rende, em cada dia útil, `1 + 1,20 x taxa_do_CDI_do_dia`. Dado o saldo
no começo do período, os aportes feitos no meio dele (com a data) e o saldo no fim, procuramos o
percentual `k` do CDI que, aplicado dia a dia, leva o saldo inicial mais os aportes ao saldo final.
Isso responde "rendeu 118% ou 120% do CDI?" já considerando que o aporte do dia 15 só rendeu a
partir do dia 15.

Convenção de datas: o período é (início, fim]. O saldo do dia de início já inclui o rendimento
desse dia; a taxa do dia de fim entra. Um aporte feito no dia D só rende a partir do dia útil
seguinte. Trocar essa convenção por um dia útil muda o resultado de um período de um mês em
alguns pontos percentuais do CDI, por isso períodos maiores são mais confiáveis.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

ONE = Decimal(1)
# A busca do percentual procura entre -500% e 3.000% do CDI; fora disso o dado está errado.
LOW = Decimal(-5)
HIGH = Decimal(30)
ITERATIONS = 60

Days = Sequence[tuple[date, Decimal]]


@dataclass(frozen=True)
class Flow:
    """Dinheiro que entrou (+) ou saiu (-) do ativo no meio do período."""

    date: date
    cents: int


def simulate(start_cents: int, flows: Sequence[Flow], days: Days, k: Decimal) -> Decimal:
    """Saldo final de `start_cents` mais os fluxos se o ativo rendesse `k` x CDI todo dia útil."""
    value = Decimal(start_cents)
    ordered = sorted(flows, key=lambda f: f.date)
    i = 0
    for day, rate in days:
        while i < len(ordered) and ordered[i].date < day:
            value += ordered[i].cents
            i += 1
        value *= ONE + k * rate
    while i < len(ordered):  # fluxos depois do último dia útil não rendem
        value += ordered[i].cents
        i += 1
    return value


def growth(days: Days, k: Decimal) -> Decimal:
    """Fator acumulado de R$ 1 aplicado no início, a `k` x CDI."""
    factor = ONE
    for _day, rate in days:
        factor *= ONE + k * rate
    return factor


def solve_pct_of_cdi(
    start_cents: int, flows: Sequence[Flow], days: Days, end_cents: int
) -> Decimal | None:
    """O `k` (1,20 = 120% do CDI) que explica o saldo final, ou None se não houver como medir."""
    capital = start_cents + sum(f.cents for f in flows if f.cents > 0)
    if capital <= 0 or not days:
        return None
    target = Decimal(end_cents)
    low, high = LOW, HIGH
    if (
        simulate(start_cents, flows, days, low) > target
        or simulate(start_cents, flows, days, high) < target
    ):
        return None
    for _ in range(ITERATIONS):
        mid = (low + high) / 2
        if simulate(start_cents, flows, days, mid) < target:
            low = mid
        else:
            high = mid
    return (low + high) / 2


def to_bps(value: Decimal) -> int:
    """Fração -> pontos-base, arredondando meio para cima (0,012 -> 120)."""
    return int((value * 10_000).to_integral_value(rounding=ROUND_HALF_UP))
