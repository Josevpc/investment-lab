"""Renda fixa isenta de IR (LCI, LCA...): cadastro, regras e o % do CDI equivalente bruto."""

import datetime as dt
from decimal import Decimal

import pytest
from test_cdi_equivalent import business_days, cents, seed_cdi
from test_portfolio_api import edit

from app.features.analytics.cdi_equivalent import Flow, simulate, to_bps

API = "/api/v1"
ONLY_FIXED_INCOME = "Só ativos de renda fixa podem ser isentos de IR."
EXEMPT_HAS_NO_NET_BALANCE = (
    "Ativo isento não tem saldo líquido de IR: o saldo já é o que você recebe."
)
INVALID_RATE = "Alíquota inválida: use 22,5%, 20%, 17,5% ou 15%."


def put_without(client, asset, omitted: tuple[str, ...], **changes):
    """PUT com os campos do ativo, sem os de `omitted` (campo omitido = manter o atual)."""
    body = {
        "name": asset["name"],
        "class_key": asset["class_key"],
        "institution_id": asset["institution_id"],
        "purpose": asset["purpose"],
    } | changes
    for key in ("hold_only", "balance_is_net", "tax_exempt"):
        if key in asset and key not in omitted and key not in changes:
            body[key] = asset[key]
    return client.put(f"{API}/assets/{asset['id']}", json=body)


# ---- cadastro e edição ---------------------------------------------------------------------


def test_asset_is_taxed_unless_marked_exempt(client, make_asset):
    taxed = make_asset(name="CDB")
    exempt = make_asset(name="LCI", tax_exempt=True)

    assert taxed["tax_exempt"] is False
    assert exempt["tax_exempt"] is True
    listed = {a["name"]: a["tax_exempt"] for a in client.get(f"{API}/assets").json()}
    assert listed == {"CDB": False, "LCI": True}
    assert client.get(f"{API}/assets/{exempt['id']}").json()["tax_exempt"] is True


def test_exempt_mark_can_be_turned_on_and_off(client, make_asset):
    asset = make_asset()

    on = put_without(client, asset, (), tax_exempt=True)
    assert on.status_code == 200, on.text
    assert on.json()["tax_exempt"] is True
    off = put_without(client, on.json(), (), tax_exempt=False)
    assert off.json()["tax_exempt"] is False


def test_put_without_the_field_keeps_the_exempt_mark(client, make_asset):
    exempt = make_asset(name="LCI", tax_exempt=True)
    taxed = make_asset(name="CDB")

    renamed = put_without(client, exempt, ("tax_exempt",), name="LCI 2").json()
    assert (renamed["name"], renamed["tax_exempt"]) == ("LCI 2", True)
    assert put_without(client, taxed, ("tax_exempt",), name="CDB 2").json()["tax_exempt"] is False
    assert client.get(f"{API}/assets/{exempt['id']}").json()["tax_exempt"] is True


