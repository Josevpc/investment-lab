"""Cotação de criptomoedas em reais pela API pública da Binance (sem chave, só leitura)."""

import json
import urllib.error
import urllib.request
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

URL = "https://api.binance.com/api/v3/ticker/price?symbol={symbol}"
PRICE_DECIMALS = 6  # as mesmas casas que o front aceita na cotação


class UnknownTicker(Exception):
    """A Binance não negocia a moeda (nem em reais, nem em USDT)."""


def _price(symbol: str, timeout: int) -> Decimal:
    request = urllib.request.Request(
        URL.format(symbol=symbol), headers={"User-Agent": "investment-lab/0.1"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 (https fixo)
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 400:  # "Invalid symbol": o par não existe
            raise UnknownTicker(symbol) from exc
        raise ValueError(f"a Binance respondeu com erro HTTP {exc.code}") from exc
    except (OSError, ValueError) as exc:
        raise ValueError(f"não foi possível falar com a Binance ({exc})") from exc
    try:
        price = Decimal(str(payload["price"]))
    except (KeyError, TypeError, InvalidOperation) as exc:
        raise ValueError("resposta inesperada da Binance") from exc
    if not price.is_finite() or price <= 0:
        raise ValueError("resposta inesperada da Binance (preço inválido)")
    return price


def _text(price: Decimal) -> str:
    rounded = price.quantize(Decimal(1).scaleb(-PRICE_DECIMALS), rounding=ROUND_HALF_UP)
    return format(rounded.normalize(), "f")


def fetch_crypto_price_brl(ticker: str, *, timeout: int = 10) -> str:
    """Preço de 1 moeda em reais, como texto decimal (ex.: "431884.5").

    Usa o par em reais quando existe. Moedas sem ele (ex.: ONDO) saem pelo par em USDT vezes o
    USDT em reais, que é a cotação que a própria Binance usaria para converter.
    """
    ticker = ticker.upper()
    try:
        return _text(_price(f"{ticker}BRL", timeout))
    except UnknownTicker:
        pass
    in_usdt = _price(f"{ticker}USDT", timeout)  # sem este par também, UnknownTicker sobe
    return _text(in_usdt * _price("USDTBRL", timeout))
