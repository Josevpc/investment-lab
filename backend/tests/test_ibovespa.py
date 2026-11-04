"""Ibovespa como referência: cliente da B3, atualização e comparação. Nada aqui usa a rede."""

import base64
import datetime as dt
import json
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.core.db import get_session
from app.features.analytics.performance import index_return, index_returns, to_bps
from app.features.benchmarks import client as bcb
from app.features.benchmarks.models import BenchmarkIndexLevel
from app.features.benchmarks.service import (
    HISTORY_START,
    get_status,
    index_level_on_or_before,
    refresh,
    refresh_if_stale,
)

API = "/api/v1"
D = dt.date
TODAY = D(2026, 10, 5)


def session_of(client):
    return next(client.app.dependency_overrides[get_session]())


def no_series(series, start, end):
    return []


def add_closes(session, closes: dict[dt.date, int]):
    for day, close in closes.items():
        session.add(BenchmarkIndexLevel(series="ibovespa", date=day, close_e2=close))
    session.commit()


def b3_payload(rows: list[dict]) -> dict:
    return {"min": {"day": 0, "rateValue1": "1,00"}, "max": {"day": 0}, "results": rows}


# ---- cliente: conversão e leitura do JSON da B3 -------------------------------------------


def test_b3_close_is_converted_to_hundredths_of_a_point_without_floats():
    assert bcb.b3_close_to_e2("129.593,29") == 12_959_329
    assert bcb.b3_close_to_e2("987,00") == 98_700
    assert bcb.b3_close_to_e2(" 1.000 ") == 100_000
    assert bcb.b3_close_to_e2("0,005") == 1  # meio centésimo sobe


def test_parse_b3_year_skips_null_months_missing_days_and_summary_lines():
    payload = b3_payload(
        [
            {"day": 0, "rateValue1": "999.999,99"},  # linha de resumo
            {"day": 1, "rateValue1": "187.952,91", "rateValue2": None, "rateValue3": ""},
            {"day": 2, "rateValue1": None, "rateValue2": "100,50"},
            {"day": 29, "rateValue2": "111,00", "rateValue3": "120,00"},  # 29/02/2026 não existe
            {"day": 30, "rateValue2": "112,00", "rateValue4": "121,25"},  # 30/02 não existe
            {"day": 31, "rateValue4": "122,00", "rateValue12": "130.000,00"},  # 31/04 não existe
            {"day": 32, "rateValue1": "5,00"},
        ]
    )
    assert bcb.parse_b3_year(payload, 2026) == [
        (D(2026, 1, 1), 18_795_291),
        (D(2026, 2, 2), 10_050),
        (D(2026, 3, 29), 12_000),
        (D(2026, 4, 30), 12_125),
        (D(2026, 12, 31), 13_000_000),
    ]


def test_parse_b3_year_accepts_a_leap_day_only_in_leap_years():
    rows = [{"day": 29, "rateValue2": "100,00"}]
    assert bcb.parse_b3_year(b3_payload(rows), 2028) == [(D(2028, 2, 29), 10_000)]
    assert bcb.parse_b3_year(b3_payload(rows), 2026) == []


@pytest.mark.parametrize("payload", [{}, {"results": None}, [], "texto"])
def test_parse_b3_year_rejects_an_unexpected_response(payload):
    with pytest.raises(ValueError, match="B3"):
        bcb.parse_b3_year(payload, 2026)


