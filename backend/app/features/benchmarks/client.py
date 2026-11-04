"""Clientes das fontes públicas de referência: séries do Banco Central (SGS) e Ibovespa da B3.

Sem chave e sem dependências extras.
"""

import base64
import json
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

# Taxa acumulada no mês, em % a.m.: CDI (4391) e Selic (4390).
SERIES_CODES = {"cdi": 4391, "selic": 4390}
SERIES_LABELS = {"cdi": "CDI", "selic": "Selic"}
SOURCE = "Banco Central do Brasil (SGS, séries 4391, 4390 e 12) e B3 (Ibovespa)"
INDEX_SOURCE = "B3 (Ibovespa, fechamento diário)"
URL = (
    "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados"
    "?formato=json&dataInicial={start}&dataFinal={end}"
)

Fetcher = Callable[[str, date, date], list[tuple[str, int]]]
DailyFetcher = Callable[[date, date], list[tuple[date, int]]]

# CDI diário (% a.d.), uma linha por dia útil.
DAILY_CDI_CODE = 12
# A API limita consultas de séries diárias a janelas de até 10 anos.
DAILY_WINDOW_YEARS = 9


def percent_to_ppm(value: str) -> int:
    """ "1.08" (% a.m.) -> 10800 ppm."""
    return int((Decimal(value) * 10_000).to_integral_value(rounding=ROUND_HALF_UP))


def parse_series(payload: list[dict]) -> list[tuple[str, int]]:
    """[{"data": "01/09/2026", "valor": "1.08"}] -> [("2026-09", 10800)]."""
    rows = []
    for item in payload:
        day, month, year = item["data"].split("/")
        rows.append((f"{year}-{month}", percent_to_ppm(item["valor"])))
    return rows


def _is_no_data(payload: object) -> bool:
    """O SGS responde assim quando a janela pedida não tem nenhum valor publicado."""
    error = payload.get("erro") if isinstance(payload, dict) else None
    return isinstance(error, dict) and "Value(s) not found" in str(error.get("detail", ""))


def _get_sgs_rows(url: str, timeout: int) -> list[dict]:
    """Baixa uma consulta do SGS. Janela sem valores (hoje, feriado) vira lista vazia.

    O Banco Central devolve esse caso ora com HTTP 200, ora com 404, e em ambos o corpo é um
    objeto de erro, não uma lista. Qualquer outra coisa que não seja lista é falha de verdade.
    """
    request = urllib.request.Request(url, headers={"User-Agent": "investment-lab/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 (https fixo)
            body = response.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 404 and _is_no_data(_load_json(exc.read())):
            return []
        raise ValueError(f"o Banco Central respondeu com erro HTTP {exc.code}") from exc
    payload = _load_json(body)
    if isinstance(payload, list):
        return payload
    if _is_no_data(payload):
        return []
    raise ValueError(f"resposta inesperada do Banco Central: {str(payload)[:100]}")


def _load_json(body: bytes) -> object:
    try:
        return json.loads(body.decode("utf-8"))
    except ValueError:  # corpo que não é JSON (página de erro, por exemplo)
        return None


def fetch_series(
    series: str, start: date, end: date, *, timeout: int = 20
) -> list[tuple[str, int]]:
    url = URL.format(
        code=SERIES_CODES[series], start=start.strftime("%d/%m/%Y"), end=end.strftime("%d/%m/%Y")
    )
    return parse_series(_get_sgs_rows(url, timeout))


def percent_to_e9(value: str) -> int:
    """ "0.043739" (% a.d.) -> 437390 (bilionésimos de 1)."""
    return int((Decimal(value) * 10_000_000).to_integral_value(rounding=ROUND_HALF_UP))


def parse_daily(payload: list[dict]) -> list[tuple[date, int]]:
    """[{"data": "02/01/2026", "valor": "0.043739"}] -> [(date(2026, 1, 2), 437390)]."""
    rows = []
    for item in payload:
        day, month, year = item["data"].split("/")
        rows.append((date(int(year), int(month), int(day)), percent_to_e9(item["valor"])))
    return rows


def fetch_daily_cdi(start: date, end: date, *, timeout: int = 30) -> list[tuple[date, int]]:
    rows: list[tuple[date, int]] = []
    window_start = start
    while window_start <= end:
        window_end = min(end, date(window_start.year + DAILY_WINDOW_YEARS, 12, 31))
        url = URL.format(
            code=DAILY_CDI_CODE,
            start=window_start.strftime("%d/%m/%Y"),
            end=window_end.strftime("%d/%m/%Y"),
        )
        rows.extend(parse_daily(_get_sgs_rows(url, timeout)))
        window_start = window_end + timedelta(days=1)
    return rows


# ---- Ibovespa (B3) -----------------------------------------------------------------------

# O site de índices da B3 serve, em um único pedido, o fechamento de todos os dias de um ano.
B3_URL = "https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetPortfolioDay/{token}"
# Sem um User-Agent de navegador a B3 recusa o pedido.
B3_USER_AGENT = "Mozilla/5.0"


def b3_close_to_e2(value: str) -> int:
    """ "129.593,29" (pontos, formato pt-BR) -> 12959329 centésimos de ponto."""
    normalized = value.strip().replace(".", "").replace(",", ".")
    return int((Decimal(normalized) * 100).to_integral_value(rounding=ROUND_HALF_UP))


def parse_b3_year(payload: dict, year: int) -> list[tuple[date, int]]:
    """Fechamentos diários de um ano na resposta da B3, em ordem de data.

    `results` tem uma linha por dia do mês (1 a 31) e uma coluna `rateValueN` por mês. Célula vazia
    é dia sem pregão ou dia que não existe no mês (31/02): fica de fora, sem inventar fechamento.
    Linhas de resumo (dia fora de 1 a 31) também são ignoradas.
    """
    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list):
        raise ValueError("resposta inesperada da B3 (sem a lista de resultados)")
    rows: dict[date, int] = {}
    for line in results:
        try:
            day = int(line["day"])
        except (KeyError, TypeError, ValueError):
            continue
        if not 1 <= day <= 31:
            continue
        for month in range(1, 13):
            raw = line.get(f"rateValue{month}")
            if raw is None or not str(raw).strip():
                continue
            try:
                when = date(year, month, day)
            except ValueError:
                continue  # dia que não existe no mês
            try:
                close = b3_close_to_e2(str(raw))
            except InvalidOperation:
                raise ValueError(f"fechamento ilegível na B3: {raw!r}") from None
            if close > 0:
                rows[when] = close
    return sorted(rows.items())


def fetch_ibovespa(start: date, end: date, *, timeout: int = 20) -> list[tuple[date, int]]:
    """Fechamentos do Ibovespa entre `start` e `end` (inclusive): um pedido por ano."""
    rows: list[tuple[date, int]] = []
    for year in range(start.year, end.year + 1):
        query = json.dumps(
            {"index": "IBOV", "language": "pt-br", "year": str(year)}, separators=(",", ":")
        )
        token = base64.b64encode(query.encode("utf-8")).decode("ascii")
        request = urllib.request.Request(
            B3_URL.format(token=token), headers={"User-Agent": B3_USER_AGENT}
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
                payload = _load_json(response.read())
        except urllib.error.HTTPError as exc:
            raise ValueError(f"a B3 respondeu com erro HTTP {exc.code}") from exc
        # Resposta que não é JSON vira None e cai na checagem de formato de `parse_b3_year`.
        rows.extend((d, c) for d, c in parse_b3_year(payload, year) if start <= d <= end)
    return rows
