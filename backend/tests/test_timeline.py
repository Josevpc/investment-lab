"""Linha do tempo da carteira: saldos por data, último valor conhecido e fluxos externos datados."""

import datetime as dt
import random

import pytest

from app.features.portfolio.timeline import (
    AssetInfo,
    MovementRow,
    ValuationRow,
    build_timeline,
)

D = dt.date

A = AssetInfo(1, "Ativo A", "renda_fixa", False, False)
B = AssetInfo(2, "Ativo B", "renda_fixa", False, False)
RESERVE = AssetInfo(3, "Reserva", "renda_fixa", True, False)


def row(asset_id, day, current, invested=None, observed=True):
    return ValuationRow(asset_id, day, current if invested is None else invested, current, observed)


def everything(_asset_id):
    return True


def flow_total(timeline, member, *, kind=None):
    return sum(f.in_scope(member) for f in timeline.flows if kind is None or f.kind == kind)


# ---- saldos por data ------------------------------------------------------------------------


def test_dates_are_the_days_with_a_typed_balance_and_values_carry_forward():
    timeline = build_timeline(
        [A, B],
        [
            row(1, D(2026, 9, 1), 100),
            row(1, D(2026, 9, 10), 90, observed=False),  # criada por transferência: não é saldo
            row(1, D(2026, 9, 20), 120),
            row(2, D(2026, 9, 5), 50),
        ],
        [],
    )

    assert timeline.dates == [D(2026, 9, 1), D(2026, 9, 5), D(2026, 9, 20)]
    on_5 = timeline.states[D(2026, 9, 5)]
    assert on_5[1].current_cents == 100  # A mantém o último valor conhecido
    assert on_5[1].last_observed == D(2026, 9, 1)
    assert on_5[2].last_observed == D(2026, 9, 5)
    assert 2 not in timeline.states[D(2026, 9, 1)]  # B ainda não existia
    assert timeline.states[D(2026, 9, 20)][1].last_observed == D(2026, 9, 20)


def test_an_unobserved_row_is_the_last_known_value_but_not_a_typed_balance():
    timeline = build_timeline(
        [A, B],
        [
            row(1, D(2026, 9, 1), 100),
            row(1, D(2026, 9, 10), 60, observed=False),
            row(2, D(2026, 9, 1), 0),
            row(2, D(2026, 9, 10), 40, observed=False),
            row(2, D(2026, 9, 30), 41),
        ],
        [],
    )

    assert D(2026, 9, 10) not in timeline.dates
    on_30 = timeline.states[D(2026, 9, 30)]
    assert on_30[1].current_cents == 60 and on_30[1].last_observed == D(2026, 9, 1)


def test_totals_sum_only_the_assets_in_the_scope():
    timeline = build_timeline(
        [A, RESERVE],
        [row(1, D(2026, 9, 1), 100, 80), row(3, D(2026, 9, 1), 50, 50)],
        [],
    )
    day = D(2026, 9, 1)
    assert timeline.totals(day, everything) == (150, 130)
    assert timeline.totals(day, lambda asset_id: not timeline.assets[asset_id].is_reserve) == (
        100,
        80,
    )


# ---- fluxos ---------------------------------------------------------------------------------


def two_assets():
    return [row(1, D(2026, 9, 1), 1_000), row(2, D(2026, 9, 1), 1_000), row(1, D(2026, 9, 30), 1)]


def test_transfer_between_two_assets_of_the_same_scope_is_neutral():
    transfer = MovementRow("transferencia", D(2026, 9, 15), 2, 1, 300)
    timeline = build_timeline([A, B], two_assets(), [transfer])

    [flow] = [f for f in timeline.flows if f.kind == "transferencia"]
    assert flow.in_scope(everything) == 0
    assert flow.in_scope(lambda asset_id: asset_id == 2) == 300  # cruza a fronteira de B
    assert flow.in_scope(lambda asset_id: asset_id == 1) == -300


