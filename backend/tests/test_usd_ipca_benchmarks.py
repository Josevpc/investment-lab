"""Dólar (PTAX) e IPCA como referências: cliente do SGS, atualização e estado. Sem rede."""

import datetime as dt
import json

import pytest
from sqlalchemy import func, select

from app.core.db import get_session
from app.demo import seed_demo
from app.features.benchmarks import client as bcb
from app.features.benchmarks.models import BenchmarkIndexLevel, BenchmarkRate
from app.features.benchmarks.service import (
    HISTORY_START,
    get_status,
    index_level_on_or_before,
    index_levels,
    refresh,
    refresh_if_stale,
)

API = "/api/v1"
D = dt.date
TODAY = D(2026, 10, 5)


def session_of(client):
    return next(client.app.dependency_overrides[get_session]())


def monthly(series, start, end):
    return [("2026-01", 11_600)]


def count_levels(session, series):
    return session.scalar(
        select(func.count())
        .select_from(BenchmarkIndexLevel)
        .where(BenchmarkIndexLevel.series == series)
    )


# ---- cliente: conversão e janelas ----------------------------------------------------------


def test_usd_quote_is_converted_to_tenths_of_a_thousandth_without_floats():
    assert bcb.usd_to_e4("5.4321") == 54_321
    assert bcb.usd_to_e4("5") == 50_000
    assert bcb.usd_to_e4("5.43215") == 54_322  # meio sobe
    assert bcb.usd_to_e4("0.0001") == 1


def test_parse_usd_maps_dates_and_quotes():
    payload = [{"data": "02/01/2026", "valor": "5.4321"}, {"data": "05/01/2026", "valor": "5.40"}]
    assert bcb.parse_usd(payload) == [(D(2026, 1, 2), 54_321), (D(2026, 1, 5), 54_000)]


def test_ipca_percent_keeps_its_sign_in_ppm():
    payload = [{"data": "01/02/2026", "valor": "-0.02"}, {"data": "01/03/2026", "valor": "0.56"}]
    assert bcb.parse_series(payload) == [("2026-02", -200), ("2026-03", 5_600)]


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def test_fetch_daily_usd_asks_for_sgs_1_in_windows_below_ten_years(monkeypatch):
    urls = []

    def fake_urlopen(request, timeout):
        urls.append(request.full_url)
        return FakeResponse([{"data": "04/01/2010", "valor": "1.7412"}])

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    rows = bcb.fetch_daily_usd(D(2010, 1, 1), D(2026, 10, 5))

    assert len(urls) == 2  # 2010-2019 e 2020-2026
    assert all("bcdata.sgs.1/dados" in url for url in urls)
    assert "dataInicial=01/01/2010&dataFinal=31/12/2019" in urls[0]
    assert "dataInicial=01/01/2020&dataFinal=05/10/2026" in urls[1]
    assert rows == [(D(2010, 1, 4), 17_412)] * 2


def test_fetch_series_ipca_uses_sgs_433(monkeypatch):
    urls = []

    def fake_urlopen(request, timeout):
        urls.append(request.full_url)
        return FakeResponse([{"data": "01/09/2026", "valor": "0.48"}])

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    assert bcb.fetch_series("ipca", D(2026, 9, 1), D(2026, 10, 5)) == [("2026-09", 4_800)]
    assert "bcdata.sgs.433/dados" in urls[0]


def test_sources_cite_the_new_series():
    assert "433" in bcb.SOURCE and "1)" in bcb.SOURCE and "B3" in bcb.SOURCE
    assert "PTAX" in bcb.USD_SOURCE and "Banco Central" in bcb.USD_SOURCE
    assert "IBGE" in bcb.IPCA_SOURCE


# ---- serviço: atualização do dólar ---------------------------------------------------------


def test_refresh_saves_the_dollar_and_is_idempotent(client):
    session = session_of(client)
    rows = [(D(2026, 10, 1), 54_321), (D(2026, 10, 2), 54_000)]
    first = refresh(session, fetcher=monthly, usd_fetcher=lambda s, e: rows, today=TODAY)
    again = refresh(session, fetcher=monthly, usd_fetcher=lambda s, e: rows, today=TODAY)

    assert first.rows_saved == 3 + 2  # CDI, Selic e IPCA + duas cotações
    assert count_levels(session, "usd") == 2
    assert again.status.usd_days == 2
    assert (again.status.usd_days, again.status.usd_through) == (2, "2026-10-02")
    assert index_level_on_or_before(session, D(2026, 10, 4), "usd") == (D(2026, 10, 2), 54_000)


