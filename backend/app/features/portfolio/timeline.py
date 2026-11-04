"""Linha do tempo da carteira: o que cada ativo valia nas datas em que alguém digitou um saldo e
quais fluxos externos de dinheiro aconteceram entre elas.

É a base do desempenho, da evolução e da meta do ano. Os fechamentos (snapshots) são só uma foto
opcional e não entram aqui. Funções puras: o serviço lê o banco e entrega as linhas.

Convenções que as contas de quem usa a linha do tempo precisam respeitar:

- uma data só entra na linha do tempo se algum ativo teve saldo digitado nela;
- em cada data, o ativo vale a sua última linha de valor até ali (digitada ou criada por
  transferência/compra), então um ativo atrasado mantém o último valor conhecido;
- o ativo arquivado entra com o histórico e deixa de somar depois da data do seu último registro de
  valor. Como o arquivamento não tem data, essa é a melhor aproximação: a saída vale ali, e não no
  dia em que ele foi arquivado. Se saiu com saldo, a saída é um fluxo (veja `_exit_flows`);
- um fluxo pertence ao intervalo em que os saldos passam a refleti-lo (`effective`), mas pesa pela
  data exata em que o dinheiro se mexeu (`date`).
"""

import datetime as dt
from collections.abc import Callable
from dataclasses import dataclass

from app.features.portfolio.domain import redemption_effective_date


@dataclass(frozen=True)
class AssetInfo:
    id: int
    name: str
    class_key: str
    is_reserve: bool
    archived: bool


@dataclass(frozen=True)
class ValuationRow:
    asset_id: int
    date: dt.date
    invested_cents: int
    current_cents: int
    observed: bool


@dataclass(frozen=True)
class MovementRow:
    kind: str
    date: dt.date
    asset_id: int
    related_asset_id: int | None
    amount_cents: int
    initial: bool = False
    from_purchase: bool = False
    in_balance: bool = False


@dataclass(frozen=True)
class AssetState:
    """O ativo numa data da linha do tempo."""

    current_cents: int
    invested_cents: int
    last_observed: dt.date  # data do último saldo digitado até ali (a idade do dado)


@dataclass(frozen=True)
class Flow:
    """Dinheiro que entrou (+) ou saiu (-) de ativos, por perna.

    Uma transferência tem duas pernas (destino +, origem -): quem mede um escopo soma só as pernas
    dos ativos dele, então a transferência dentro do escopo dá zero e a que o cruza vira fluxo.
    """

    date: dt.date  # quando o dinheiro se mexeu: é o que pesa na conta
    effective: dt.date  # primeira data em que os saldos já mostram o fluxo: define o intervalo
    # "aporte" | "resgate" | "transferencia" | "provento" | "entrada" | "saida"
    kind: str
    legs: tuple[tuple[int, int], ...]  # (id do ativo, centavos com sinal)

    def in_scope(self, member: Callable[[int], bool]) -> int:
        """Quanto do fluxo atravessou a fronteira do escopo (+ entrou, - saiu)."""
        return sum(cents for asset_id, cents in self.legs if member(asset_id))


@dataclass(frozen=True)
class Timeline:
    assets: dict[int, AssetInfo]
    dates: list[dt.date]  # datas com saldo digitado, em ordem crescente
    states: dict[dt.date, dict[int, AssetState]]  # só os ativos que já existiam na data
    flows: list[Flow]

    def totals(self, day: dt.date, in_scope: Callable[[int], bool]) -> tuple[int, int]:
        """(valor atual, investido) dos ativos do escopo na data."""
        current = invested = 0
        for asset_id, state in self.states[day].items():
            if in_scope(asset_id):
                current += state.current_cents
                invested += state.invested_cents
        return current, invested

    def archived_out(self, after: dt.date, up_to: dt.date) -> int:
        """Saldo de ativos arquivados que deixou de somar em (after, up_to], em centavos (>= 0).

        É a saída da linha do tempo, na mesma data em que o patrimônio deixa de somar o ativo, então
        quem mede a valorização soma isso de volta à variação do patrimônio.
        """
        return -sum(
            flow.in_scope(lambda _asset_id: True)
            for flow in self.flows
            if flow.kind == "saida" and after < flow.effective <= up_to
        )


def _first_on_or_after(days: list[dt.date], target: dt.date) -> dt.date | None:
    return next((day for day in days if day >= target), None)