def test_only_fixed_income_can_be_exempt_on_create(client, institution):
    response = client.post(
        f"{API}/assets",
        json={
            "name": "Ação",
            "class_key": "acoes_etfs",
            "institution_id": institution["id"],
            "asset_type": "acao",
            "current_cents": 1_000,
            "tax_exempt": True,
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == ONLY_FIXED_INCOME
    assert client.get(f"{API}/assets").json() == []  # nada foi salvo


def test_only_fixed_income_can_be_exempt_on_update(client, make_asset):
    fii = make_asset(name="FII", class_key="renda_variavel", asset_type="fii", fii_segment="papel")

    response = put_without(client, fii, (), asset_type="fii", fii_segment="papel", tax_exempt=True)

    assert response.status_code == 422
    assert response.json()["detail"] == ONLY_FIXED_INCOME
    assert client.get(f"{API}/assets/{fii['id']}").json()["tax_exempt"] is False


def test_exempt_asset_cannot_have_a_net_balance_on_create(client, institution):
    response = client.post(
        f"{API}/assets",
        json={
            "name": "LCI",
            "class_key": "renda_fixa",
            "institution_id": institution["id"],
            "current_cents": 1_000,
            "tax_exempt": True,
            "balance_is_net": True,
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == EXEMPT_HAS_NO_NET_BALANCE


def test_exempt_asset_cannot_be_marked_net_balance_later(client, make_asset):
    exempt = make_asset(name="LCI", tax_exempt=True)

    response = put_without(client, exempt, (), balance_is_net=True)

    assert response.status_code == 422
    assert response.json()["detail"] == EXEMPT_HAS_NO_NET_BALANCE
    assert client.get(f"{API}/assets/{exempt['id']}").json()["balance_is_net"] is False


def test_net_balance_asset_cannot_be_marked_exempt_later(client, make_asset):
    caixinha = make_asset(name="Caixinha", balance_is_net=True)

    response = put_without(client, caixinha, ("balance_is_net",), tax_exempt=True)

    assert response.status_code == 422
    assert response.json()["detail"] == EXEMPT_HAS_NO_NET_BALANCE
    assert client.get(f"{API}/assets/{caixinha['id']}").json()["tax_exempt"] is False


def test_switching_from_net_balance_to_exempt_in_one_edit_is_fine(client, make_asset):
    caixinha = make_asset(name="Caixinha", balance_is_net=True)

    response = put_without(client, caixinha, (), tax_exempt=True, balance_is_net=False)

    assert response.status_code == 200, response.text
    assert (response.json()["tax_exempt"], response.json()["balance_is_net"]) == (True, False)


def test_leaving_fixed_income_clears_both_marks_when_omitted(client, make_asset):
    exempt = make_asset(name="LCI", tax_exempt=True)
    net = make_asset(name="Caixinha", balance_is_net=True)
    stock = {"class_key": "acoes_etfs", "asset_type": "acao"}

    moved_exempt = put_without(client, exempt, ("tax_exempt", "balance_is_net"), **stock).json()
    moved_net = put_without(client, net, ("tax_exempt", "balance_is_net"), **stock).json()

    assert (moved_exempt["class_key"], moved_exempt["tax_exempt"]) == ("acoes_etfs", False)
    assert (moved_net["class_key"], moved_net["balance_is_net"]) == ("acoes_etfs", False)
    assert moved_net["tax_exempt"] is False


def test_staying_in_fixed_income_keeps_the_marks_when_omitted(client, make_asset):
    exempt = make_asset(name="LCI", tax_exempt=True)
    net = make_asset(name="Caixinha", balance_is_net=True)

    kept_exempt = put_without(client, exempt, ("tax_exempt", "balance_is_net"), name="LCI 2").json()
    kept_net = put_without(client, net, ("tax_exempt", "balance_is_net"), name="Cx 2").json()

    assert kept_exempt["tax_exempt"] is True and kept_exempt["balance_is_net"] is False
    assert kept_net["balance_is_net"] is True and kept_net["tax_exempt"] is False


def test_leaving_fixed_income_with_exempt_mark_sent_is_refused(client, make_asset):
    exempt = make_asset(name="LCI", tax_exempt=True)

    response = edit(client, exempt, class_key="acoes_etfs", asset_type="acao", tax_exempt=True)

    assert response.status_code == 422
    assert response.json()["detail"] == ONLY_FIXED_INCOME
    assert client.get(f"{API}/assets/{exempt['id']}").json()["class_key"] == "renda_fixa"


def test_exempt_mark_changes_no_balance_or_contribution(client, make_asset):
    asset = make_asset(name="LCI", invested=100_000, current=110_000)
    before = client.get(f"{API}/assets/{asset['id']}/valuations").json()

    put_without(client, asset, (), tax_exempt=True)

    assert client.get(f"{API}/assets/{asset['id']}/valuations").json() == before
    body = client.get(f"{API}/assets/{asset['id']}").json()
    assert (body["invested_cents"], body["current_cents"]) == (100_000, 110_000)


# ---- desempenho contra o CDI ---------------------------------------------------------------


def rate_of(client, monkeypatch) -> Decimal:
    return seed_cdi(client, monkeypatch, dt.date(2026, 9, 1), dt.date(2026, 10, 30))


def balance_at(rate: Decimal, k: str) -> int:
    days = [(d, rate) for d in business_days(dt.date(2026, 9, 30), dt.date(2026, 10, 30))]
    return cents(simulate(100_000_00, [], days, Decimal(k)))


def asset_at(client, make_asset, rate, k, **extra):
    asset = make_asset(
        invested=100_000_00, current=100_000_00, valuation_date="2026-09-30", **extra
    )
    client.post(
        f"{API}/assets/{asset['id']}/balance",
        json={"date": "2026-10-30", "balance_cents": balance_at(rate, k)},
    )
    return asset


def vs_cdi(client, asset, **params):
    return client.get(f"{API}/analytics/assets/{asset['id']}/vs-cdi", params=params)


def test_exempt_lci_reports_the_gross_equivalent_percent(client, make_asset, monkeypatch):
    rate = rate_of(client, monkeypatch)
    lci = asset_at(client, make_asset, rate, "0.90", name="LCI 90%", tax_exempt=True)

    body = vs_cdi(client, lci).json()

    assert body["tax_exempt"] is True and body["balance_is_net"] is False
    assert body["ir_rate_bps"] == 1500  # padrão: a alíquota mais comum
    assert abs(body["pct_of_cdi_bps"] - 9_000) <= 5  # o campo existente continua o que era
    assert abs(body["net_pct_of_cdi_bps"] - 10_588) <= 6
    expected = to_bps(Decimal(body["cdi_bps"]) / 10_000 * Decimal("0.85"))
    assert body["net_cdi_bps"] == expected
    assert "Lei 11.033/2004" in body["ir_rates_source"]


def test_the_chosen_rate_changes_only_the_new_fields(client, make_asset, monkeypatch):
    rate = rate_of(client, monkeypatch)
    lci = asset_at(client, make_asset, rate, "0.90", tax_exempt=True)

    default = vs_cdi(client, lci).json()
    chosen = vs_cdi(client, lci, ir_rate_bps=2250).json()

    assert chosen["ir_rate_bps"] == 2250
    assert abs(chosen["net_pct_of_cdi_bps"] - 11_613) <= 6
    assert chosen["net_cdi_bps"] < default["net_cdi_bps"]
    for field in ("pct_of_cdi_bps", "return_bps", "cdi_bps", "yield_cents", "vs_contracted_bps"):
        assert chosen[field] == default[field]


def test_net_balance_asset_is_grossed_up_by_the_rate(client, make_asset, monkeypatch):
    rate = rate_of(client, monkeypatch)
    caixinha = asset_at(client, make_asset, rate, "0.85", name="Caixinha", balance_is_net=True)

    body = vs_cdi(client, caixinha).json()

    assert body["tax_exempt"] is False and body["balance_is_net"] is True
    assert abs(body["net_pct_of_cdi_bps"] - 10_000) <= 6


def test_gross_taxed_asset_keeps_its_percent(client, make_asset, monkeypatch):
    rate = rate_of(client, monkeypatch)
    cdb = asset_at(client, make_asset, rate, "1.02", name="CDB 102%")

    body = vs_cdi(client, cdb, ir_rate_bps=2000).json()

    assert body["ir_rate_bps"] == 2000
    assert body["net_pct_of_cdi_bps"] == body["pct_of_cdi_bps"]
    assert abs(body["pct_of_cdi_bps"] - 10_200) <= 5


def test_outside_fixed_income_there_is_no_tax_rate(client, make_asset):
    fii = make_asset(name="FII", class_key="renda_variavel", asset_type="fii", fii_segment="papel")

    body = vs_cdi(client, fii, ir_rate_bps=2250).json()

    assert body["tax_exempt"] is False
    assert body["ir_rate_bps"] is None
    assert body["net_cdi_bps"] is None and body["net_pct_of_cdi_bps"] is None
    assert body["ir_rates_source"]


def test_asset_without_enough_balances_still_tells_the_rate_and_exempt_mark(client, make_asset):
    lci = make_asset(tax_exempt=True)

    body = vs_cdi(client, lci).json()

    assert body["pct_of_cdi_bps"] is None
    assert body["tax_exempt"] is True and body["ir_rate_bps"] == 1500
    assert body["net_pct_of_cdi_bps"] is None and body["net_cdi_bps"] is None
    assert body["ir_rates_source"]


@pytest.mark.parametrize("rate", [2250, 2000, 1750, 1500])
def test_the_four_table_rates_are_accepted(client, make_asset, rate):
    asset = make_asset()
    assert vs_cdi(client, asset, ir_rate_bps=rate).status_code == 200
    assert (
        client.get(f"{API}/analytics/assets-vs-cdi", params={"ir_rate_bps": rate}).status_code
        == 200
    )


@pytest.mark.parametrize("rate", [0, 1499, 1600, 2500, 10_000, -1500])
def test_any_other_rate_is_refused_in_portuguese(client, make_asset, rate):
    asset = make_asset()

    single = vs_cdi(client, asset, ir_rate_bps=rate)
    listed = client.get(f"{API}/analytics/assets-vs-cdi", params={"ir_rate_bps": rate})

    for response in (single, listed):
        assert response.status_code == 422
        assert response.json()["detail"] == INVALID_RATE


def test_a_rate_that_is_not_a_number_is_refused(client, make_asset):
    asset = make_asset()
    assert vs_cdi(client, asset, ir_rate_bps="abc").status_code == 422


def test_listing_uses_one_rate_for_every_asset(client, make_asset, monkeypatch):
    rate = rate_of(client, monkeypatch)
    asset_at(client, make_asset, rate, "0.90", name="LCI", tax_exempt=True)
    asset_at(client, make_asset, rate, "1.02", name="CDB")
    asset_at(client, make_asset, rate, "0.85", name="Caixinha", balance_is_net=True)

    rows = {
        r["asset_name"]: r
        for r in client.get(f"{API}/analytics/assets-vs-cdi", params={"ir_rate_bps": 2250}).json()
    }

    assert {r["ir_rate_bps"] for r in rows.values()} == {2250}
    assert abs(rows["LCI"]["net_pct_of_cdi_bps"] - 11_613) <= 6
    assert rows["CDB"]["net_pct_of_cdi_bps"] == rows["CDB"]["pct_of_cdi_bps"]
    assert abs(rows["Caixinha"]["net_pct_of_cdi_bps"] - 10_968) <= 8  # 0,85 / 0,775
    assert {n: r["tax_exempt"] for n, r in rows.items()} == {
        "LCI": True,
        "CDB": False,
        "Caixinha": False,
    }


def test_flow_aware_percent_is_the_one_grossed_up(client, make_asset, monkeypatch):
    # Com aporte no meio do período, o bruto equivalente parte do mesmo % medido do CDI.
    rate = rate_of(client, monkeypatch)
    days = [(d, rate) for d in business_days(dt.date(2026, 9, 30), dt.date(2026, 10, 30))]
    lci = make_asset(
        invested=100_000_00, current=100_000_00, valuation_date="2026-09-30", tax_exempt=True
    )
    aporte = Flow(dt.date(2026, 10, 15), 10_000_00)
    final = cents(simulate(100_000_00, [aporte], days, Decimal("0.90")))
    client.post(
        f"{API}/assets/{lci['id']}/balance",
        json={
            "date": "2026-10-30",
            "balance_cents": final,
            "contribution_cents": aporte.cents,
            "contribution_date": "2026-10-15",
        },
    )

    body = vs_cdi(client, lci).json()

    assert abs(body["pct_of_cdi_bps"] - 9_000) <= 10
    assert abs(body["net_pct_of_cdi_bps"] - 10_588) <= 12