def test_refresh_resumes_the_day_after_the_last_stored_quote(client):
    session = session_of(client)
    calls = []

    def usd_fetcher(start, end):
        calls.append((start, end))
        return [(D(2026, 10, 1), 54_000), (D(2026, 10, 2), 54_100)]

    refresh(session, fetcher=monthly, usd_fetcher=usd_fetcher, today=D(2026, 10, 5))
    refresh(session, fetcher=monthly, usd_fetcher=usd_fetcher, today=D(2026, 10, 6))

    # A PTAX publicada não muda: recomeça no dia seguinte (diferente do Ibovespa, que recarrega o
    # último dia).
    assert calls == [(HISTORY_START, D(2026, 10, 5)), (D(2026, 10, 3), D(2026, 10, 6))]


def test_refresh_does_not_ask_for_a_future_dollar_start(client):
    session = session_of(client)
    session.add(BenchmarkIndexLevel(series="usd", date=D(2026, 10, 20), close_e2=54_000))
    session.commit()
    calls = []
    refresh(
        session,
        fetcher=monthly,
        usd_fetcher=lambda s, e: calls.append((s, e)) or [],
        today=D(2026, 10, 10),
    )
    assert calls == []


def test_dollar_rows_never_touch_the_ibovespa_rows_of_the_same_day(client):
    session = session_of(client)
    day = D(2026, 10, 2)
    refresh(
        session,
        fetcher=monthly,
        index_fetcher=lambda s, e: [(day, 13_000_000)],
        usd_fetcher=lambda s, e: [(day, 54_321)],
        today=TODAY,
    )
    # Uma segunda carga das duas séries, com valores novos, também não mistura nada.
    refresh(
        session,
        fetcher=monthly,
        index_fetcher=lambda s, e: [(day, 13_100_000)],
        usd_fetcher=lambda s, e: [(D(2026, 10, 3), 54_400)],
        today=TODAY,
    )

    assert index_level_on_or_before(session, day) == (day, 13_100_000)  # Ibovespa é o padrão
    assert index_level_on_or_before(session, D(2026, 10, 4), "usd") == (D(2026, 10, 3), 54_400)
    assert index_levels(session, day, day, "usd") == [(day, 54_321)]
    assert count_levels(session, "ibovespa") == 1 and count_levels(session, "usd") == 2


def test_the_default_index_lookup_ignores_the_dollar(client):
    session = session_of(client)
    session.add(BenchmarkIndexLevel(series="usd", date=D(2026, 10, 2), close_e2=54_321))
    session.commit()
    assert index_level_on_or_before(session, D(2026, 10, 5)) is None  # sem Ibovespa algum
    assert get_status(session).index_days == 0


def test_rows_outside_the_asked_window_are_not_saved(client):
    session = session_of(client)
    session.add(BenchmarkIndexLevel(series="usd", date=D(2026, 10, 1), close_e2=53_000))
    session.commit()
    # Pede-se de 02/10 a 05/10: uma cotação antiga e uma do futuro que vierem junto são ignoradas.
    rows = [(D(2026, 9, 1), 50_000), (D(2026, 10, 2), 54_000), (D(2027, 1, 4), 60_000)]
    refresh(session, fetcher=monthly, usd_fetcher=lambda s, e: rows, today=TODAY)
    assert [d for d, _ in index_levels(session, D(2000, 1, 1), D(2100, 1, 1), "usd")] == [
        D(2026, 10, 1),
        D(2026, 10, 2),
    ]


def test_a_dollar_failure_keeps_everything_the_other_sources_saved(client):
    session = session_of(client)

    def offline(start, end):
        raise TimeoutError("sem rede")

    result = refresh(
        session,
        fetcher=monthly,
        daily_fetcher=lambda s, e: [(D(2026, 10, 1), 437_390)],
        index_fetcher=lambda s, e: [(D(2026, 10, 1), 13_000_000)],
        usd_fetcher=offline,
        today=TODAY,
    )

    assert result.ok is True
    assert result.errors == ["Dólar: sem rede"]
    assert result.rows_saved == 3 + 1 + 1  # mensais + CDI diário + Ibovespa
    assert (result.status.daily_days, result.status.index_days, result.status.usd_days) == (1, 1, 0)
    assert {s.series: s.months for s in result.status.series} == {"cdi": 1, "selic": 1, "ipca": 1}


