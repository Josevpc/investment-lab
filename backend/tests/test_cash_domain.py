from datetime import date
from decimal import Decimal

import pytest

from app.features.cash.domain import (
    balance_at,
    contributed_capital,
    reconciliation_difference,
    sign_error,
    worst_shortfall,
)
from app.features.portfolio.domain import purchase_amount_cents

D1, D2, D3, D4 = (date(2026, 10, day) for day in (1, 2, 3, 4))


# ---- sinal de cada tipo --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "amount"),
    [
        ("deposito", 100),
        ("provento", 1),
        ("venda", 1),
        ("compra", -100),
        ("retirada", -1),
        ("taxa", -5),
        ("ajuste", 7),
        ("ajuste", -7),
        ("saldo_inicial", 0),
        ("saldo_inicial", 800),
        ("transferencia", 100),
        ("transferencia", -100),
    ],
)
def test_valid_signs_pass(kind, amount):
    assert sign_error(kind, amount) is None


@pytest.mark.parametrize(
    ("kind", "amount"),
    [
        ("deposito", 0),
        ("deposito", -1),
        ("provento", -1),
        ("venda", 0),
        ("compra", 0),
        ("compra", 1),
        ("retirada", 100),
        ("taxa", 0),
        ("ajuste", 0),
        ("saldo_inicial", -1),
        ("transferencia", 0),
        ("desconhecido", 10),
    ],
)
def test_invalid_signs_are_refused_with_a_message(kind, amount):
    assert sign_error(kind, amount)


# ---- saldo ---------------------------------------------------------------------------------


def test_balance_counts_entries_up_to_and_including_the_date():
    rows = [(D1, 600), (D2, 200), (D3, -800)]
    assert balance_at(rows, D1) == 600
    assert balance_at(rows, D2) == 800
    assert balance_at(rows, D3) == 0
    assert balance_at(rows, date(2026, 9, 30)) == 0


def test_balance_never_negative_means_none_flagged():
    assert worst_shortfall([(D1, 600), (D2, -600)], D1) is None


def test_end_of_day_balance_ignores_order_within_the_day():
    # A compra "vem antes" do depósito na lista, mas no fim do dia o saldo é 0: vale.
    assert worst_shortfall([(D1, 600), (D2, -800), (D2, 200)], D2) is None


def test_shortfall_reports_the_worst_day_and_how_much_is_missing():
    rows = [(D1, 600), (D2, -1000), (D3, 100), (D4, -300)]
    shortfall = worst_shortfall(rows, D1)
    # D2: -400; D3: -300; D4: -600 -> o pior é D4, e um depósito de 600 em D2 conserta tudo.
    assert (shortfall.day, shortfall.cents) == (D4, 600)


def test_only_days_from_the_entry_date_on_are_checked():
    # O passado já era válido (e aqui está "ruim" de propósito): só olha de from_date em diante.
    rows = [(D1, -50), (D2, 100)]
    assert worst_shortfall(rows, D2) is None
    assert worst_shortfall(rows, D1).cents == 50


def test_future_entry_can_make_an_earlier_valid_purchase_invalid():
    rows = [(D1, 600), (D2, -600), (D4, -1)]
    assert worst_shortfall(rows, D2).day == D4


# ---- capital aportado ----------------------------------------------------------------------


def test_contributed_capital_is_deposits_minus_withdrawals_only():
    rows = [
        (D1, "saldo_inicial", 600),
        (D1, "deposito", 1000),
        (D2, "provento", 200),
        (D2, "compra", -700),
        (D2, "taxa", -10),
        (D3, "ajuste", 5),
        (D3, "venda", 50),
        (D3, "transferencia", -100),
        (D3, "retirada", -300),
    ]
    capital = contributed_capital(rows, D4)
    assert (capital.deposits_cents, capital.withdrawals_cents) == (1000, 300)
    assert capital.contributed_cents == 700


def test_contributed_capital_respects_the_period():
    rows = [(D1, "deposito", 100), (D2, "deposito", 200), (D3, "retirada", -50)]
    assert contributed_capital(rows, D2).contributed_cents == 300
    assert contributed_capital(rows, D4, start=D2).contributed_cents == 150
    assert contributed_capital([], D4).contributed_cents == 0


def test_reconciliation_difference_is_real_minus_calculated():
    assert reconciliation_difference(1_050, 1_000) == 50
    assert reconciliation_difference(950, 1_000) == -50
    assert reconciliation_difference(1_000, 1_000) == 0


# ---- compra por quantidade x preço ---------------------------------------------------------


@pytest.mark.parametrize(
    ("quantity", "price", "expected"),
    [
        ("1", 800, 800),
        ("3", 262, 786),
        ("0.5", 801, 401),  # 400,5 centavos sobe
        ("0.5", 800, 400),
        ("2.5", 1, 3),  # 2,5 sobe
        ("0.001", 1_000_000, 1_000),
        ("0.4", 1, 0),  # 0,4 desce (o schema recusa a compra de valor zero)
        ("1.23456789", 10_000_000, 12_345_679),  # fração de cripto sem perder dígitos
    ],
)
def test_purchase_amount_rounds_half_up_with_decimal(quantity, price, expected):
    assert purchase_amount_cents(Decimal(quantity), price) == expected
