"""% do CDI equivalente bruto (renda fixa isenta ou com saldo líquido) e CDI líquido de IR."""

from decimal import Decimal

import pytest

from app.features.analytics.cdi_equivalent import (
    DEFAULT_IR_RATE_BPS,
    IR_RATES_BPS,
    IR_RATES_SOURCE,
    net_cdi_bps,
    net_pct_of_cdi,
    to_bps,
)


def bps(pct: str, ir_rate_bps: int, *, tax_exempt=False, balance_is_net=False) -> int:
    return to_bps(
        net_pct_of_cdi(
            Decimal(pct), ir_rate_bps, tax_exempt=tax_exempt, balance_is_net=balance_is_net
        )
    )


def test_the_four_rates_of_the_regressive_table_with_their_source():
    assert IR_RATES_BPS == (2250, 2000, 1750, 1500)
    assert DEFAULT_IR_RATE_BPS == 1500
    assert "Lei 11.033/2004" in IR_RATES_SOURCE and "06/11/2026" in IR_RATES_SOURCE


def test_exempt_lci_at_90_percent_equals_105_88_percent_gross_at_15():
    assert bps("0.90", 1500, tax_exempt=True) == 10_588  # 0,90 / 0,85 = 1,0588235...


def test_exempt_lci_at_90_percent_at_22_5_rounds_half_up_to_116_13():
    assert bps("0.90", 2250, tax_exempt=True) == 11_613  # 0,90 / 0,775 = 1,1612903...


def test_taxed_asset_with_net_balance_is_grossed_up():
    assert bps("0.85", 1500, balance_is_net=True) == 10_000  # caixinha a 85% = 100% bruto


def test_taxed_asset_with_gross_balance_keeps_its_percent():
    assert bps("1.02", 1500) == 10_200
    assert bps("1.02", 2250) == 10_200  # a alíquota não mexe no que já é bruto


def test_the_rounding_is_done_once_on_the_decimal_not_on_a_rounded_percent():
    # 0,9 / 0,85 = 1,058823...; arredondar o 0,9 ou a divisão antes mudaria a última casa.
    exact = net_pct_of_cdi(Decimal("0.90"), 1500, tax_exempt=True, balance_is_net=False)
    assert exact > Decimal("1.0588") and exact < Decimal("1.0589")


def test_exempt_percent_that_ends_exactly_in_half_goes_up():
    # 0,8500425 / 0,85 = 1,00005 -> 10000,5 bps -> 10001
    assert bps("0.8500425", 1500, tax_exempt=True) == 10_001


@pytest.mark.parametrize(
    ("ir", "cdi", "expected"),
    [
        (1500, 1_000, 850),  # CDI de 10% rende 8,5% depois do IR
        (2250, 1_000, 775),
        (1500, 1_234, 1_049),  # 1048,9 sobe
        (1750, 5, 4),  # 4,125 desce
        (1500, 0, 0),
    ],
)
def test_net_cdi_is_the_cdi_after_the_tax(ir, cdi, expected):
    assert net_cdi_bps(cdi, ir) == expected


def test_net_cdi_rounds_a_half_up():
    assert net_cdi_bps(10, 2500) == 8  # 7,5 sobe