def test_a_failing_dollar_batch_is_all_or_nothing_and_the_next_refresh_recovers(client):
    session = session_of(client)

    def broken(start, end):
        raise ValueError("resposta inesperada do Banco Central")

    refresh(session, fetcher=monthly, usd_fetcher=broken, today=TODAY)
    assert get_status(session).usd_days == 0

    ok = refresh(
        session,
        fetcher=monthly,
        usd_fetcher=lambda s, e: [(D(2026, 10, 1), 54_000)],
        today=TODAY,
    )
    assert ok.errors == [] and ok.status.usd_days == 1


def test_an_ipca_failure_is_reported_by_name_and_does_not_lose_cdi(client):
    session = session_of(client)

    def flaky(series, start, end):
        if series == "ipca":
            raise TimeoutError("IBGE fora do ar")
        return [("2026-01", 11_600)]

    result = refresh(session, fetcher=flaky, today=TODAY)

    assert result.ok is True
    assert result.errors == ["IPCA: IBGE fora do ar"]
    assert {s.series: s.months for s in result.status.series} == {"cdi": 1, "selic": 1, "ipca": 0}


def test_with_only_a_fetcher_injected_the_dollar_is_not_fetched(client, monkeypatch):
    calls = []
    monkeypatch.setattr(bcb, "fetch_daily_usd", lambda s, e: calls.append(s) or [])
    refresh(session_of(client), fetcher=monthly, today=TODAY)
    assert calls == []


# ---- serviço: quando atualizar sozinho -----------------------------------------------------


def stub_sources(monkeypatch, *, ipca=True, usd_calls=None):
    def series(code, start, end):
        return [("2026-01", 11_600)] if code != "ipca" or ipca else []

    monkeypatch.setattr(bcb, "fetch_series", series)
    monkeypatch.setattr(bcb, "fetch_daily_cdi", lambda s, e: [(D(2026, 10, 1), 437_390)])
    monkeypatch.setattr(bcb, "fetch_ibovespa", lambda s, e: [(D(2026, 10, 1), 100)])

    def usd(start, end):
        if usd_calls is not None:
            usd_calls.append(start)
        return [(D(2026, 10, 1), 54_000)]

    monkeypatch.setattr(bcb, "fetch_daily_usd", usd)


def test_refresh_if_stale_also_fetches_when_the_dollar_is_missing(client, monkeypatch):
    session = session_of(client)
    usd_calls = []
    stub_sources(monkeypatch, usd_calls=usd_calls)

    assert refresh_if_stale(session) is not None  # banco vazio
    assert refresh_if_stale(session) is None  # tudo em dia

    session.query(BenchmarkIndexLevel).filter(BenchmarkIndexLevel.series == "usd").delete()
    session.commit()
    assert refresh_if_stale(session) is not None  # recente, mas sem dólar
    assert usd_calls == [HISTORY_START, HISTORY_START]


def test_refresh_if_stale_fetches_a_database_that_has_no_ipca_yet(client, monkeypatch):
    session = session_of(client)
    stub_sources(monkeypatch)
    refresh_if_stale(session)
    session.query(BenchmarkRate).filter(BenchmarkRate.series == "ipca").delete()
    session.commit()
    assert get_status(session).stale is False  # CDI e Selic continuam recentes

    result = refresh_if_stale(session)  # banco de antes do IPCA

    assert result is not None
    assert {s.series: s.months for s in result.status.series}["ipca"] == 1


# ---- API -------------------------------------------------------------------------------------


def test_status_endpoint_reports_dollar_and_ipca(client):
    empty = client.get(f"{API}/benchmarks/status").json()
    assert (empty["usd_days"], empty["usd_through"]) == (0, None)
    ipca = next(s for s in empty["series"] if s["series"] == "ipca")
    assert (ipca["label"], ipca["months"], ipca["covered_through"]) == ("IPCA", 0, None)

    session = session_of(client)
    refresh(
        session,
        fetcher=lambda s, a, b: [("2026-01", 4_200), ("2026-02", -200)],
        usd_fetcher=lambda s, e: [(D(2026, 10, 1), 54_000), (D(2026, 10, 2), 54_100)],
        today=TODAY,
    )
    body = client.get(f"{API}/benchmarks/status").json()
    assert (body["usd_days"], body["usd_through"]) == (2, "2026-10-02")
    ipca = next(s for s in body["series"] if s["series"] == "ipca")
    assert (ipca["months"], ipca["covered_from"], ipca["covered_through"]) == (
        2,
        "2026-01",
        "2026-02",
    )
    assert (body["index_days"], body["index_through"]) == (
        0,
        None,
    )  # o dólar não conta como Ibovespa