@pytest.mark.parametrize("seed", range(20))
def test_a_transfer_never_changes_the_total_flow_of_a_scope_that_holds_both_ends(seed):
    rng = random.Random(seed)
    infos = [A, B, RESERVE]
    first = D(2026, 9, 1)
    rows = [row(info.id, first, 1_000) for info in infos]
    transfers = []
    for _ in range(rng.randint(1, 6)):
        origin, target = rng.sample(infos, 2)
        day = first + dt.timedelta(days=rng.randint(1, 28))
        transfers.append(
            MovementRow("transferencia", day, target.id, origin.id, rng.randint(1, 900))
        )
    timeline = build_timeline(infos, rows, transfers)

    assert flow_total(timeline, everything, kind="transferencia") == 0
    # Sem a reserva, só as transferências que cruzam a fronteira contam.
    outside = lambda asset_id: asset_id != RESERVE.id  # noqa: E731
    crossing = sum(
        t.amount_cents * ((t.asset_id != RESERVE.id) - (t.related_asset_id != RESERVE.id))
        for t in transfers
    )
    assert flow_total(timeline, outside, kind="transferencia") == crossing


def test_registering_an_asset_is_an_entry_not_a_return():
    timeline = build_timeline(
        [A, B],
        [row(1, D(2026, 9, 1), 100), row(2, D(2026, 9, 15), 50, 30), row(1, D(2026, 9, 30), 100)],
        [],
    )

    [entry] = [f for f in timeline.flows if f.kind == "entrada" and f.date == D(2026, 9, 15)]
    # Entra pelo valor atual: o ganho de antes do cadastro não é retorno do período.
    assert entry.in_scope(everything) == 50
    assert entry.effective == entry.date == D(2026, 9, 15)


def test_what_happened_up_to_the_registration_day_is_already_in_the_entry_value():
    rows = [row(1, D(2026, 9, 1), 1_000), row(2, D(2026, 9, 10), 500), row(1, D(2026, 9, 30), 1)]
    movements = [
        MovementRow("aporte", D(2026, 9, 8), 2, None, 200),  # antes do saldo do ativo novo
        MovementRow("aporte", D(2026, 9, 10), 2, None, 100, initial=True),
        MovementRow("transferencia", D(2026, 9, 10), 2, 1, 300),  # no dia do cadastro
    ]
    timeline = build_timeline([A, B], rows, movements)

    assert flow_total(timeline, everything) == 1_000 + 500 - 300  # só a perna da origem sobra
    assert flow_total(timeline, lambda asset_id: asset_id == 2) == 500  # entrada de B
    assert not [f for f in timeline.flows if f.kind == "aporte"]


def test_a_contribution_belongs_to_the_first_typed_balance_from_its_date():
    rows = [
        row(1, D(2026, 9, 1), 1_000),
        row(2, D(2026, 9, 1), 1_000),
        row(1, D(2026, 9, 5), 1_000),
        row(1, D(2026, 9, 30), 1_200),
        row(2, D(2026, 9, 30), 1_000),
    ]
    movements = [
        MovementRow("aporte", D(2026, 9, 12), 1, None, 200),
        MovementRow("aporte", D(2026, 9, 20), 2, None, 70, from_purchase=True),
    ]
    timeline = build_timeline([A, B], rows, movements)

    by_asset = {f.legs[0][0]: f for f in timeline.flows if f.kind == "aporte"}
    assert (by_asset[1].date, by_asset[1].effective) == (D(2026, 9, 12), D(2026, 9, 30))
    # A compra já está na linha do próprio dia.
    assert (by_asset[2].date, by_asset[2].effective) == (D(2026, 9, 20), D(2026, 9, 20))


def test_a_contribution_with_no_balance_after_it_is_not_a_flow():
    rows = [row(1, D(2026, 9, 1), 1_000)]
    timeline = build_timeline([A], rows, [MovementRow("aporte", D(2026, 9, 12), 1, None, 200)])
    assert not [f for f in timeline.flows if f.kind == "aporte"]


def test_a_redemption_uses_the_effective_date():
    rows = [row(1, D(2026, 9, 1), 1_000), row(1, D(2026, 9, 30), 600)]
    normal = MovementRow("resgate", D(2026, 9, 10), 1, None, 400)
    typed_later = MovementRow("resgate", D(2026, 9, 10), 1, None, 400, in_balance=True)

    [on_the_day] = [f for f in build_timeline([A], rows, [normal]).flows if f.kind == "resgate"]
    [on_the_balance] = [
        f for f in build_timeline([A], rows, [typed_later]).flows if f.kind == "resgate"
    ]

    assert (on_the_day.date, on_the_day.effective) == (D(2026, 9, 10), D(2026, 9, 10))
    # O dinheiro saiu no dia 10, mas o saldo só o mostra a partir do dia 30.
    assert (on_the_balance.date, on_the_balance.effective) == (D(2026, 9, 10), D(2026, 9, 30))
    assert on_the_balance.in_scope(everything) == -400


