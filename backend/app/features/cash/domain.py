"""Regras puras do caixa: sinais, saldo, saldo nunca negativo, capital aportado e dinheiro
separado para comprar (reservas por categoria).

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


# ---- dinheiro separado por categoria ---------------------------------------------------------
# A separação não move saldo: só marca quanto do caixa já tem destino. O que continua separado é
# o valor da separação menos os usos dela, e todo uso (compra ou liberação) é um lançamento à
# parte, nunca uma edição da separação. Assim o passado de cada mês nunca é reescrito.

RELEASE = "liberacao"
USE_KINDS = (PURCHASE, RELEASE)


@dataclass(frozen=True)
class Reservation:
    id: int
    class_id: int
    date: date
    amount_cents: int

    def __post_init__(self) -> None:
        if self.amount_cents <= 0:
            raise ValueError("O valor separado deve ser maior que zero.")


@dataclass(frozen=True)
class ReservationUse:
    reservation_id: int
    kind: str  # "compra" ou "liberacao": as duas tiram do separado do mesmo jeito
    date: date
    amount_cents: int

    def __post_init__(self) -> None:
        if self.kind not in USE_KINDS:
            raise ValueError(f"Tipo de baixa desconhecido: {self.kind}.")
        if self.amount_cents <= 0:
            raise ValueError("O valor usado do separado deve ser maior que zero.")


@dataclass(frozen=True)
class OpenReservation:
    """Separação que ainda tem dinheiro em aberto numa data."""

    id: int
    class_id: int
    date: date
    remaining_cents: int


def open_reservations(
    reservations: Iterable[Reservation], uses: Iterable[ReservationUse], as_of: date
) -> list[OpenReservation]:
    """Separações feitas até `as_of` que ainda têm saldo, da mais antiga para a mais nova
    (desempate por id). Só contam os usos até `as_of`, para poder olhar qualquer data passada."""
    used: dict[int, int] = defaultdict(int)
    for use in uses:
        if use.date <= as_of:
            used[use.reservation_id] += use.amount_cents
    found = [
        OpenReservation(r.id, r.class_id, r.date, r.amount_cents - used[r.id])
        for r in reservations
        if r.date <= as_of
    ]
    return sorted((o for o in found if o.remaining_cents > 0), key=lambda o: (o.date, o.id))


def outstanding(
    reservations: Iterable[Reservation], uses: Iterable[ReservationUse], as_of: date
) -> dict[int, int]:
    """Valor separado em aberto por categoria (`class_id`) ao fim de `as_of`. Categoria sem nada
    em aberto não aparece."""
    totals: dict[int, int] = defaultdict(int)
    for item in open_reservations(reservations, uses, as_of):
        totals[item.class_id] += item.remaining_cents
    return dict(totals)


def separated_by_month(reservations: Iterable[Reservation]) -> dict[str, dict[int, int]]:
    """Valor separado por mês ("YYYY-MM", o da data da separação) e categoria.

    É o valor inteiro da separação, mesmo que já tenha sido usado ou liberado: o plano do mês conta
    o separado no mês em que ele foi separado, e o passado de um mês não muda depois.
    """
    months: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for reservation in reservations:
        months[reservation.date.strftime("%Y-%m")][reservation.class_id] += reservation.amount_cents
    return {month: dict(by_class) for month, by_class in months.items()}


@dataclass(frozen=True)
class ReserveFlows:
    """O que mexeu no separado num período, para separar valorização de dinheiro que entrou/saiu."""

    separated_by_month: dict[str, int]  # separações novas
    purchased_by_month: dict[str, int]  # gasto em compra: já virou valor do ativo
    released_cents: int  # devolvido ao caixa livre: sai do patrimônio, mas não é perda


def reserve_flows(
    reservations: Iterable[Reservation],
    uses: Iterable[ReservationUse],
    after: date,
    up_to: date,
) -> ReserveFlows:
    """Separações e baixas datadas em (`after`, `up_to`]: a mesma borda de `outstanding`, então a
    variação do separado entre as duas datas é separado - compra - liberação, sem sobra."""
    separated: dict[str, int] = defaultdict(int)
    purchased: dict[str, int] = defaultdict(int)
    released = 0
    for reservation in reservations:
        if after < reservation.date <= up_to:
            separated[reservation.date.strftime("%Y-%m")] += reservation.amount_cents
    for use in uses:
        if not after < use.date <= up_to:
            continue
        if use.kind == PURCHASE:
            purchased[use.date.strftime("%Y-%m")] += use.amount_cents
        else:
            released += use.amount_cents
    return ReserveFlows(dict(separated), dict(purchased), released)


def fifo_consume(
    open_items: Iterable[OpenReservation], amount_cents: int, on_date: date
) -> tuple[list[tuple[int, int]], int]:
    """Gasta `amount_cents` do separado, das separações mais antigas para as mais novas.

    Devolve as fatias `[(reservation_id, cents)]` e o que sobrou, que sai do caixa livre. Separação
    datada depois de `on_date` não existia na compra e fica de fora. Quem chama passa só as
    separações da categoria e da conta certas.
    """
    if amount_cents <= 0:
        raise ValueError("O valor a consumir deve ser maior que zero.")
    slices: list[tuple[int, int]] = []
    left = amount_cents
    for item in sorted(open_items, key=lambda o: (o.date, o.id)):
        if left == 0:
            break
        if item.date > on_date or item.remaining_cents <= 0:
            continue
        taken = min(left, item.remaining_cents)
        slices.append((item.id, taken))
        left -= taken
    return slices, left


def spends_existing_cash(entry_kinds: Iterable[str]) -> bool:
    """A compra sai do caixa que já existia? Sim se tem lançamento de compra e nenhum depósito
    ligado a ela. O aporte padrão (depósito + compra) é dinheiro novo e não gasta o separado; a
    compra pelo caixa e o aporte com `use_cash` gastam."""
    kinds = set(entry_kinds)
    return PURCHASE in kinds and DEPOSIT not in kinds


def overused_reservations(
    reservations: Iterable[Reservation], uses: Iterable[ReservationUse]
) -> list[int]:
    """Ids das separações cujos usos somam mais que o valor separado, em ordem de id.

    O banco não tem essa trava (é uma soma entre linhas); quem grava um uso confere antes, com os
    usos existentes mais o novo, e recusa se a lista não vier vazia.
    """
    used: dict[int, int] = defaultdict(int)
    for use in uses:
        used[use.reservation_id] += use.amount_cents
    return sorted(r.id for r in reservations if used[r.id] > r.amount_cents)


def worst_free_shortfall(
    entries: Iterable[tuple[date, int]],
    reservations: Iterable[Reservation],
    uses: Iterable[ReservationUse],
    from_date: date,
) -> int:
    """Quanto falta, no pior dia a partir de `from_date`, para o separado em aberto caber no caixa
    da conta; 0 se a regra "separado <= caixa" vale em todos os dias.

    Passam as separações e os usos de uma única conta, e os lançamentos dela (data, valor). Entre
    dois dias com movimento nada muda; usos só diminuem o separado, então o pior dia é `from_date`,
    um dia com lançamento no caixa ou um dia com separação nova.
    """
    entries, reservations, uses = list(entries), list(reservations), list(uses)
    days = {from_date}
    days.update(day for day, _ in entries if day >= from_date)
    days.update(r.date for r in reservations if r.date >= from_date)
    worst = 0
    for day in days:
        separated = sum(outstanding(reservations, uses, day).values())
        worst = max(worst, separated - balance_at(entries, day))
    return worst