def test_refresh_endpoint_names_the_failing_source(client, monkeypatch):
    def broken_dollar(start, end):
        raise OSError("PTAX fora do ar")

    stub_sources(monkeypatch)
    monkeypatch.setattr(bcb, "fetch_daily_usd", broken_dollar)

    response = client.post(f"{API}/benchmarks/refresh")

    assert response.status_code == 200
    assert response.json()["errors"] == ["Dólar: PTAX fora do ar"]
    assert response.json()["status"]["usd_days"] == 0


def test_refresh_endpoint_is_502_when_only_the_dollar_and_nothing_else_arrives(client, monkeypatch):
    def offline(*args):
        raise OSError("offline")

    for name in ("fetch_series", "fetch_daily_cdi", "fetch_ibovespa", "fetch_daily_usd"):
        monkeypatch.setattr(bcb, name, offline)
    assert client.post(f"{API}/benchmarks/refresh").status_code == 502

    monkeypatch.setattr(bcb, "fetch_daily_usd", lambda s, e: [(D(2026, 10, 1), 54_000)])
    response = client.post(f"{API}/benchmarks/refresh")
    assert response.status_code == 200 and response.json()["rows_saved"] == 1


# ---- demonstração ----------------------------------------------------------------------------


@pytest.fixture
def demo_session(client):
    session = session_of(client)
    assert seed_demo(session, today=D(2026, 10, 17)) is True
    return session


def test_demo_has_a_deterministic_fictional_ipca_without_the_current_month(demo_session):
    status = {s.series: s for s in get_status(demo_session).series}
    ipca = status["ipca"]
    assert ipca.months >= 6
    assert ipca.covered_through == "2026-09"  # outubro (mês corrente) ainda não saiu
    assert status["cdi"].covered_through == "2026-10"


def test_demo_has_a_fictional_dollar_up_to_the_last_business_day(demo_session):
    status = get_status(demo_session)
    assert status.usd_days > 100
    assert status.usd_through == "2026-10-16"  # 17/10/2026 é sábado
    levels = index_levels(demo_session, D(2026, 9, 1), D(2026, 10, 31), "usd")
    assert all(40_000 < quote < 60_000 for _, quote in levels)  # R$ 4 a 6, em décimos de milésimo
    assert [d.weekday() < 5 for d, _ in levels] == [True] * len(levels)


def test_demo_performance_shows_the_ipca_with_the_open_month_as_partial(client, demo_session):
    body = client.get(f"{API}/analytics/performance").json()

    assert body["ipca_covered_through"] == "2026-09"
    points = body["points"]
    assert points[0]["ipca_bps"] == 0
    assert any(p["ipca_bps"] is not None and p["ipca_bps"] > 0 for p in points)
    assert points[-1]["date"] > "2026-09-30" and points[-1]["ipca_bps"] is None  # outubro aberto
    summary = body["summary"]
    assert summary["ipca_date"] is not None and summary["ipca_date"] <= "2026-09-30"
    assert summary["vs_ipca_bps"] is not None
    assert any("IPCA" in w for w in body["warnings"])


def test_demo_crypto_scope_compares_with_the_fictional_dollar(client, demo_session):
    body = client.get(f"{API}/analytics/performance", params={"scope": "cripto"}).json()

    assert body["usd_covered_through"] == "2026-10-16"
    assert all(p["usd_bps"] is not None for p in body["points"])
    assert body["summary"]["vs_usd_bps"] is not None
    assert not any("dólar" in w.lower() for w in body["warnings"])


def test_a_dollar_batch_the_database_refuses_is_rolled_back_and_does_not_break_the_session(client):
    session = session_of(client)
    result = refresh(
        session,
        fetcher=monthly,
        usd_fetcher=lambda s, e: [(D(2026, 10, 1), 54_000), (D(2026, 10, 2), None)],
        today=TODAY,
    )

    # O CDI, a Selic e o IPCA já estavam confirmados; do dólar, nada ficou pela metade.
    assert len(result.errors) == 1 and result.errors[0].startswith("Dólar: ")
    assert result.ok is True and result.status.usd_days == 0
    assert result.status.series[0].months == 1