def test_a_redemption_typed_after_no_balance_is_not_a_flow():
    rows = [row(1, D(2026, 9, 1), 1_000)]
    movement = MovementRow("resgate", D(2026, 9, 10), 1, None, 400, in_balance=True)
    assert not [f for f in build_timeline([A], rows, [movement]).flows if f.kind == "resgate"]


def test_a_credited_provento_is_a_transfer_from_the_payer_to_the_receiver():
    rows = [
        row(1, D(2026, 9, 1), 1_000),
        row(2, D(2026, 9, 1), 1_000),
        row(2, D(2026, 9, 30), 1_050),
    ]
    credited = MovementRow("provento", D(2026, 9, 10), 1, 2, 50)
    uncredited = MovementRow("provento", D(2026, 9, 11), 1, None, 70)
    timeline = build_timeline([A, B], rows, [credited, uncredited])

    [flow] = [f for f in timeline.flows if f.kind == "provento"]
    assert flow.legs == ((2, 50), (1, -50))
    # Dentro do mesmo escopo o dividendo creditado é rendimento, não dinheiro de fora.
    assert flow.in_scope(everything) == 0
    # Para quem pagou, o dinheiro saiu do ativo (e conta como retorno dele).
    assert flow.in_scope(lambda asset_id: asset_id == 1) == -50
    assert flow.in_scope(lambda asset_id: asset_id == 2) == 50


# ---- ativo arquivado ----------------------------------------------------------------------------

ARCHIVED = AssetInfo(1, "Velho", "renda_fixa", False, True)


def test_an_archived_asset_stops_adding_up_after_its_last_value_with_a_neutral_exit():
    rows = [
        row(1, D(2026, 9, 1), 500),
        row(2, D(2026, 9, 1), 1_000),
        row(2, D(2026, 10, 30), 1_010),
        row(2, D(2027, 3, 30), 1_050),
    ]
    timeline = build_timeline([ARCHIVED, B], rows, [])

    totals = [timeline.totals(day, everything)[0] for day in timeline.dates]
    assert timeline.dates == [D(2026, 9, 1), D(2026, 10, 30), D(2027, 3, 30)]
    assert totals == [1_500, 1_010, 1_050]  # o arquivado sai e não congela o patrimônio
    [exit_flow] = [f for f in timeline.flows if f.kind == "saida"]
    # A saída vale na primeira data em que ele já não soma, e pesa zero ali.
    assert (exit_flow.date, exit_flow.effective) == (D(2026, 10, 30), D(2026, 10, 30))
    assert exit_flow.in_scope(everything) == -500


def test_an_archived_asset_with_the_last_date_of_the_timeline_has_no_exit():
    rows = [row(2, D(2026, 9, 1), 1_000), row(1, D(2026, 9, 1), 500)]
    timeline = build_timeline([ARCHIVED, B], rows, [])
    assert timeline.totals(D(2026, 9, 1), everything)[0] == 1_500
    assert not [f for f in timeline.flows if f.kind == "saida"]


def test_an_archived_asset_that_ended_at_zero_needs_no_exit_flow():
    rows = [
        row(1, D(2026, 9, 1), 500),
        row(1, D(2026, 9, 15), 0, observed=False),
        row(2, D(2026, 9, 1), 1_000),
        row(2, D(2026, 9, 30), 1_500),
    ]
    timeline = build_timeline([ARCHIVED, B], rows, [])
    assert not [f for f in timeline.flows if f.kind == "saida"]
    assert timeline.totals(D(2026, 9, 30), everything)[0] == 1_500


def test_nothing_is_a_flow_for_an_empty_portfolio():
    timeline = build_timeline([], [], [])
    assert (timeline.dates, timeline.flows) == ([], [])
