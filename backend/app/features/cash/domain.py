"""Regras puras do caixa: sinais, saldo, saldo nunca negativo e capital aportado.

Tudo em centavos inteiros e sem banco, para testar sem montar cenário.
"""

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date

OPENING = "saldo_inicial"
DEPOSIT = "deposito"
WITHDRAWAL = "retirada"
PURCHASE = "compra"
PROVENTO = "provento"
SALE = "venda"
TRANSFER = "transferencia"
ADJUSTMENT = "ajuste"

KINDS = (
    OPENING,
    DEPOSIT,
    PROVENTO,
    PURCHASE,
    SALE,
    "taxa",
    WITHDRAWAL,
    ADJUSTMENT,
    TRANSFER,
)
POSITIVE_KINDS = frozenset({DEPOSIT, PROVENTO, SALE})
NEGATIVE_KINDS = frozenset({PURCHASE, WITHDRAWAL, "taxa"})

_LABELS = {
    DEPOSIT: "depósito",
    PROVENTO: "provento",
    SALE: "venda",
    PURCHASE: "compra",
    WITHDRAWAL: "retirada",
    "taxa": "taxa",
    ADJUSTMENT: "ajuste",
    OPENING: "saldo inicial",
    TRANSFER: "transferência",
}


@dataclass(frozen=True)
class NewEntry:
    """Lançamento a gravar. O `amount_cents` já vem com o sinal certo para o tipo."""

    date: date
    kind: str
    amount_cents: int
    asset_id: int | None = None
    movement_id: int | None = None
    transfer_id: str | None = None


@dataclass(frozen=True)
class Shortfall:
    """Pior dia em que o saldo fica negativo: `cents` é quanto faltaria nesse dia."""

    day: date
    cents: int


def sign_error(kind: str, amount_cents: int) -> str | None:
    """Mensagem de erro se o sinal do valor não combina com o tipo; None se estiver certo."""
    if kind not in KINDS:
        return f"Tipo de lançamento desconhecido: {kind}."
    label = _LABELS[kind]
    if kind in POSITIVE_KINDS and amount_cents <= 0:
        return f"O valor de {label} deve ser maior que zero."
    if kind in NEGATIVE_KINDS and amount_cents >= 0:
        return f"O valor de {label} deve sair do caixa (negativo)."
    if kind == OPENING and amount_cents < 0:
        return "O saldo inicial não pode ser negativo."
    if kind in (ADJUSTMENT, TRANSFER) and amount_cents == 0:
        return f"O valor de {label} não pode ser zero."
    return None


def balance_at(rows: Iterable[tuple[date, int]], as_of: date) -> int:
    """Saldo ao fim de `as_of`: soma dos lançamentos até essa data, inclusive."""
    return sum(amount for day, amount in rows if day <= as_of)


def worst_shortfall(rows: Iterable[tuple[date, int]], from_date: date) -> Shortfall | None:
    """Pior saldo negativo ao fim de qualquer dia a partir de `from_date`, ou None se não houver.

    A ordem dentro do mesmo dia não importa: só o saldo ao fim do dia conta. Um depósito de
    `Shortfall.cents` na data do lançamento conserta todos os dias seguintes de uma vez.
    """
    by_day: dict[date, int] = defaultdict(int)
    for day, amount in rows:
        by_day[day] += amount
    running = 0
    worst: Shortfall | None = None
    for day in sorted(by_day):
        running += by_day[day]
        if day >= from_date and running < 0 and (worst is None or -running > worst.cents):
            worst = Shortfall(day=day, cents=-running)
    return worst


@dataclass(frozen=True)
class Capital:
    deposits_cents: int
    withdrawals_cents: int  # positivo: quanto saiu

    @property
    def contributed_cents(self) -> int:
        return self.deposits_cents - self.withdrawals_cents


def contributed_capital(
    rows: Iterable[tuple[date, str, int]], as_of: date, start: date | None = None
) -> Capital:
    """Capital aportado = depósitos - retiradas, de `start` (inclusive) até `as_of` (inclusive).

    Saldo inicial, provento, venda, taxa, ajuste, compra e transferência não contam: não são
    dinheiro que entrou ou saiu do patrimônio.
    """
    deposits = withdrawals = 0
    for day, kind, amount in rows:
        if day > as_of or (start is not None and day < start):
            continue
        if kind == DEPOSIT:
            deposits += amount
        elif kind == WITHDRAWAL:
            withdrawals += -amount
    return Capital(deposits_cents=deposits, withdrawals_cents=withdrawals)


def reconciliation_difference(real_cents: int, calculated_cents: int) -> int:
    """Diferença da conciliação: o que o extrato real tem a mais (+) ou a menos (-)."""
    return real_cents - calculated_cents
