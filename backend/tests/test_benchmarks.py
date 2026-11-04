import datetime as dt
import io
import json
import urllib.error
from datetime import date, datetime, timedelta

import pytest

from app.features.benchmarks import client as bcb
from app.features.benchmarks.service import monthly_rates, refresh, refresh_if_stale

API = "/api/v1/benchmarks"


def fake_fetcher(series, start, end):
    base = {
        "cdi": [("2026-01", 11600), ("2026-02", 10000)],
        "selic": [("2026-01", 11600), ("2026-02", 10000)],
    }
    return base[series]


# ---- cliente: conversão das respostas do Banco Central ------------------------------------


def test_percent_is_converted_to_ppm_without_floats():
    assert bcb.percent_to_ppm("1.08") == 10_800
    assert bcb.percent_to_ppm("0.51") == 5_100
    assert bcb.percent_to_ppm("0.0001") == 1
    assert bcb.percent_to_ppm("1.16") == 11_600


def test_parse_series_maps_dates_to_months():
    payload = [{"data": "01/09/2026", "valor": "1.08"}, {"data": "01/10/2026", "valor": "0.51"}]
    assert bcb.parse_series(payload) == [("2026-09", 10_800), ("2026-10", 5_100)]


# ---- cliente: respostas de erro do SGS (sem rede, urlopen falso) ---------------------------

NOT_FOUND_BODY = {
    "erro": {
        "statusCode": 404,
        "detail": "br.gov.bcb.sgs.SGSNegocioException: Value(s) not found",
    }
}


class FakeResponse:
    def __init__(self, payload):
        self.body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self.body


def serve(monkeypatch, payload=None, *, http_status=None):
    """Troca o urlopen: devolve o payload (200) ou levanta HTTPError com ele no corpo."""
    body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()

    def fake_urlopen(request, timeout):
        if http_status is None:
            return FakeResponse(payload)
        raise urllib.error.HTTPError(request.full_url, http_status, "erro", {}, io.BytesIO(body))

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)


FETCHES = {
    "cdi diário": lambda: bcb.fetch_daily_cdi(dt.date(2026, 10, 17), dt.date(2026, 10, 18)),
    "série mensal": lambda: bcb.fetch_series("cdi", dt.date(2026, 10, 17), dt.date(2026, 10, 18)),
}


@pytest.mark.parametrize("fetch", FETCHES.values(), ids=FETCHES.keys())
@pytest.mark.parametrize("http_status", [None, 404])
def test_a_window_without_published_values_means_no_new_data(fetch, http_status, monkeypatch):
    serve(monkeypatch, NOT_FOUND_BODY, http_status=http_status)
    assert fetch() == []


@pytest.mark.parametrize("fetch", FETCHES.values(), ids=FETCHES.keys())
@pytest.mark.parametrize(
    ("payload", "http_status"),
    [
        (NOT_FOUND_BODY, 500),  # mesmo corpo, mas o status não é de "sem dados"
        ({"erro": {"statusCode": 500, "detail": "Falha interna"}}, None),
        ({"erro": {"statusCode": 500, "detail": "Falha interna"}}, 500),
        ({"outra": "coisa"}, None),
        ("texto solto", None),
        (b"<html>fora do ar</html>", None),
        (b"<html>fora do ar</html>", 500),
    ],
)
def test_other_failures_still_raise_with_a_clear_message(fetch, payload, http_status, monkeypatch):
    serve(monkeypatch, payload, http_status=http_status)
    with pytest.raises(Exception, match="Banco Central") as raised:
        fetch()
    assert "string indices" not in str(raised.value)


def test_refresh_with_the_daily_cdi_up_to_date_registers_no_error(client, monkeypatch):
    from app.core.db import get_session

    session = next(client.app.dependency_overrides[get_session]())
    serve(monkeypatch, NOT_FOUND_BODY, http_status=404)  # fim de semana: nada novo a baixar
    monkeypatch.setattr(bcb, "fetch_series", fake_fetcher)
    monkeypatch.setattr(bcb, "fetch_ibovespa", lambda start, end: [])

    result = refresh(session, today=dt.date(2026, 10, 18))

    assert result.errors == []


# ---- serviço -----------------------------------------------------------------------------


