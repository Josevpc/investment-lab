"""Registro de retiradas: os resgates da carteira com o efeito deles na reserva de emergência.

Só lê. Cada resgate mostra quanto a reserva tinha depois dele e quanto faltava para a meta, para
a pessoa ver o custo de ter mexido nela. O saldo vale na data efetiva do resgate (a em que os
saldos já mostram a queda), não na do dia: num resgate cujo saldo digitado já veio sem o dinheiro,
a linha do dia ainda tem o valor de antes.
"""

import datetime as dt
from bisect import bisect_right
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.features.portfolio import repository as repo
from app.features.portfolio.domain import redemption_effective_date
from app.features.portfolio.schemas import WithdrawalOut, WithdrawalsOut
from app.features.reserve import service as reserve

RESERVE_PURPOSE = "reserva"


@dataclass(frozen=True)
class ValueLine:
    """O que um ativo valia em cada data com registro de valor (ordenado por data)."""

    days: tuple[dt.date, ...]
    cents: tuple[int, ...]
    archived: bool

    def on(self, day: dt.date) -> int:
        """Valor da última linha com data <= `day`; 0 antes do cadastro do ativo.

        Mesma regra do histórico: o arquivado deixa de somar depois do último registro de valor.
        """
        if self.archived and day > self.days[-1]:
            return 0
        known = bisect_right(self.days, day)
        return self.cents[known - 1] if known else 0


def reserve_balance_on(lines: dict[int, ValueLine], reserve_ids: set[int], day: dt.date) -> int:
    return sum(line.on(day) for asset_id, line in lines.items() if asset_id in reserve_ids)


def gap_to_goal(goal_cents: int, balance_cents: int) -> int:
    """Quanto falta para a meta; 0 quando a reserva já a alcança."""
    return max(0, goal_cents - balance_cents)


def list_withdrawals(session: Session, year: int | None = None) -> WithdrawalsOut:
    movements = repo.list_movements(session, kind="resgate")  # data e id, do mais novo
    years = sorted({m.date.year for m in movements}, reverse=True)
    if year is not None:
        movements = [m for m in movements if m.date.year == year]

    # Arquivados inclusive: `reserve.get_reserve` só lista os ativos ativos da reserva, e um
    # arquivado continua tendo valor nas datas em que existiu.
    assets = repo.list_assets(session)
    archived = {a.id for a in assets if a.archived}
    reserve_ids = {a.id for a in assets if a.purpose == RESERVE_PURPOSE}
    # Não `get_reserve`: ele grava a linha padrão na primeira chamada e um GET não deve gravar.
    goal = reserve.goal_cents(session)

    days: dict[int, list[dt.date]] = {}
    cents: dict[int, list[int]] = {}
    observed: dict[int, list[dt.date]] = {}
    for row in repo.list_valuation_history(session):  # já ordenado por ativo e data
        days.setdefault(row.asset_id, []).append(row.date)
        cents.setdefault(row.asset_id, []).append(row.current_cents)
        if row.observed:
            observed.setdefault(row.asset_id, []).append(row.date)
    lines = {
        asset_id: ValueLine(tuple(asset_days), tuple(cents[asset_id]), asset_id in archived)
        for asset_id, asset_days in days.items()
    }

    items = []
    for movement in movements:
        effective = redemption_effective_date(
            movement.date, movement.in_balance, observed.get(movement.asset_id, [])
        )
        from_reserve = movement.asset_id in reserve_ids
        balance = None
        if from_reserve and effective is not None:
            balance = reserve_balance_on(lines, reserve_ids, effective)
        items.append(
            WithdrawalOut(
                movement_id=movement.id,
                date=movement.date,
                effective_date=effective,
                asset_id=movement.asset_id,
                asset_name=movement.asset.name,
                institution_name=movement.asset.institution.name,
                asset_archived=movement.asset.archived,
                amount_cents=movement.amount_cents,
                cost_cents=movement.cost_cents or 0,
                note=movement.note,
                in_balance=movement.in_balance,
                from_reserve=from_reserve,
                reserve_balance_after_cents=balance,
                reserve_below_goal_cents=(
                    gap_to_goal(goal, balance) if balance is not None and goal > 0 else None
                ),
            )
        )
    return WithdrawalsOut(
        items=items,
        total_cents=sum(i.amount_cents for i in items),
        count=len(items),
        reserve_total_cents=sum(i.amount_cents for i in items if i.from_reserve),
        years=years,
    )
