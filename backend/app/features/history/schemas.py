import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field


class SnapshotItemIn(BaseModel):
    """Valor de uma categoria numa data, digitado à mão."""

    class_key: str
    invested_cents: int = Field(ge=0)
    current_cents: int = Field(ge=0)


class SnapshotCreate(BaseModel):
    date: dt.date | None = None
    # Sem `items`, o snapshot é uma foto da carteira atual; com `items`, é digitado à mão.
    items: list[SnapshotItemIn] | None = None
    # Parte do patrimônio que estava na reserva de emergência (só no snapshot digitado).
    reserve_cents: int | None = Field(default=None, ge=0)
    # Quanto da reserva foi aporte. Sem ele, vale o valor atual (sem rendimento a mostrar).
    reserve_invested_cents: int | None = Field(default=None, ge=0)


class SnapshotUpdate(BaseModel):
    date: dt.date
    items: list[SnapshotItemIn] = Field(default_factory=list)
    reserve_cents: int = Field(default=0, ge=0)
    # Sem ele, a edição mantém o investido que o fechamento já tinha na reserva.
    reserve_invested_cents: int | None = Field(default=None, ge=0)


class SnapshotClassValue(BaseModel):
    class_id: int
    class_key: str
    class_name: str
    color: str
    archived: bool = False
    current_cents: int
    invested_cents: int


class SnapshotOut(BaseModel):
    id: int
    date: dt.date
    total_cents: int
    invested_cents: int
    assets_count: int
    manual: bool
    reserve_cents: int
    reserve_invested_cents: int  # parte do investido total que é da reserva (0 sem reserva)
    by_class: list[SnapshotClassValue]


class EvolutionPoint(BaseModel):
    date: dt.date
    total_cents: int
    invested_cents: int
    by_class: dict[str, int]
    reserve_cents: int


class EvolutionSummary(BaseModel):
    start_date: dt.date
    end_date: dt.date
    start_total_cents: int
    end_total_cents: int
    change_cents: int
    # Aportes do diário (por data) + planejado dos meses estimados + ativos novos.
    contributions_cents: int
    # Dinheiro que saiu dos ativos por resgate no período (>= 0): não é prejuízo.
    withdrawals_cents: int = 0
    # Saldo de ativos arquivados que deixou de somar no período (>= 0): saída, não prejuízo.
    archived_out_cents: int = 0
    # change_cents - contributions_cents + withdrawals_cents + archived_out_cents
    appreciation_cents: int
    # "diario": exato; "misto": parte do plano; "planejado": só o plano.
    contributions_source: Literal["diario", "misto", "planejado"] = "diario"
    estimated_months: list[str] = Field(default_factory=list)  # "YYYY-MM", crescente
    new_assets_cents: int = 0  # valor inicial dos ativos cadastrados no período (já em aportes)


class EvolutionClass(BaseModel):
    key: str
    name: str
    color: str
    archived: bool = False


class EvolutionOut(BaseModel):
    classes: list[EvolutionClass]
    points: list[EvolutionPoint]
    summary: EvolutionSummary | None
