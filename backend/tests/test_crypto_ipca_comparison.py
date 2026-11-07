"""Cripto contra o dólar e carteira contra o IPCA nas rotas de desempenho. Sem rede."""

import datetime as dt

from app.core.db import get_session
from app.features.analytics.service import FX_LIMIT
from app.features.benchmarks import client as bcb
from app.features.benchmarks.models import BenchmarkIndexLevel, BenchmarkRate

API = "/api/v1"
D = dt.date


def session_of(client):
    return next(client.app.dependency_overrides[get_session]())


def add_levels(client, series: str, closes: dict[dt.date, int]):
    session = session_of(client)
    for day, close in closes.items():
        session.add(BenchmarkIndexLevel(series=series, date=day, close_e2=close))
    session.commit()


def add_ipca(client, rates: dict[str, int]):
    session = session_of(client)
    for month, ppm in rates.items():
        session.add(BenchmarkRate(series="ipca", month=month, rate_ppm=ppm))
    session.commit()


def three_balances(client, make_asset, **extra):
    """100.000 -> 102.000 -> 101.000 centavos em 31/01, 28/02 e 31/03: [0, +2%, +1%]."""
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-01-31", **extra)
    for day, current in (("2026-02-28", 102_000), ("2026-03-31", 101_000)):
        body = {"date": day, "balance_cents": current}
        assert client.post(f"{API}/assets/{asset['id']}/balance", json=body).status_code == 200
    return asset


def performance(client, **params):
    response = client.get(f"{API}/analytics/performance", params=params)
    assert response.status_code == 200, response.text
    return response.json()


USD_CLOSES = {
    D(2026, 1, 30): 50_000,  # sexta: vale para o sábado 31/01
    D(2026, 2, 27): 51_000,  # +2,00%
    D(2026, 3, 31): 49_500,  # -1,00% sobre a base
}


# ---- carteira x IPCA ---------------------------------------------------------------------


def test_performance_compares_with_the_ipca_pro_rata_and_stops_at_the_last_published_month(
    client, make_asset
):
    three_balances(client, make_asset)
    add_ipca(client, {"2026-02": 5_000})  # fevereiro 0,50%; março ainda não saiu

    body = performance(client)

    assert [p["portfolio_bps"] for p in body["points"]] == [0, 200, 100]
    assert [p["ipca_bps"] for p in body["points"]] == [0, 50, None]
    summary = body["summary"]
    # O resumo compara no último ponto que o IPCA cobre (28/02), e diz qual é.
    assert (summary["ipca_bps"], summary["ipca_date"]) == (50, "2026-02-28")
    assert summary["vs_ipca_bps"] == 200 - 50
    assert summary["end_date"] == "2026-03-31" and summary["portfolio_bps"] == 100
    assert body["ipca_covered_through"] == "2026-02"
    assert "IBGE" in body["ipca_source"]
    assert any("IPCA" in w and "02/2026" in w for w in body["warnings"])


def test_performance_with_every_month_published_compounds_them_and_has_no_ipca_warning(
    client, make_asset
):
    three_balances(client, make_asset)
    add_ipca(client, {"2026-02": 5_000, "2026-03": 3_000})

    body = performance(client)

    # 31/01 -> 31/03: fevereiro e março inteiros, 1,005 x 1,003 = 0,8015% -> 80 bps.
    assert [p["ipca_bps"] for p in body["points"]] == [0, 50, 80]
    assert body["summary"]["ipca_bps"] == 80 and body["summary"]["ipca_date"] == "2026-03-31"
    assert body["summary"]["vs_ipca_bps"] == 100 - 80
    assert not any("IPCA" in w for w in body["warnings"])


