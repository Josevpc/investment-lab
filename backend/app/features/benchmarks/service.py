from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.features.benchmarks import client
from app.features.benchmarks.models import BenchmarkDaily, BenchmarkIndexLevel, BenchmarkRate
from app.features.benchmarks.schemas import BenchmarkStatus, RefreshResult, SeriesStatus

# Histórico inicial buscado; as séries mensais são pequenas (centenas de linhas).
HISTORY_START = date(2010, 1, 1)
STALE_AFTER = timedelta(hours=12)
IBOVESPA = "ibovespa"
INDEX_SOURCE = client.INDEX_SOURCE


def get_status(session: Session, *, now: datetime | None = None) -> BenchmarkStatus:
    now = now or datetime.now()
    updated_at = session.scalar(select(func.max(BenchmarkRate.fetched_at)))
    series = []
    for key, label in client.SERIES_LABELS.items():
        months, first, last = session.execute(
            select(
                func.count(), func.min(BenchmarkRate.month), func.max(BenchmarkRate.month)
            ).where(BenchmarkRate.series == key)
        ).one()
        series.append(
            SeriesStatus(
                series=key, label=label, months=months, covered_from=first, covered_through=last
            )
        )
    daily_days, daily_through = session.execute(
        select(func.count(), func.max(BenchmarkDaily.date)).where(BenchmarkDaily.series == "cdi")
    ).one()
    index_days, index_through = session.execute(
        select(func.count(), func.max(BenchmarkIndexLevel.date)).where(
            BenchmarkIndexLevel.series == IBOVESPA
        )
    ).one()
    return BenchmarkStatus(
        source=client.SOURCE,
        updated_at=updated_at,
        stale=updated_at is None or now - updated_at > STALE_AFTER,
        series=series,
        daily_days=daily_days,
        daily_through=daily_through.isoformat() if daily_through else None,
        index_days=index_days,
        index_through=index_through.isoformat() if index_through else None,
    )


def _upsert(session: Session, series: str, rows: list[tuple[str, int]]) -> int:
    existing = {
        r.month: r
        for r in session.scalars(select(BenchmarkRate).where(BenchmarkRate.series == series))
    }
    # Um único relógio (hora local) para gravar e comparar: o `now()` do SQLite é UTC.
    now = datetime.now()
    for month, ppm in rows:
        row = existing.get(month)
        if row is None:
            session.add(BenchmarkRate(series=series, month=month, rate_ppm=ppm, fetched_at=now))
        else:
            row.rate_ppm = ppm
            row.fetched_at = now
    session.commit()
    return len(rows)


def _upsert_daily(session: Session, series: str, rows: list[tuple[date, int]]) -> int:
    existing = {
        r.date: r
        for r in session.scalars(select(BenchmarkDaily).where(BenchmarkDaily.series == series))
    }
    for day, e9 in rows:
        row = existing.get(day)
        if row is None:
            session.add(BenchmarkDaily(series=series, date=day, rate_e9=e9))
        else:
            row.rate_e9 = e9
    session.commit()
    return len(rows)


def _upsert_index(session: Session, series: str, rows: list[tuple[date, int]]) -> int:
    """Grava os fechamentos; repetir os mesmos dias não duplica nem altera nada."""
    if not rows:
        return 0
    first = min(day for day, _ in rows)
    existing = {
        r.date: r
        for r in session.scalars(
            select(BenchmarkIndexLevel).where(
                BenchmarkIndexLevel.series == series, BenchmarkIndexLevel.date >= first
            )
        )
    }
    now = datetime.now()
    for day, close_e2 in rows:
        row = existing.get(day)
        if row is None:
            existing[day] = BenchmarkIndexLevel(
                series=series, date=day, close_e2=close_e2, fetched_at=now
            )
            session.add(existing[day])
        elif row.close_e2 != close_e2:
            row.close_e2 = close_e2
            row.fetched_at = now
    session.commit()
    return len(rows)


def index_level_on_or_before(
    session: Session, day: date, series: str = IBOVESPA
) -> tuple[date, int] | None:
    """Último fechamento em `day` ou antes (fim de semana e feriado usam o pregão anterior).

    Devolve (data do pregão, fechamento em centésimos de ponto), ou None se não há dado até lá.
    """
    row = session.execute(
        select(BenchmarkIndexLevel.date, BenchmarkIndexLevel.close_e2)
        .where(BenchmarkIndexLevel.series == series, BenchmarkIndexLevel.date <= day)
        .order_by(BenchmarkIndexLevel.date.desc())
        .limit(1)
    ).first()
    return (row[0], row[1]) if row else None


