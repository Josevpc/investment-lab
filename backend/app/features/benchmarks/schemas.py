from datetime import datetime

from pydantic import BaseModel


class SeriesStatus(BaseModel):
    series: str
    label: str
    months: int
    covered_from: str | None
    covered_through: str | None


class BenchmarkStatus(BaseModel):
    source: str
    updated_at: datetime | None
    stale: bool
    series: list[SeriesStatus]
    # CDI diário (usado no % do CDI por ativo): dias guardados e último dia.
    daily_days: int = 0
    daily_through: str | None = None
    # Ibovespa (B3): fechamentos diários guardados e último dia.
    index_days: int = 0
    index_through: str | None = None


class RefreshResult(BaseModel):
    ok: bool
    rows_saved: int
    errors: list[str]
    status: BenchmarkStatus
