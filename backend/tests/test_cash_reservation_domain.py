from datetime import date

import pytest

from app.features.cash.domain import (
    OpenReservation,
    Reservation,
    ReservationUse,
    fifo_consume,
    open_reservations,
    outstanding,
    overused_reservations,
    reserve_flows,
    separated_by_month,
    worst_free_shortfall,
)

JUL, AUG, SEP, OCT = date(2026, 7, 10), date(2026, 8, 10), date(2026, 9, 10), date(2026, 10, 10)
ACOES = 1
FIIS = 2


def res(id_, day, cents, class_id=ACOES):
    return Reservation(id=id_, class_id=class_id, date=day, amount_cents=cents)


def use(res_id, day, cents, kind="compra"):
    return ReservationUse(reservation_id=res_id, kind=kind, date=day, amount_cents=cents)


# Três meses separando R$ 40 para a mesma categoria.
TRES_MESES = [res(1, JUL, 4000), res(2, AUG, 4000), res(3, SEP, 4000)]


# ---- exemplo do usuário ----------------------------------------------------------------------


def test_purchase_of_100_eats_three_slices_and_leaves_nothing_free():
    slices, free = fifo_consume(open_reservations(TRES_MESES, [], OCT), 10000, OCT)
    assert slices == [(1, 4000), (2, 4000), (3, 2000)]
    assert free == 0


def test_remaining_20_stays_open_and_adds_to_the_next_reservation():
    # Registrar a compra: as fatias viram usos; sobram R$ 20 da terceira separação.
    uses = [use(1, OCT, 4000), use(2, OCT, 4000), use(3, OCT, 2000)]
    assert outstanding(TRES_MESES, uses, OCT) == {ACOES: 2000}
    # Outra separação de R$ 40 no mês seguinte: 20 antigos + 40 novos, e o 20 sai primeiro.
    nova = TRES_MESES + [res(4, date(2026, 11, 5), 4000)]
    nov = date(2026, 11, 30)
    assert outstanding(nova, uses, nov) == {ACOES: 6000}
    slices, free = fifo_consume(open_reservations(nova, uses, nov), 3000, nov)
    assert slices == [(3, 2000), (4, 1000)]
    assert free == 0


# ---- consumo -----------------------------------------------------------------------------------


def test_purchase_bigger_than_separated_sends_the_excess_to_free_cash():
    slices, free = fifo_consume(open_reservations(TRES_MESES, [], OCT), 15000, OCT)
    assert slices == [(1, 4000), (2, 4000), (3, 4000)]
    assert free == 3000


def test_purchase_with_nothing_separated_is_all_free_cash():
    assert fifo_consume([], 5000, OCT) == ([], 5000)


def test_oldest_reservation_goes_first_regardless_of_input_order():
    items = [
        OpenReservation(2, ACOES, AUG, 4000),
        OpenReservation(1, ACOES, JUL, 4000),
    ]
    assert fifo_consume(items, 5000, OCT)[0] == [(1, 4000), (2, 1000)]


def test_reservation_dated_after_the_purchase_is_not_used():
    items = [OpenReservation(1, ACOES, JUL, 1000), OpenReservation(2, ACOES, OCT, 9000)]
    slices, free = fifo_consume(items, 5000, AUG)
    assert slices == [(1, 1000)]
    assert free == 4000


def test_reservation_of_the_same_day_is_used():
    assert fifo_consume([OpenReservation(1, ACOES, OCT, 3000)], 3000, OCT) == ([(1, 3000)], 0)


def test_same_date_ties_are_broken_by_id():
    items = [OpenReservation(7, ACOES, JUL, 1000), OpenReservation(3, ACOES, JUL, 1000)]
    assert fifo_consume(items, 1500, OCT)[0] == [(3, 1000), (7, 500)]
    assert fifo_consume(list(reversed(items)), 1500, OCT)[0] == [(3, 1000), (7, 500)]


def test_partially_used_reservation_is_consumed_by_what_is_left():
    uses = [use(1, AUG, 3000)]
    slices, free = fifo_consume(open_reservations(TRES_MESES, uses, OCT), 2000, OCT)
    assert slices == [(1, 1000), (2, 1000)]
    assert free == 0