def _states(
    rows: dict[int, list[ValuationRow]], dates: list[dt.date], archived: set[int]
) -> dict[dt.date, dict[int, AssetState]]:
    states: dict[dt.date, dict[int, AssetState]] = {day: {} for day in dates}
    for asset_id, asset_rows in rows.items():
        known = -1
        last_observed: dt.date | None = None
        for day in dates:
            if asset_id in archived and day > asset_rows[-1].date:
                break  # arquivado: não soma depois do último registro de valor
            while known + 1 < len(asset_rows) and asset_rows[known + 1].date <= day:
                known += 1
                if asset_rows[known].observed:
                    last_observed = asset_rows[known].date
            if known < 0:
                continue  # o ativo ainda não existia
            row = asset_rows[known]
            states[day][asset_id] = AssetState(
                row.current_cents, row.invested_cents, last_observed or asset_rows[0].date
            )
    return states


def _flows(
    rows: dict[int, list[ValuationRow]],
    observed: dict[int, list[dt.date]],
    movements: list[MovementRow],
) -> list[Flow]:
    first = {asset_id: asset_rows[0].date for asset_id, asset_rows in rows.items()}
    # Ativo que entra: o valor com que nasce é dinheiro que chegou ao escopo, não retorno. É o
    # valor atual (e não o investido), porque o ganho de antes do cadastro não aconteceu aqui.
    flows = [
        Flow(
            first[asset_id], first[asset_id], "entrada", ((asset_id, asset_rows[0].current_cents),)
        )
        for asset_id, asset_rows in rows.items()
        if asset_rows[0].current_cents > 0
    ]
    for m in movements:
        if m.initial or m.asset_id not in rows:
            continue  # o aporte inicial já está no valor de entrada do ativo
        if m.kind == "aporte":
            # Aporte do fechamento só aparece no primeiro saldo digitado a partir da data; a compra
            # (com o caixa) já está na linha do próprio dia.
            effective = (
                m.date if m.from_purchase else _first_on_or_after(observed[m.asset_id], m.date)
            )
            legs = ((m.asset_id, m.amount_cents),)
        elif m.kind == "resgate":
            effective = redemption_effective_date(m.date, m.in_balance, observed[m.asset_id])
            legs = ((m.asset_id, -m.amount_cents),)
        elif m.kind == "transferencia" and m.related_asset_id in rows:
            effective = m.date
            legs = ((m.asset_id, m.amount_cents), (m.related_asset_id, -m.amount_cents))
        elif m.kind == "provento" and m.related_asset_id in rows:
            # Provento creditado em outro ativo: sai de quem pagou e chega a quem recebeu, como uma
            # transferência. No mesmo escopo é neutro (o dividendo é rendimento); no escopo de
            # quem pagou é saída, e o retorno dele conta o que distribuiu. Os que ficam fora do
            # saldo não aparecem aqui.
            effective = m.date
            legs = ((m.related_asset_id, m.amount_cents), (m.asset_id, -m.amount_cents))
        else:
            continue
        if effective is None:
            continue
        # O que aconteceu até o cadastro do ativo já está no valor com que ele entrou.
        legs = tuple(leg for leg in legs if effective > first[leg[0]])
        if legs:
            flows.append(Flow(m.date, effective, m.kind, legs))
    return flows


def _exit_flows(
    rows: dict[int, list[ValuationRow]], archived: set[int], dates: list[dt.date]
) -> list[Flow]:
    """Saída dos ativos arquivados que ainda tinham saldo no último registro de valor.

    Sem isso o saldo ficaria somando para sempre. A saída vale na primeira data da linha do tempo
    em que o ativo já não soma, com peso zero: o ativo conta até a data anterior e a saída não
    mexe no retorno. Sem data depois do último registro, o ativo ainda está na última data e não
    há saída.
    """
    flows = []
    for asset_id in archived & rows.keys():
        last = rows[asset_id][-1]
        gone_on = next((day for day in dates if day > last.date), None)
        if last.current_cents > 0 and gone_on is not None:
            flows.append(Flow(gone_on, gone_on, "saida", ((asset_id, -last.current_cents),)))
    return flows


def build_timeline(
    assets: list[AssetInfo], valuations: list[ValuationRow], movements: list[MovementRow]
) -> Timeline:
    rows: dict[int, list[ValuationRow]] = {}
    for valuation in sorted(valuations, key=lambda v: v.date):
        rows.setdefault(valuation.asset_id, []).append(valuation)
    observed = {
        asset_id: [v.date for v in asset_rows if v.observed]
        for asset_id, asset_rows in rows.items()
    }
    dates = sorted({day for days in observed.values() for day in days})
    archived = {a.id for a in assets if a.archived}
    flows = _flows(rows, observed, movements) + _exit_flows(rows, archived, dates)
    return Timeline(
        assets={a.id: a for a in assets},
        dates=dates,
        states=_states(rows, dates, archived),
        flows=sorted(flows, key=lambda f: (f.effective, f.date)),
    )
