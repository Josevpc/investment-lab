import io
import json
import urllib.error

import pytest

from app.features.quotes import client as binance

API = "/api/v1"


def serve(monkeypatch, prices: dict[str, str]):
    """Troca o urlopen: responde como a Binance, ou 400 para par que não existe."""

    def fake_urlopen(request, timeout):
        symbol = request.full_url.split("symbol=")[1]
        if symbol not in prices:
            body = io.BytesIO(b'{"code":-1121,"msg":"Invalid symbol."}')
            raise urllib.error.HTTPError(request.full_url, 400, "Bad Request", {}, body)
        return io.BytesIO(json.dumps({"symbol": symbol, "price": prices[symbol]}).encode())

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)


def test_uses_the_brl_pair_when_it_exists(monkeypatch):
    serve(monkeypatch, {"BTCBRL": "431884.00000000"})
    assert binance.fetch_crypto_price_brl("btc") == "431884"


def test_falls_back_to_usdt_times_the_dollar_when_there_is_no_brl_pair(monkeypatch):
    serve(monkeypatch, {"ONDOUSDT": "0.41320000", "USDTBRL": "5.38300000"})
    assert binance.fetch_crypto_price_brl("ONDO") == "2.224256"  # 0,4132 x 5,383 = 2,2242556


def test_unknown_ticker_is_reported_as_not_found(monkeypatch):
    serve(monkeypatch, {})
    with pytest.raises(binance.UnknownTicker):
        binance.fetch_crypto_price_brl("XYZ")


def test_endpoint_returns_the_price(client, monkeypatch):
    serve(monkeypatch, {"BTCBRL": "431884.50000000"})
    response = client.get(f"{API}/quotes/crypto", params={"ticker": "BTC"})
    assert response.status_code == 200
    assert response.json()["price"] == "431884.5"
    assert response.json()["ticker"] == "BTC"


def test_endpoint_404_for_unknown_ticker(client, monkeypatch):
    serve(monkeypatch, {})
    assert client.get(f"{API}/quotes/crypto", params={"ticker": "XYZ"}).status_code == 404


def test_endpoint_502_when_binance_is_unreachable(client):
    # a fixture no_network já faz o urlopen falhar
    response = client.get(f"{API}/quotes/crypto", params={"ticker": "BTC"})
    assert response.status_code == 502
    assert "Binance" in response.json()["detail"]


@pytest.mark.parametrize("ticker", ["", "BTC/BRL", "btc brl", "A" * 21, "BTC&x=1"])
def test_endpoint_rejects_malformed_tickers(client, ticker):
    assert client.get(f"{API}/quotes/crypto", params={"ticker": ticker}).status_code == 422