@pytest.mark.parametrize("amount", [0, -1, -5000])
def test_consuming_zero_or_negative_is_refused(amount):
    with pytest.raises(ValueError, match="maior que zero"):
        fifo_consume([OpenReservation(1, ACOES, JUL, 1000)], amount, OCT)


# ---- separado em aberto ------------------------------------------------------------------------


def test_outstanding_is_per_class_and_ignores_the_future():
    reservations = [res(1, JUL, 4000), res(2, AUG, 2500, FIIS), res(3, OCT, 9000)]
    assert outstanding(reservations, [], AUG) == {ACOES: 4000, FIIS: 2500}
    assert outstanding(reservations, [], date(2026, 6, 30)) == {}


def test_outstanding_ignores_uses_after_the_date():
    uses = [use(1, OCT, 1000)]
    assert outstanding(TRES_MESES, uses, SEP) == {ACOES: 12000}
    assert outstanding(TRES_MESES, uses, OCT) == {ACOES: 11000}


def test_class_fully_used_does_not_appear():
    uses = [use(1, AUG, 4000)]
    assert outstanding([res(1, JUL, 4000)], uses, OCT) == {}


def test_release_lowers_outstanding_without_rewriting_the_origin_month():
    reservations = [res(1, JUL, 4000)]
    release = [use(1, SEP, 1500, kind="liberacao")]
    # Em agosto (antes da liberação) o separado continua inteiro: o passado não muda.
    assert outstanding(reservations, release, AUG) == {ACOES: 4000}
    assert outstanding(reservations, release, SEP) == {ACOES: 2500}
    # A separação em si segue com o valor original.
    assert reservations[0].amount_cents == 4000


def test_purchase_and_release_both_reduce_the_same_reservation():
    uses = [use(1, AUG, 1000), use(1, SEP, 500, kind="liberacao")]
    assert outstanding([res(1, JUL, 4000)], uses, OCT) == {ACOES: 2500}


# ---- soma dos usos <= valor da separação -------------------------------------------------------


def test_uses_within_the_amount_are_accepted():
    uses = [use(1, AUG, 3000), use(1, SEP, 1000, kind="liberacao")]
    assert overused_reservations([res(1, JUL, 4000)], uses) == []


def test_uses_above_the_amount_flag_the_reservation():
    reservations = [res(1, JUL, 4000), res(2, AUG, 4000)]
    uses = [use(1, AUG, 3000), use(1, SEP, 1001), use(2, SEP, 4000)]
    assert overused_reservations(reservations, uses) == [1]


# ---- invariante: separado em aberto <= caixa da conta ------------------------------------------


def test_invariant_holds_when_cash_covers_what_is_separated():
    entries = [(JUL, 10000)]
    assert worst_free_shortfall(entries, TRES_MESES[:2], [], JUL) == 0


def test_withdrawal_that_breaks_the_invariant_returns_the_exact_shortfall():
    # Caixa de 100, separado 80 (duas separações); retirar 50 deixa 50 de caixa para 80 separados.
    reservations = [res(1, JUL, 4000), res(2, AUG, 4000)]
    entries = [(JUL, 10000)]
    assert worst_free_shortfall(entries, reservations, [], SEP) == 0
    assert worst_free_shortfall(entries + [(SEP, -5000)], reservations, [], SEP) == 3000


def test_worst_day_is_reported_when_several_days_break():
    reservations = [res(1, JUL, 6000)]
    entries = [(JUL, 6000), (AUG, -2000), (SEP, -1000)]
    # Ago: caixa 4000 para 6000 (falta 2000); set: caixa 3000 para 6000 (falta 3000).
    assert worst_free_shortfall(entries, reservations, [], JUL) == 3000


