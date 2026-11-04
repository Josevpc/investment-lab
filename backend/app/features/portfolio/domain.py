import datetime as dt
from decimal import ROUND_HALF_UP, Decimal, localcontext

from app.core.money import BPS


def return_bps(invested_cents: int, current_cents: int) -> int | None:
    """Rentabilidade simples (RN-05) em pontos-base, arredondada meio para cima."""
    if invested_cents <= 0:
        return None
    numerator = (current_cents - invested_cents) * BPS
    return (2 * numerator + invested_cents) // (2 * invested_cents)


def share_bps(part_cents: int, total_cents: int) -> int:
    """Participação de `part` no `total`, em pontos-base."""
    if total_cents <= 0:
        return 0
    return (2 * part_cents * BPS + total_cents) // (2 * total_cents)


def redemption_effective_date(
    on_date: dt.date, in_balance: bool, observed_dates: list[dt.date]
) -> dt.date | None:
    """Data a partir da qual as linhas de valor do ativo já mostram o resgate.

    Resgate comum mexe nas linhas desde o próprio dia. Resgate cujo saldo digitado já veio sem o
    dinheiro só mexe a partir do primeiro saldo digitado depois dele (as linhas de antes nunca
    o incluíram); sem saldo digitado a partir da data, nenhuma linha mudou (None).
    """
    if not in_balance:
        return on_date
    return min((d for d in observed_dates if d >= on_date), default=None)


def hold_status(assets_count: int, held_count: int) -> str:
    """Situação da categoria quanto a "manter posição", contando só ativos não arquivados.

    "all" exige ao menos um ativo mantido: categoria vazia é "none" (zero de zero não é "todos"),
    senão o aporte dela sumiria por um motivo que o usuário não vê.
    """
    if held_count == 0:
        return "none"
    return "all" if held_count == assets_count else "partial"


def purchase_amount_cents(quantity: Decimal, unit_price_cents: int) -> int:
    """Valor de uma compra por quantidade x preço unitário, arredondado meio para cima."""
    with localcontext() as ctx:
        ctx.prec = 60  # a quantidade fracionada (cripto) não pode perder dígitos na conta
        total = quantity * unit_price_cents
        return int(total.to_integral_value(rounding=ROUND_HALF_UP))