def test_performance_mid_month_dates_take_only_the_pro_rata_slice(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-03-31")
    body = {"date": "2026-04-15", "balance_cents": 101_000}
    assert client.post(f"{API}/assets/{asset['id']}/balance", json=body).status_code == 200
    add_ipca(client, {"2026-04": 5_000})

    points = performance(client)["points"]

    assert [p["ipca_bps"] for p in points] == [0, 25]  # (1,005)^(15/30) - 1


def test_performance_with_a_negative_ipca_month(client, make_asset):
    three_balances(client, make_asset)
    add_ipca(client, {"2026-02": -50_000 // 10, "2026-03": 3_000})  # -0,50% e +0,30%

    points = performance(client)["points"]

    assert [p["ipca_bps"] for p in points] == [0, -50, -20]  # 0,995 x 1,003 = -0,1985%


def test_performance_without_any_ipca_keeps_the_rest_and_warns(client, make_asset):
    three_balances(client, make_asset)

    body = performance(client)

    assert [p["portfolio_bps"] for p in body["points"]] == [0, 200, 100]
    assert all(p["ipca_bps"] is None for p in body["points"])
    summary = body["summary"]
    assert (summary["ipca_bps"], summary["ipca_date"], summary["vs_ipca_bps"]) == (None,) * 3
    assert body["ipca_covered_through"] is None and body["ipca_source"] is None
    assert any("IPCA" in w and "Atualize" in w for w in body["warnings"])


def test_ipca_is_present_in_every_scope(client, make_asset):
    three_balances(client, make_asset, class_key="cripto")
    add_ipca(client, {"2026-02": 5_000, "2026-03": 3_000})

    for scope in ("total", "cripto", "renda_fixa"):
        body = performance(client, scope=scope)
        if scope == "renda_fixa":
            assert body["points"] == []  # nenhum ativo na categoria: nada a comparar
        else:
            assert [p["ipca_bps"] for p in body["points"]] == [0, 50, 80], scope


def test_ipca_is_not_compared_when_there_is_a_single_date(client, make_asset):
    make_asset(invested=100_000, current=100_000, valuation_date="2026-01-31")
    body = performance(client)
    assert len(body["points"]) == 1
    assert any("duas datas" in w for w in body["warnings"])
    assert not any("IPCA" in w for w in body["warnings"])


# ---- carteira x dólar (só cripto) ---------------------------------------------------------


def test_crypto_scope_compares_with_the_dollar(client, make_asset):
    three_balances(client, make_asset, class_key="cripto")
    add_levels(client, "usd", USD_CLOSES)

    body = performance(client, scope="cripto")

    assert [p["portfolio_bps"] for p in body["points"]] == [0, 200, 100]
    assert [p["usd_bps"] for p in body["points"]] == [0, 200, -100]
    summary = body["summary"]
    assert (summary["usd_bps"], summary["vs_usd_bps"]) == (-100, 100 - (-100))
    assert body["usd_covered_through"] == "2026-03-31"
    assert "PTAX" in body["usd_source"]
    assert not any("dólar" in w.lower() for w in body["warnings"])
    assert "49500" not in str(body)  # nenhuma cotação crua sai pela API


def test_the_dollar_is_only_returned_for_the_crypto_scope(client, make_asset):
    three_balances(client, make_asset, class_key="cripto")
    add_levels(client, "usd", USD_CLOSES)

    for params in ({"scope": "total"}, {"scope": "total", "include_reserve": True}):
        body = performance(client, **params)
        assert all(p["usd_bps"] is None for p in body["points"])
        assert body["summary"]["usd_bps"] is None and body["summary"]["vs_usd_bps"] is None
        assert body["usd_covered_through"] is None and body["usd_source"] is None
        assert not any("dólar" in w.lower() for w in body["warnings"])


def test_a_group_of_categories_does_not_get_the_dollar(client, make_asset):
    three_balances(client, make_asset, class_key="cripto")
    add_levels(client, "usd", USD_CLOSES)
    group = client.post(f"{API}/asset-groups", json={"name": "Moedas"}).json()
    classes = client.get(f"{API}/asset-classes").json()
    crypto = next(c for c in classes if c["key"] == "cripto")
    update = {"name": crypto["name"], "color": crypto["color"], "group_id": group["id"]}
    assert client.put(f"{API}/asset-classes/{crypto['id']}", json=update).status_code == 200

    body = performance(client, scope=f"group:{group['id']}")

    assert body["points"] and all(p["usd_bps"] is None for p in body["points"])
    assert body["usd_source"] is None


def test_crypto_keeps_the_ibovespa_fields_next_to_the_dollar(client, make_asset):
    three_balances(client, make_asset, class_key="cripto")
    add_levels(client, "usd", USD_CLOSES)
    add_levels(
        client,
        "ibovespa",
        {D(2026, 1, 30): 12_000_000, D(2026, 2, 27): 12_600_000, D(2026, 3, 31): 12_000_000},
    )

    body = performance(client, scope="cripto")

    assert [p["ibovespa_bps"] for p in body["points"]] == [0, 500, 0]
    assert [p["usd_bps"] for p in body["points"]] == [0, 200, -100]


def test_dollar_and_ibovespa_series_are_not_mixed_up(client, make_asset):
    three_balances(client, make_asset, class_key="cripto")
    add_levels(client, "usd", USD_CLOSES)  # só o dólar guardado

    body = performance(client, scope="cripto")

    assert all(p["ibovespa_bps"] is None for p in body["points"])
    assert any("Ibovespa" in w for w in body["warnings"])
    assert body["ibovespa_covered_through"] is None

    other = performance(client, scope="total")
    assert all(p["ibovespa_bps"] is None for p in other["points"])


def test_crypto_scope_without_any_dollar_warns_and_keeps_the_rest(client, make_asset):
    three_balances(client, make_asset, class_key="cripto")

    body = performance(client, scope="cripto")

    assert [p["portfolio_bps"] for p in body["points"]] == [0, 200, 100]
    assert all(p["usd_bps"] is None for p in body["points"])
    assert body["summary"]["usd_bps"] is None and body["summary"]["vs_usd_bps"] is None
    assert body["usd_source"] is None and body["usd_covered_through"] is None
    assert any("dólar" in w.lower() and "Atualize" in w for w in body["warnings"])


def test_a_stale_dollar_leaves_the_late_points_empty_and_warns_with_the_date(client, make_asset):
    three_balances(client, make_asset, class_key="cripto")
    add_levels(
        client, "usd", {D(2026, 1, 30): 50_000, D(2026, 2, 27): 51_000, D(2026, 3, 10): 52_000}
    )

    body = performance(client, scope="cripto")

    # 31/03 está 21 dias depois da última cotação: sem interpolar nem arrastar dado velho.
    assert [p["usd_bps"] for p in body["points"]] == [0, 200, None]
    assert body["summary"]["usd_bps"] is None and body["summary"]["vs_usd_bps"] is None
    assert body["usd_covered_through"] == "2026-03-10"
    assert any("dólar" in w.lower() and "10/03/2026" in w for w in body["warnings"])


def test_the_dollar_uses_the_last_quote_within_five_days(client, make_asset):
    three_balances(client, make_asset, class_key="cripto")
    add_levels(
        client,
        "usd",
        {
            D(2026, 1, 30): 50_000,
            D(2026, 2, 25): 51_000,  # 3 dias antes de 28/02: vale (fim de semana + feriado)
            D(2026, 3, 25): 49_500,  # 6 dias antes de 31/03: velho demais
        },
    )

    body = performance(client, scope="cripto")

    assert [p["usd_bps"] for p in body["points"]] == [0, 200, None]


def test_the_method_text_states_the_exchange_limit_and_the_ipca_rule(client, make_asset):
    three_balances(client, make_asset)
    method = performance(client)["method"]
    assert FX_LIMIT in method
    assert "Sem a cotação em dólar de cada moeda" in method
    assert "IPCA" in method and "proporcional" in method
    assert "ponto a ponto" in method and "reinvestidos" in method  # o texto antigo continua


# ---- ativo x dólar --------------------------------------------------------------------------


def seed_market(client, monkeypatch, usd: dict[dt.date, int]):
    days = [D(2025, 9, 1) + dt.timedelta(days=i) for i in range(70)]
    rows = [(d, 437_390) for d in days if d.weekday() < 5]
    monkeypatch.setattr(bcb, "fetch_series", lambda series, s, e: [("2025-10", 10_000)])
    monkeypatch.setattr(bcb, "fetch_daily_cdi", lambda s, e: rows)
    monkeypatch.setattr(bcb, "fetch_ibovespa", lambda s, e: [])
    monkeypatch.setattr(bcb, "fetch_daily_usd", lambda s, e: sorted(usd.items()))
    assert client.post(f"{API}/benchmarks/refresh").status_code == 200


def priced_asset(client, make_asset, class_key, extra=None):
    asset = make_asset(
        name="Ativo",
        class_key=class_key,
        invested=100_000_00,
        current=100_000_00,
        valuation_date="2025-09-30",
        **(extra or {}),
    )
    body = {"date": "2025-10-30", "balance_cents": 102_000_00}
    assert client.post(f"{API}/assets/{asset['id']}/balance", json=body).status_code == 200
    return asset


def vs_cdi(client, asset):
    response = client.get(f"{API}/analytics/assets/{asset['id']}/vs-cdi")
    assert response.status_code == 200, response.text
    return response.json()


def test_crypto_asset_is_compared_with_the_dollar_point_to_point(client, make_asset, monkeypatch):
    seed_market(client, monkeypatch, {D(2025, 9, 30): 50_000, D(2025, 10, 30): 51_500})
    asset = priced_asset(client, make_asset, "cripto")

    body = vs_cdi(client, asset)

    assert body["usd_bps"] == 300  # 5,0000 -> 5,1500
    assert body["return_bps"] == 200
    assert body["vs_usd_bps"] == 200 - 300
    assert body["usd_covered_through"] == "2025-10-30"
    assert not any("dólar" in w.lower() for w in body["warnings"])
    assert FX_LIMIT in body["method"]


def test_crypto_asset_on_weekends_uses_the_previous_quote(client, make_asset, monkeypatch):
    seed_market(
        client,
        monkeypatch,
        {
            D(2025, 9, 26): 50_000,  # sexta, vale para domingo 28/09
            D(2025, 9, 29): 99_000,  # segunda: não pode ser usada
            D(2025, 10, 31): 55_000,  # sexta, vale para sábado 01/11
            D(2025, 11, 3): 99_000,
        },
    )
    asset = make_asset(
        class_key="cripto", invested=100_000_00, current=100_000_00, valuation_date="2025-09-28"
    )
    body = {"date": "2025-11-01", "balance_cents": 120_000_00}
    assert client.post(f"{API}/assets/{asset['id']}/balance", json=body).status_code == 200

    result = vs_cdi(client, asset)

    assert result["usd_bps"] == 1_000
    assert result["usd_covered_through"] == "2025-10-31"


def test_only_crypto_assets_carry_the_dollar_fields(client, make_asset, monkeypatch):
    seed_market(client, monkeypatch, {D(2025, 9, 30): 50_000, D(2025, 10, 30): 51_500})
    variable = priced_asset(
        client, make_asset, "renda_variavel", {"asset_type": "fii", "fii_segment": "papel"}
    )
    fixed = priced_asset(client, make_asset, "renda_fixa", {"indexer": "CDI", "rate_bps": 10_000})

    for asset in (variable, fixed):
        body = vs_cdi(client, asset)
        assert body["usd_bps"] is None and body["vs_usd_bps"] is None
        assert body["usd_covered_through"] is None
        assert not any("dólar" in w.lower() for w in body["warnings"])


def test_crypto_asset_still_gets_the_ibovespa_fields(client, make_asset, monkeypatch):
    seed_market(client, monkeypatch, {D(2025, 9, 30): 50_000, D(2025, 10, 30): 51_500})
    monkeypatch.setattr(
        bcb,
        "fetch_ibovespa",
        lambda s, e: [(D(2025, 9, 30), 12_000_000), (D(2025, 10, 30), 12_600_000)],
    )
    assert client.post(f"{API}/benchmarks/refresh").status_code == 200
    asset = priced_asset(client, make_asset, "cripto")

    body = vs_cdi(client, asset)

    assert body["ibovespa_bps"] == 500 and body["usd_bps"] == 300


def test_crypto_asset_period_starting_before_the_first_quote_warns(client, make_asset, monkeypatch):
    seed_market(client, monkeypatch, {D(2025, 10, 10): 50_000, D(2025, 10, 30): 51_500})
    asset = priced_asset(client, make_asset, "cripto")

    body = vs_cdi(client, asset)

    assert body["usd_bps"] is None and body["vs_usd_bps"] is None
    assert body["return_bps"] is not None  # o resto da comparação continua
    assert any("dólar" in w.lower() and "começo" in w for w in body["warnings"])


def test_crypto_asset_period_ending_after_the_last_quote_warns_with_the_date(
    client, make_asset, monkeypatch
):
    seed_market(client, monkeypatch, {D(2025, 9, 30): 50_000, D(2025, 10, 20): 51_500})
    asset = priced_asset(client, make_asset, "cripto")

    body = vs_cdi(client, asset)

    assert body["usd_bps"] is None and body["vs_usd_bps"] is None
    assert body["usd_covered_through"] == "2025-10-20"
    assert any("dólar" in w.lower() and "20/10/2025" in w for w in body["warnings"])


def test_crypto_asset_without_any_dollar_keeps_the_screens_working(client, make_asset, monkeypatch):
    seed_market(client, monkeypatch, {})
    asset = priced_asset(client, make_asset, "cripto")

    single = vs_cdi(client, asset)
    listing = client.get(f"{API}/analytics/assets-vs-cdi").json()

    assert single["return_bps"] is not None and single["cdi_bps"] is not None
    for item in (single, listing[0]):
        assert item["usd_bps"] is None and item["vs_usd_bps"] is None
        assert item["usd_covered_through"] is None
    assert any("dólar" in w.lower() for w in single["warnings"])


def test_the_asset_listing_carries_the_dollar_per_crypto_asset(client, make_asset, monkeypatch):
    seed_market(client, monkeypatch, {D(2025, 9, 30): 50_000, D(2025, 10, 30): 51_500})
    crypto = priced_asset(client, make_asset, "cripto")
    other = priced_asset(
        client, make_asset, "renda_variavel", {"asset_type": "fii", "fii_segment": "papel"}
    )

    by_id = {item["asset_id"]: item for item in client.get(f"{API}/analytics/assets-vs-cdi").json()}

    assert by_id[crypto["id"]]["usd_bps"] == 300
    assert by_id[other["id"]]["usd_bps"] is None


def test_a_crypto_asset_with_a_single_balance_has_no_dollar(client, make_asset):
    asset = make_asset(class_key="cripto")
    body = vs_cdi(client, asset)
    assert body["usd_bps"] is None and body["vs_usd_bps"] is None
    assert body["usd_covered_through"] is None


def test_the_summary_does_not_compare_when_the_ipca_only_covers_the_base_date(client, make_asset):
    three_balances(client, make_asset)
    add_ipca(client, {"2026-01": 4_000})  # só janeiro: nenhum mês depois da data-base (31/01)

    body = performance(client)

    assert [p["ipca_bps"] for p in body["points"]] == [0, None, None]
    summary = body["summary"]
    assert (summary["ipca_bps"], summary["ipca_date"], summary["vs_ipca_bps"]) == (None,) * 3
    assert any("IPCA" in w and "01/2026" in w for w in body["warnings"])
