"""Rentabilidade acumulada de uma carteira ou categoria e dos índices de referência.

Funções puras: o serviço monta os saldos e fluxos a partir da linha do tempo da carteira e as taxas
do CDI a partir do banco.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from fractions import Fraction
from math import floor

from app.features.analytics.cdi_equivalent import ONE, Days, growth


@dataclass(frozen=True)
class Observation:
    """Valor de um escopo (carteira ou categoria) numa data com saldo digitado."""

    date: date
    value_cents: int


@dataclass(frozen=True)
class ScopeFlow:
    """Dinheiro que cruzou a fronteira do escopo: + entrou, - saiu."""

    date: date  # quando o dinheiro se mexeu: é o que pesa
    effective: date  # primeira data em que os saldos já mostram o fluxo: define o intervalo
    cents: int


@dataclass(frozen=True)
class Chained:
    # Retorno acumulado (fração exata) em cada data; None antes da base. Frações, e não Decimal:
    # o produto de muitos intervalos não perde precisão e o meio ponto-base cai do lado certo.
    returns: list[Fraction | None]
    flows_cents: list[int]  # fluxo líquido desde a data anterior (0 na data-base)
    gaps: int  # intervalos que não puderam ser medidos


def first_index_with_balance(observations: list[Observation]) -> int | None:
    return next((i for i, o in enumerate(observations) if o.value_cents > 0), None)


def chained_returns(observations: list[Observation], flows: list[ScopeFlow]) -> Chained:
    """Retorno acumulado pelo método de Dietz modificado, encadeado entre datas consecutivas.

    Em cada intervalo (t0, t1]: retorno = (V1 - V0 - F) / (V0 + soma de cada fluxo x peso), com o
    peso (t1 - d) / (t1 - t0) em dias corridos, ou seja, a fração do intervalo em que o dinheiro do
    fluxo ficou aplicado. O fluxo da data final pesa 0; o da data inicial já está no saldo inicial
    e nem entra. Os retornos dos intervalos se multiplicam. A primeira data com saldo é a base (0%).
    """
    result: list[Fraction | None] = [None] * len(observations)
    flows_cents = [0] * len(observations)
    base = first_index_with_balance(observations)
    if base is None:
        return Chained(result, flows_cents, 0)

    accumulated = Fraction(1)
    gaps = 0
    result[base] = Fraction(0)
    for i in range(base + 1, len(observations)):
        start, end = observations[i - 1], observations[i]
        inside = [f for f in flows if start.date < f.effective <= end.date]
        total = sum(f.cents for f in inside)
        span = (end.date - start.date).days
        # Um fluxo que o saldo só mostra depois da data exata (ativo atrasado) pesa a partir do
        # começo do intervalo: antes disso o dinheiro estava em outro intervalo.
        weighted = sum(
            (Fraction(f.cents * (end.date - max(f.date, start.date)).days, span) for f in inside),
            Fraction(0),
        )
        denominator = start.value_cents + weighted
        factor = (
            1 + Fraction(end.value_cents - start.value_cents - total) / denominator
            if denominator > 0
            else Fraction(-1)
        )
        if factor < 0:  # sem base para medir, ou dados que se contradizem: o retorno não anda
            gaps += 1
        else:
            accumulated *= factor
        result[i] = accumulated - 1
        flows_cents[i] = total
    return Chained(result, flows_cents, gaps)


def cdi_returns(
    dates: list[date],
    base: int | None,
    days: Days,
    tolerance: timedelta,
    through: date | None,
) -> list[Decimal | None]:
    """CDI acumulado (fração) entre a data-base e cada data seguinte, composto dia a dia.

    `days` são os dias úteis em (data-base, última data]; `through` é o último dia de CDI guardado
    (None se nada foi baixado). Compõe a taxa de cada dia útil do intervalo. Duas datas sem dia útil
    entre elas (sexta e sábado) têm CDI de 0%. Se o CDI guardado não alcança o começo ou o fim do
    intervalo (além da tolerância de fim de semana e feriado emendados), o ponto fica sem valor:
    não se inventa dado.
    """
    result: list[Decimal | None] = [None] * len(dates)
    if base is None:
        return result
    result[base] = Decimal(0)
    if through is None or (days and days[0][0] - dates[base] > tolerance):
        return result
    factor = ONE
    cursor = 0
    for i in range(base + 1, len(dates)):
        stop = cursor
        while stop < len(days) and days[stop][0] <= dates[i]:
            stop += 1
        factor *= growth(days[cursor:stop], ONE)
        cursor = stop
        if dates[i] - through <= tolerance:
            result[i] = factor - 1
    return result


def index_return(start_close: int | None, end_close: int | None) -> Decimal | None:
    """Variação (fração) de um índice de pontos entre dois fechamentos; None se faltar um deles."""
    if start_close is None or start_close <= 0 or end_close is None:
        return None
    return Decimal(end_close) / Decimal(start_close) - 1


def index_returns(closes: list[int | None], base: int | None) -> list[Decimal | None]:
    """Variação acumulada do índice entre o fechamento da data-base e o de cada data seguinte.

    `closes[i]` é o fechamento em ou antes da data i (None se não há). Sem fechamento no base,
    nada é comparável e tudo fica sem valor.
    """
    result: list[Decimal | None] = [None] * len(closes)
    if base is None:
        return result
    for i in range(base, len(closes)):
        result[i] = index_return(closes[base], closes[i])
    return result


def to_bps(value: Decimal | Fraction | None) -> int | None:
    """Fração -> pontos-base, meio para cima (0,5 bp sobe para 1; -0,5 bp sobe para 0).

    É a mesma regra do retorno simples do ativo (`portfolio.domain.return_bps`), para a carteira de
    um ativo só dar exatamente o número dele.
    """
    if value is None:
        return None
    return floor(Fraction(value) * 10_000 + Fraction(1, 2))