def test_refresh_saves_both_series_and_reports_coverage(client):
    from app.core.db import get_session

    session = next(client.app.dependency_overrides[get_session]())
    result = refresh(session, fetcher=fake_fetcher)
    assert result.ok is True
    assert result.rows_saved == 4
    assert result.errors == []
    status = {s.series: s for s in result.status.series}
    assert (status["cdi"].months, status["cdi"].covered_from, status["cdi"].covered_through) == (
        2,
        "2026-01",
        "2026-02",
    )
    assert result.status.stale is False
    assert monthly_rates(session, "selic") == {"2026-01": 11_600, "2026-02": 10_000}


def test_refresh_updates_existing_rates_instead_of_duplicating(client):
    from app.core.db import get_session

    session = next(client.app.dependency_overrides[get_session]())
    refresh(session, fetcher=fake_fetcher)
    refresh(session, fetcher=lambda s, a, b: [("2026-02", 10_500), ("2026-03", 12_100)])
    assert monthly_rates(session, "cdi") == {
        "2026-01": 11_600,
        "2026-02": 10_500,
        "2026-03": 12_100,
    }


def test_refresh_survives_a_failing_series_and_reports_it(client):
    from app.core.db import get_session

    def flaky(series, start, end):
        if series == "selic":
            raise TimeoutError("sem rede")
        return [("2026-01", 11_600)]

    session = next(client.app.dependency_overrides[get_session]())
    result = refresh(session, fetcher=flaky)
    assert result.ok is True  # o CDI foi salvo
    assert result.rows_saved == 1
    assert result.errors == ["Selic: sem rede"]


def test_refresh_never_raises_when_everything_fails(client):
    from app.core.db import get_session

    def offline(series, start, end):
        raise OSError("offline")

    session = next(client.app.dependency_overrides[get_session]())
    result = refresh(session, fetcher=offline)
    assert result.ok is False
    assert len(result.errors) == 2


def test_refresh_if_stale_only_fetches_when_old_or_empty(client):
    from app.core.db import get_session

    calls = []

    def counting(series, start, end):
        calls.append(series)
        return [("2026-01", 11_600)]

    session = next(client.app.dependency_overrides[get_session]())
    assert refresh_if_stale(session, fetcher=counting) is not None  # banco vazio
    assert refresh_if_stale(session, fetcher=counting) is None  # recém-atualizado
    assert calls == ["cdi", "selic"]


# ---- API ---------------------------------------------------------------------------------


def test_status_endpoint_starts_empty_and_stale(client):
    body = client.get(f"{API}/status").json()
    assert body["updated_at"] is None
    assert body["stale"] is True
    assert body["source"].startswith("Banco Central do Brasil")
    assert {s["series"]: s["months"] for s in body["series"]} == {"cdi": 0, "selic": 0}


def fake_daily(start, end):
    return [(dt.date(2026, 10, 1), 437_390), (dt.date(2026, 10, 2), 437_390)]


def test_refresh_endpoint_uses_the_central_bank_client(client, monkeypatch):
    monkeypatch.setattr(bcb, "fetch_series", fake_fetcher)
    monkeypatch.setattr(bcb, "fetch_daily_cdi", fake_daily)
    monkeypatch.setattr(
        bcb, "fetch_ibovespa", lambda start, end: [(dt.date(2026, 10, 2), 12_959_329)]
    )
    response = client.post(f"{API}/refresh")
    assert response.status_code == 200
    assert response.json()["rows_saved"] == 4 + 2 + 1  # taxas mensais + CDI diário + Ibovespa
    assert response.json()["status"]["daily_days"] == 2
    assert response.json()["status"]["daily_through"] == "2026-10-02"
    assert client.get(f"{API}/status").json()["stale"] is False


def test_refresh_endpoint_returns_502_when_the_central_bank_is_unreachable(client, monkeypatch):
    def offline(series, start, end):
        raise OSError("offline")

    monkeypatch.setattr(bcb, "fetch_series", offline)
    monkeypatch.setattr(bcb, "fetch_daily_cdi", lambda start, end: offline("cdi", start, end))
    monkeypatch.setattr(bcb, "fetch_ibovespa", lambda start, end: offline("ibovespa", start, end))
    response = client.post(f"{API}/refresh")
    assert response.status_code == 502
    assert "Banco Central" in response.json()["detail"]


def test_stale_window_is_twelve_hours(client):
    from app.core.db import get_session
    from app.features.benchmarks.service import get_status

    session = next(client.app.dependency_overrides[get_session]())
    refresh(session, fetcher=fake_fetcher)
    now = datetime.now()
    assert get_status(session, now=now + timedelta(hours=11)).stale is False
    assert get_status(session, now=now + timedelta(hours=13)).stale is True
    assert date.today()  # garante o import de date em ambientes sem uso direto
