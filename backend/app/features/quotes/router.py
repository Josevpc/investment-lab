from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.features.quotes import client

router = APIRouter(prefix="/quotes", tags=["quotes"])


class CryptoQuote(BaseModel):
    ticker: str
    price: str  # reais por moeda, texto decimal (nunca float)
    source: str = "Binance"


@router.get("/crypto", response_model=CryptoQuote)
def crypto_quote(ticker: str = Query(pattern=r"^[A-Za-z0-9]{1,20}$")):
    """Cotação atual em R$, consultada na hora (nada é guardado nem atualizado sozinho)."""
    try:
        price = client.fetch_crypto_price_brl(ticker)
    except client.UnknownTicker:
        raise HTTPException(
            status_code=404, detail=f"A Binance não tem cotação para {ticker.upper()}."
        ) from None
    except ValueError as exc:
        raise HTTPException(
            status_code=502, detail=f"Não foi possível buscar a cotação na Binance: {exc}"
        ) from exc
    return CryptoQuote(ticker=ticker.upper(), price=price)