def test_parse_b3_year_rejects_an_unreadable_close_instead_of_guessing():
    with pytest.raises(ValueError, match="B3"):
        bcb.parse_b3_year(b3_payload([{"day": 1, "rateValue1": "n/d"}]), 2026)


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def test_fetch_ibovespa_makes_one_request_per_year_and_filters_the_period(monkeypatch):
    requests = []

    def fake_urlopen(request, timeout):
        requests.append((request, timeout))
        token = request.full_url.rsplit("/", 1)[1]
        year = json.loads(base64.b64decode(token))["year"]
        return FakeResponse(
            b3_payload(
                [
                    {"day": 2, "rateValue1": "100,00", "rateValue6": "110,00"},
                    {"day": 15, "rateValue12": "120,00"},
                ]
            )
            if year in ("2025", "2026")
            else b3_payload([])
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    rows = bcb.fetch_ibovespa(D(2025, 12, 1), D(2026, 6, 2))

    assert [json.loads(base64.b64decode(r.full_url.rsplit("/", 1)[1])) for r, _ in requests] == [
        {"index": "IBOV", "language": "pt-br", "year": "2025"},
        {"index": "IBOV", "language": "pt-br", "year": "2026"},
    ]
    assert requests[0][0].full_url.startswith(
        "https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetPortfolioDay/"
    )
    assert requests[0][0].get_header("User-agent") == "Mozilla/5.0"
    assert requests[0][1] > 0  # tem timeout
    # Fora de 01/12/2025 a 02/06/2026 (02/01/2025, 02/06/2025 e 15/12/2026) não entra.
    assert rows == [(D(2025, 12, 15), 12_000), (D(2026, 1, 2), 10_000), (D(2026, 6, 2), 11_000)]


def test_source_text_cites_b3():
    assert "B3" in bcb.SOURCE and "Ibovespa" in bcb.SOURCE
    assert "B3" in bcb.INDEX_SOURCE


# ---- serviço -----------------------------------------------------------------------------


def cdi_fetcher(series, start, end):
    return [("2026-01", 11_600)]


def test_refresh_saves_ibovespa_and_is_idempotent(client):
    session = session_of(client)
    rows = [(D(2026, 10, 1), 12_959_329), (D(2026, 10, 2), 13_000_000)]
    first = refresh(session, fetcher=cdi_fetcher, index_fetcher=lambda s, e: rows, today=TODAY)
    assert first.rows_saved == 2 + 2  # CDI e Selic mensais + dois fechamentos
    refresh(session, fetcher=cdi_fetcher, index_fetcher=lambda s, e: rows, today=TODAY)

    assert session.scalar(select(func.count()).select_from(BenchmarkIndexLevel)) == 2
    assert index_level_on_or_before(session, D(2026, 10, 2)) == (D(2026, 10, 2), 13_000_000)


def test_refresh_corrects_a_changed_close_without_duplicating(client):
    session = session_of(client)
    refresh(
        session,
        fetcher=cdi_fetcher,
        index_fetcher=lambda s, e: [(D(2026, 10, 2), 100)],
        today=TODAY,
    )
    refresh(
        session,
        fetcher=cdi_fetcher,
        index_fetcher=lambda s, e: [(D(2026, 10, 2), 200)],
        today=TODAY,
    )
    assert session.scalar(select(func.count()).select_from(BenchmarkIndexLevel)) == 1
    assert index_level_on_or_before(session, D(2026, 10, 2)) == (D(2026, 10, 2), 200)


def test_refresh_ignores_a_repeated_day_inside_the_same_batch(client):
    session = session_of(client)
    rows = [(D(2026, 10, 2), 100), (D(2026, 10, 2), 100)]
    refresh(session, fetcher=cdi_fetcher, index_fetcher=lambda s, e: rows, today=TODAY)
    assert session.scalar(select(func.count()).select_from(BenchmarkIndexLevel)) == 1


def test_refresh_is_incremental_from_the_last_stored_day(client):
    session = session_of(client)
    calls = []

    def index_fetcher(start, end):
        calls.append((start, end))
        return [(D(2026, 10, 1), 100), (D(2026, 10, 2), 110)]

    refresh(session, fetcher=cdi_fetcher, index_fetcher=index_fetcher, today=D(2026, 10, 5))
    first_load = list(calls)
    calls.clear()
    refresh(session, fetcher=cdi_fetcher, index_fetcher=index_fetcher, today=D(2026, 10, 6))

    # Primeira carga: desde o começo do histórico, um pedido por ano. Depois: recomeça no último
    # dia guardado.
    assert len(first_load) == 2026 - HISTORY_START.year + 1
    assert first_load[0] == (HISTORY_START, D(2010, 12, 31))
    assert first_load[-1] == (D(2026, 1, 1), D(2026, 10, 5))
    assert calls == [(D(2026, 10, 2), D(2026, 10, 6))]


def test_refresh_does_not_ask_for_a_future_start(client):
    session = session_of(client)
    add_closes(session, {D(2026, 10, 20): 100})
    calls = []
    refresh(
        session,
        fetcher=cdi_fetcher,
        index_fetcher=lambda s, e: calls.append((s, e)) or [],
        today=D(2026, 10, 10),
    )
    assert calls == []


def test_ibovespa_failure_does_not_lose_cdi_or_selic(client):
    session = session_of(client)

    def offline(start, end):
        raise TimeoutError("sem rede")

    result = refresh(session, fetcher=cdi_fetcher, index_fetcher=offline)

    assert result.ok is True
    assert result.rows_saved == 2  # CDI e Selic mensais
    assert result.errors == ["Ibovespa: sem rede"]
    assert {s.series: s.months for s in result.status.series} == {"cdi": 1, "selic": 1}
    assert result.status.index_days == 0


def test_a_failing_year_keeps_the_earlier_years_and_the_next_refresh_resumes(client):
    session = session_of(client)
    today = D(2026, 3, 10)

    def year_two_fails(start, end):
        if start.year < 2025:
            return []
        if start.year == 2025:
            return [(D(2025, 12, 30), 100), (D(2025, 12, 31), 110)]
        raise TimeoutError("B3 caiu")

    first = refresh(session, fetcher=cdi_fetcher, index_fetcher=year_two_fails, today=today)

    assert first.ok is True
    assert first.errors == ["Ibovespa: B3 caiu"]
    assert first.rows_saved == 2 + 2  # CDI e Selic + os dois fechamentos de 2025
    assert (first.status.index_days, first.status.index_through) == (2, "2025-12-31")
    assert {s.series: s.months for s in first.status.series} == {"cdi": 1, "selic": 1}

    calls = []

    def recovered(start, end):
        calls.append((start, end))
        if start.year == 2025:
            return [(D(2025, 12, 31), 110)]
        return [(D(2026, 1, 2), 120)]

    second = refresh(session, fetcher=cdi_fetcher, index_fetcher=recovered, today=today)

    # Recomeça no último dia guardado (2025 só com ele) e segue para 2026.
    assert calls == [(D(2025, 12, 31), D(2025, 12, 31)), (D(2026, 1, 1), today)]
    assert second.errors == []
    assert (second.status.index_days, second.status.index_through) == (3, "2026-01-02")


def test_a_failure_in_the_first_year_saves_no_ibovespa_at_all(client):
    session = session_of(client)

    def broken(start, end):
        raise ValueError("resposta inesperada da B3")

    result = refresh(session, fetcher=cdi_fetcher, index_fetcher=broken, today=TODAY)
    assert result.errors == ["Ibovespa: resposta inesperada da B3"]
    assert get_status(session).index_days == 0


def test_status_reports_ibovespa_coverage_and_cites_b3(client):
    session = session_of(client)
    empty = get_status(session)
    assert (empty.index_days, empty.index_through) == (0, None)

    add_closes(session, {D(2026, 10, 1): 100, D(2026, 10, 2): 110})
    status = client.get(f"{API}/benchmarks/status").json()
    assert (status["index_days"], status["index_through"]) == (2, "2026-10-02")
    assert "B3" in status["source"] and status["source"].startswith("Banco Central do Brasil")


def test_refresh_endpoint_succeeds_when_only_ibovespa_fails(client, monkeypatch):
    def offline(start, end):
        raise OSError("B3 fora do ar")

    monkeypatch.setattr(bcb, "fetch_series", cdi_fetcher)
    monkeypatch.setattr(bcb, "fetch_daily_cdi", lambda s, e: [(D(2026, 10, 1), 437_390)])
    monkeypatch.setattr(bcb, "fetch_ibovespa", offline)

    response = client.post(f"{API}/benchmarks/refresh")

    assert response.status_code == 200
    assert response.json()["errors"] == ["Ibovespa: B3 fora do ar"]
    assert response.json()["status"]["daily_days"] == 1


def test_refresh_endpoint_is_502_only_when_nothing_was_saved(client, monkeypatch):
    def offline(*args):
        raise OSError("offline")

    monkeypatch.setattr(bcb, "fetch_series", offline)
    monkeypatch.setattr(bcb, "fetch_daily_cdi", offline)
    monkeypatch.setattr(bcb, "fetch_ibovespa", offline)
    assert client.post(f"{API}/benchmarks/refresh").status_code == 502

    # Só o Ibovespa chegou: algo foi salvo, então não é erro.
    monkeypatch.setattr(bcb, "fetch_ibovespa", lambda s, e: [(D(2026, 10, 1), 100)])
    assert client.post(f"{API}/benchmarks/refresh").status_code == 200


def test_refresh_if_stale_also_fetches_when_there_is_no_ibovespa(client, monkeypatch):
    session = session_of(client)
    index_calls = []
    monkeypatch.setattr(bcb, "fetch_series", cdi_fetcher)
    monkeypatch.setattr(bcb, "fetch_daily_cdi", lambda s, e: [(D(2026, 10, 1), 437_390)])
    monkeypatch.setattr(
        bcb, "fetch_ibovespa", lambda s, e: index_calls.append(s) or [(D(2026, 10, 1), 100)]
    )

    assert refresh_if_stale(session) is not None  # banco vazio
    assert refresh_if_stale(session) is None  # recém-atualizado, com CDI diário e Ibovespa

    session.query(BenchmarkIndexLevel).delete()
    session.commit()
    assert refresh_if_stale(session) is not None  # não está velho, mas falta o Ibovespa
    assert index_calls.count(HISTORY_START) == 2  # duas cargas completas (um pedido por ano)


def test_index_level_on_or_before_uses_the_previous_session(client):
    session = session_of(client)
    add_closes(session, {D(2026, 10, 2): 100, D(2026, 10, 5): 200})  # sexta e segunda
    assert index_level_on_or_before(session, D(2026, 10, 4)) == (D(2026, 10, 2), 100)  # domingo
    assert index_level_on_or_before(session, D(2026, 10, 5)) == (D(2026, 10, 5), 200)
    assert index_level_on_or_before(session, D(2026, 10, 1)) is None


# ---- domínio: variação ponto a ponto -------------------------------------------------------


def test_index_return_is_point_to_point_and_rounds_half_up():
    assert to_bps(index_return(12_000_000, 12_600_000)) == 500
    assert to_bps(index_return(12_000_000, 11_880_000)) == -100
    assert to_bps(index_return(12_000_000, 12_000_600)) == 1  # 0,5 bp sobe
    assert to_bps(index_return(12_000_000, 12_000_000)) == 0
    assert index_return(None, 100) is None
    assert index_return(100, None) is None
    assert index_return(0, 100) is None


def test_index_returns_start_at_the_base_and_do_not_invent_missing_closes():
    closes = [None, 10_000, None, 11_000, 9_000]
    result = index_returns(closes, 1)
    assert result[0] is None
    assert result[1] == Decimal(0)
    assert result[2] is None
    assert to_bps(result[3]) == 1_000
    assert to_bps(result[4]) == -1_000
    assert index_returns([None, 10_000], 0) == [None, None]  # base sem fechamento
    assert index_returns([10_000], None) == [None]


# ---- API: carteira x Ibovespa -------------------------------------------------------------


def three_balances(client, make_asset):
    asset = make_asset(invested=100_000, current=100_000, valuation_date="2026-01-31")  # sábado
    for day, current in (("2026-02-28", 102_000), ("2026-03-31", 101_000)):  # sábado e terça
        body = {"date": day, "balance_cents": current}
        assert client.post(f"{API}/assets/{asset['id']}/balance", json=body).status_code == 200
    return asset


def test_performance_compares_the_portfolio_with_the_ibovespa(client, make_asset):
    three_balances(client, make_asset)
    add_closes(
        session_of(client),
        {
            D(2026, 1, 30): 12_000_000,  # sexta: vale para o sábado 31/01
            D(2026, 2, 27): 12_000_600,  # sexta: vale para o sábado 28/02
            D(2026, 3, 2): 15_000_000,  # segunda: não pode ser usado para 28/02
            D(2026, 3, 31): 11_880_000,
        },
    )

    response = client.get(f"{API}/analytics/performance")
    body = response.json()

    assert [p["ibovespa_bps"] for p in body["points"]] == [0, 1, -100]
    assert body["summary"]["ibovespa_bps"] == -100
    assert body["summary"]["vs_ibovespa_bps"] == body["summary"]["portfolio_bps"] + 100
    assert body["ibovespa_covered_through"] == "2026-03-31"
    assert "B3" in body["ibovespa_source"]
    assert not any("Ibovespa" in w for w in body["warnings"])
    assert "ponto a ponto" in body["method"] and "reinvestidos" in body["method"]
    assert "12000000" not in response.text  # nenhum ponto de índice sai pela API


def test_performance_without_any_ibovespa_keeps_everything_else_and_warns(client, make_asset):
    three_balances(client, make_asset)
    body = client.get(f"{API}/analytics/performance").json()

    assert [p["portfolio_bps"] for p in body["points"]] == [0, 200, 100]
    assert all(p["ibovespa_bps"] is None for p in body["points"])
    assert body["summary"]["ibovespa_bps"] is None
    assert body["summary"]["vs_ibovespa_bps"] is None
    assert body["ibovespa_covered_through"] is None
    assert body["ibovespa_source"] is None
    assert any("Ibovespa" in w for w in body["warnings"])


def test_performance_marks_stale_ibovespa_as_missing_and_warns(client, make_asset):
    three_balances(client, make_asset)
    add_closes(
        session_of(client),
        {D(2026, 1, 30): 12_000_000, D(2026, 2, 27): 12_600_000, D(2026, 3, 10): 12_700_000},
    )
    body = client.get(f"{API}/analytics/performance").json()

    # 31/03 está 21 dias depois do último fechamento: não se compara com dado velho.
    assert [p["ibovespa_bps"] for p in body["points"]] == [0, 500, None]
    assert body["summary"]["ibovespa_bps"] is None and body["summary"]["vs_ibovespa_bps"] is None
    assert body["ibovespa_covered_through"] == "2026-03-10"
    assert any("Ibovespa" in w and "10/03/2026" in w for w in body["warnings"])


def test_performance_without_a_base_close_has_no_comparison(client, make_asset):
    three_balances(client, make_asset)
    add_closes(session_of(client), {D(2026, 2, 27): 12_000_000, D(2026, 3, 31): 12_600_000})
    body = client.get(f"{API}/analytics/performance").json()  # nada em ou antes de 31/01
    assert all(p["ibovespa_bps"] is None for p in body["points"])
    assert any("Ibovespa" in w for w in body["warnings"])


# ---- API: ativo x Ibovespa ----------------------------------------------------------------


def seed_cdi(client, monkeypatch, closes: dict[dt.date, int]):
    days = [D(2025, 9, 1) + dt.timedelta(days=i) for i in range(70)]
    rows = [(d, 437_390) for d in days if d.weekday() < 5]
    monkeypatch.setattr(bcb, "fetch_series", lambda series, s, e: [("2025-10", 10_000)])
    monkeypatch.setattr(bcb, "fetch_daily_cdi", lambda s, e: rows)
    monkeypatch.setattr(bcb, "fetch_ibovespa", lambda s, e: sorted(closes.items()))
    assert client.post(f"{API}/benchmarks/refresh").status_code == 200


def variable_asset(client, make_asset, valuation_date, balance_date, end_cents=102_000_00):
    asset = make_asset(
        name="FII",
        class_key="renda_variavel",
        asset_type="fii",
        fii_segment="papel",
        invested=100_000_00,
        current=100_000_00,
        valuation_date=valuation_date,
    )
    saved = client.post(
        f"{API}/assets/{asset['id']}/balance",
        json={"date": balance_date, "balance_cents": end_cents},
    )
    assert saved.status_code in (200, 201), saved.text
    return asset


def test_asset_ibovespa_is_point_to_point_between_the_period_dates(client, make_asset, monkeypatch):
    seed_cdi(client, monkeypatch, {D(2025, 9, 30): 12_000_000, D(2025, 10, 30): 12_600_000})
    asset = variable_asset(client, make_asset, "2025-09-30", "2025-10-30")

    body = client.get(f"{API}/analytics/assets/{asset['id']}/vs-cdi").json()

    assert body["ibovespa_bps"] == 500
    assert body["return_bps"] is not None
    assert body["vs_ibovespa_bps"] == body["return_bps"] - 500
    assert body["ibovespa_covered_through"] == "2025-10-30"
    assert not any("Ibovespa" in w for w in body["warnings"])
    assert "ponto a ponto" in body["method"]


def test_asset_period_on_weekends_uses_the_previous_close(client, make_asset, monkeypatch):
    seed_cdi(
        client,
        monkeypatch,
        {
            D(2025, 9, 26): 12_000_000,  # sexta, vale para domingo 28/09
            D(2025, 9, 29): 20_000_000,  # segunda: não pode ser usado
            D(2025, 10, 31): 13_200_000,  # sexta, vale para sábado 01/11
            D(2025, 11, 3): 20_000_000,
        },
    )
    asset = variable_asset(client, make_asset, "2025-09-28", "2025-11-01")

    body = client.get(f"{API}/analytics/assets/{asset['id']}/vs-cdi").json()

    assert (body["start_date"], body["end_date"]) == ("2025-09-28", "2025-11-01")
    assert body["ibovespa_bps"] == 1_000
    assert body["ibovespa_covered_through"] == "2025-10-31"


def test_fixed_income_asset_has_no_ibovespa_and_no_warning(client, make_asset, monkeypatch):
    seed_cdi(client, monkeypatch, {D(2025, 9, 30): 12_000_000, D(2025, 10, 30): 12_600_000})
    asset = make_asset(
        invested=100_000_00,
        current=100_000_00,
        indexer="CDI",
        rate_bps=10_000,
        valuation_date="2025-09-30",
    )
    client.post(
        f"{API}/assets/{asset['id']}/balance",
        json={"date": "2025-10-30", "balance_cents": 100_900_00},
    )

    body = client.get(f"{API}/analytics/assets/{asset['id']}/vs-cdi").json()

    assert body["class_key"] == "renda_fixa" and body["pct_of_cdi_bps"] is not None
    assert body["ibovespa_bps"] is None
    assert body["vs_ibovespa_bps"] is None
    assert body["ibovespa_covered_through"] is None
    assert not any("Ibovespa" in w for w in body["warnings"])


def test_asset_period_starting_before_the_first_close_is_null_with_a_warning(
    client, make_asset, monkeypatch
):
    seed_cdi(client, monkeypatch, {D(2025, 10, 10): 12_000_000, D(2025, 10, 30): 12_600_000})
    asset = variable_asset(client, make_asset, "2025-09-30", "2025-10-30")

    body = client.get(f"{API}/analytics/assets/{asset['id']}/vs-cdi").json()

    assert body["ibovespa_bps"] is None and body["vs_ibovespa_bps"] is None
    assert body["return_bps"] is not None  # o resto da comparação continua
    assert any("Ibovespa" in w and "começo" in w for w in body["warnings"])


def test_asset_period_ending_after_the_last_close_is_null_with_a_warning(
    client, make_asset, monkeypatch
):
    seed_cdi(client, monkeypatch, {D(2025, 9, 30): 12_000_000, D(2025, 10, 20): 12_600_000})
    asset = variable_asset(client, make_asset, "2025-09-30", "2025-10-30")

    body = client.get(f"{API}/analytics/assets/{asset['id']}/vs-cdi").json()

    assert body["ibovespa_bps"] is None and body["vs_ibovespa_bps"] is None
    assert body["ibovespa_covered_through"] == "2025-10-20"
    assert any("Ibovespa" in w and "20/10/2025" in w for w in body["warnings"])


def test_asset_period_ending_within_four_days_of_the_last_close_still_compares(
    client, make_asset, monkeypatch
):
    seed_cdi(client, monkeypatch, {D(2025, 9, 30): 12_000_000, D(2025, 10, 26): 12_600_000})
    asset = variable_asset(client, make_asset, "2025-09-30", "2025-10-30")  # 4 dias depois

    body = client.get(f"{API}/analytics/assets/{asset['id']}/vs-cdi").json()

    assert body["ibovespa_bps"] == 500


def test_without_any_ibovespa_the_asset_screens_keep_working_with_null_fields(
    client, make_asset, monkeypatch
):
    seed_cdi(client, monkeypatch, {})
    asset = variable_asset(client, make_asset, "2025-09-30", "2025-10-30")

    single = client.get(f"{API}/analytics/assets/{asset['id']}/vs-cdi").json()
    listing = client.get(f"{API}/analytics/assets-vs-cdi").json()

    assert single["return_bps"] is not None and single["cdi_bps"] is not None
    for item in (single, listing[0]):
        assert item["ibovespa_bps"] is None
        assert item["vs_ibovespa_bps"] is None
        assert item["ibovespa_covered_through"] is None
    assert any("Ibovespa" in w for w in single["warnings"])


def test_asset_with_a_single_balance_has_no_ibovespa(client, make_asset):
    asset = make_asset(class_key="renda_variavel", asset_type="acao")
    body = client.get(f"{API}/analytics/assets/{asset['id']}/vs-cdi").json()
    assert body["ibovespa_bps"] is None and body["vs_ibovespa_bps"] is None