def test_purchase_use_frees_the_invariant_on_the_day_it_happens():
    reservations = [res(1, JUL, 6000)]
    # A compra tira 6000 do caixa e 6000 do separado no mesmo dia: nada falta.
    entries = [(JUL, 6000), (AUG, -6000)]
    assert worst_free_shortfall(entries, reservations, [use(1, AUG, 6000)], JUL) == 0
    # Sem o uso, a mesma saída do caixa deixaria o separado sem lastro.
    assert worst_free_shortfall(entries, reservations, [], JUL) == 6000


def test_days_before_from_date_are_not_checked():
    reservations = [res(1, JUL, 6000)]
    entries = [(JUL, 2000), (AUG, 5000)]  # em julho falta 4000, mas o passado já estava assim
    assert worst_free_shortfall(entries, reservations, [], AUG) == 0


def test_state_inherited_from_before_from_date_is_checked_on_from_date():
    reservations = [res(1, JUL, 6000)]
    assert worst_free_shortfall([(JUL, 2000)], reservations, [], AUG) == 4000


def test_release_restores_the_invariant():
    reservations = [res(1, JUL, 6000)]
    entries = [(JUL, 6000), (AUG, -3000)]
    assert worst_free_shortfall(entries, reservations, [], AUG) == 3000
    release = [use(1, AUG, 3000, kind="liberacao")]
    assert worst_free_shortfall(entries, reservations, release, AUG) == 0


# ---- entradas inválidas ------------------------------------------------------------------------


@pytest.mark.parametrize("cents", [0, -100])
def test_reservation_with_zero_or_negative_amount_is_refused(cents):
    with pytest.raises(ValueError, match="maior que zero"):
        res(1, JUL, cents)


@pytest.mark.parametrize("cents", [0, -100])
def test_use_with_zero_or_negative_amount_is_refused(cents):
    with pytest.raises(ValueError, match="maior que zero"):
        use(1, JUL, cents)


def test_use_with_unknown_kind_is_refused():
    with pytest.raises(ValueError, match="desconhecido"):
        use(1, JUL, 100, kind="venda")


# ---- separado por mês --------------------------------------------------------------------------


def test_separated_by_month_groups_by_month_of_the_date_and_by_class():
    rows = [
        res(1, date(2026, 7, 1), 4000),
        res(2, date(2026, 7, 31), 1500),
        res(3, date(2026, 7, 15), 700, FIIS),
        res(4, date(2026, 8, 1), 4000),
    ]

    assert separated_by_month(rows) == {
        "2026-07": {ACOES: 5500, FIIS: 700},
        "2026-08": {ACOES: 4000},
    }


def test_separated_by_month_without_reservations_is_empty():
    assert separated_by_month([]) == {}


# ---- fluxos do separado num período ------------------------------------------------------------


def test_reserve_flows_split_separations_purchases_and_releases_by_the_window():
    rows = [res(1, JUL, 4000), res(2, AUG, 4000)]
    uses = [use(1, AUG, 1000), use(1, SEP, 500, "liberacao"), use(2, SEP, 2500)]

    flows = reserve_flows(rows, uses, JUL, SEP)

    # A separação de julho já estava no começo da janela (a borda inicial fica de fora).
    assert flows.separated_by_month == {"2026-08": 4000}
    assert flows.purchased_by_month == {"2026-08": 1000, "2026-09": 2500}
    assert flows.released_cents == 500


def test_reserve_flows_explain_the_change_in_the_outstanding_amount():
    rows = [res(1, JUL, 4000), res(2, AUG, 4000), res(3, SEP, 1000, FIIS)]
    uses = [use(1, AUG, 1000), use(1, SEP, 500, "liberacao"), use(2, OCT, 2500)]

    flows = reserve_flows(rows, uses, JUL, OCT)

    before = sum(outstanding(rows, uses, JUL).values())
    after = sum(outstanding(rows, uses, OCT).values())
    assert after - before == (
        sum(flows.separated_by_month.values())
        - sum(flows.purchased_by_month.values())
        - flows.released_cents
    )


def test_reserve_flows_without_movement_in_the_window_is_empty():
    flows = reserve_flows([res(1, JUL, 4000)], [use(1, AUG, 100)], AUG, OCT)

    assert (flows.separated_by_month, flows.purchased_by_month, flows.released_cents) == ({}, {}, 0)