def index_levels(
    session: Session, after: date, through: date, series: str = IBOVESPA
) -> list[tuple[date, int]]:
    """Fechamentos guardados de `after` a `through` (inclusive), em ordem de data, numa consulta."""
    rows = session.execute(
        select(BenchmarkIndexLevel.date, BenchmarkIndexLevel.close_e2)
        .where(
            BenchmarkIndexLevel.series == series,
            BenchmarkIndexLevel.date >= after,
            BenchmarkIndexLevel.date <= through,
        )
        .order_by(BenchmarkIndexLevel.date)
    )
    return [(day, close) for day, close in rows]


def daily_rates(
    session: Session, series: str, after: date, through: date
) -> list[tuple[date, Decimal]]:
    """Taxas diárias dos dias úteis em (after, through], como fração de 1 (0,0004 = 0,04%)."""
    rows = session.execute(
        select(BenchmarkDaily.date, BenchmarkDaily.rate_e9)
        .where(
            BenchmarkDaily.series == series,
            BenchmarkDaily.date > after,
            BenchmarkDaily.date <= through,
        )
        .order_by(BenchmarkDaily.date)
    )
    return [(day, Decimal(e9) / Decimal(10**9)) for day, e9 in rows]


def refresh(
    session: Session,
    *,
    fetcher: client.Fetcher | None = None,
    daily_fetcher: client.DailyFetcher | None = None,
    index_fetcher: client.DailyFetcher | None = None,
    today: date | None = None,
) -> RefreshResult:
    """Busca as taxas no Banco Central e o Ibovespa na B3 e atualiza o banco.

    Nunca levanta por falha de rede: cada fonte tem o seu try/rollback, e uma que falha não
    desfaz o que as outras já salvaram. Com `fetcher` injetado (testes), o CDI diário e o
    Ibovespa só são buscados se `daily_fetcher` e `index_fetcher` também forem.
    """
    fetch = fetcher or client.fetch_series
    fetch_daily = daily_fetcher or (client.fetch_daily_cdi if fetcher is None else None)
    fetch_index = index_fetcher or (client.fetch_ibovespa if fetcher is None else None)
    end = today or date.today()
    saved = 0
    errors: list[str] = []
    for series, label in client.SERIES_LABELS.items():
        try:
            saved += _upsert(session, series, fetch(series, HISTORY_START, end))
        except Exception as exc:  # rede fora do ar, resposta inesperada, etc.
            session.rollback()
            errors.append(f"{label}: {exc}")
    if fetch_daily is not None:
        last = session.scalar(
            select(func.max(BenchmarkDaily.date)).where(BenchmarkDaily.series == "cdi")
        )
        start = last + timedelta(days=1) if last else HISTORY_START
        try:
            if start <= end:
                saved += _upsert_daily(session, "cdi", fetch_daily(start, end))
        except Exception as exc:
            session.rollback()
            errors.append(f"CDI diário: {exc}")
    if fetch_index is not None:
        last_close = session.scalar(
            select(func.max(BenchmarkIndexLevel.date)).where(BenchmarkIndexLevel.series == IBOVESPA)
        )
        # Recomeça no último dia guardado (não no seguinte): se ele foi gravado durante o pregão,
        # a próxima busca o corrige para o fechamento.
        start = last_close or HISTORY_START
        # Um pedido e um commit por ano: a primeira carga são ~17 pedidos, e se um deles falhar os
        # anos anteriores ficam gravados e a próxima atualização continua do último dia guardado.
        try:
            for year in range(start.year, end.year + 1) if start <= end else ():
                first, last_day = max(start, date(year, 1, 1)), min(end, date(year, 12, 31))
                rows = [r for r in fetch_index(first, last_day) if first <= r[0] <= last_day]
                saved += _upsert_index(session, IBOVESPA, rows)
        except Exception as exc:
            session.rollback()  # desfaz só o ano que falhou; os anteriores já foram confirmados
            errors.append(f"Ibovespa: {exc}")
    return RefreshResult(
        ok=not errors or saved > 0, rows_saved=saved, errors=errors, status=get_status(session)
    )


def refresh_if_stale(
    session: Session, *, fetcher: client.Fetcher | None = None
) -> RefreshResult | None:
    status = get_status(session)
    # Em produção (sem fetcher injetado) também busca o CDI diário e o Ibovespa, se ainda não
    # houver nenhum.
    missing_daily = fetcher is None and (status.daily_days == 0 or status.index_days == 0)
    if not status.stale and not missing_daily:
        return None
    return refresh(session, fetcher=fetcher)


def monthly_rates(session: Session, series: str) -> dict[str, int]:
    """Todas as taxas mensais da série, por mês (AAAA-MM), em ppm."""
    rows = session.execute(
        select(BenchmarkRate.month, BenchmarkRate.rate_ppm).where(BenchmarkRate.series == series)
    )
    return {month: ppm for month, ppm in rows}
