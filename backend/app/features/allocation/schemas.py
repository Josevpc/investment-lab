from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class TargetIn(BaseModel):
    class_key: str
    percent_bps: int = Field(ge=0, le=10_000)


class PlanIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    targets: list[TargetIn]

    @field_validator("name")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("O nome não pode ficar vazio.")
        return value


class TargetOut(BaseModel):
    class_id: int
    class_key: str
    class_name: str
    color: str
    percent_bps: int


class PlanOut(BaseModel):
    id: int
    name: str
    is_active: bool
    created_at: datetime | None
    targets: list[TargetOut]


SplitMode = Literal["proportional", "rebalance"]


class SplitIn(BaseModel):
    amount_cents: int = Field(ge=0)
    plan_id: int | None = None
    mode: SplitMode = "proportional"
    # AAAA-MM: tira da carteira o que já foi aportado nesse mês, para a divisão não "andar"
    # conforme os aportes do mês são lançados.
    month: str | None = Field(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


HoldStatus = Literal["none", "partial", "all"]


class ReceivingAssetOut(BaseModel):
    """Ativo da categoria que pode receber aportes."""

    asset_id: int
    name: str


class HeldAssetOut(BaseModel):
    """Ativo em "manter posição": conta no valor da categoria, mas não recebe aportes."""

    asset_id: int
    name: str
    current_cents: int


class SplitItem(BaseModel):
    class_id: int
    class_key: str
    class_name: str
    color: str
    group_id: int | None  # só informativo: a divisão é por categoria, com ou sem grupo
    target_bps: int  # a meta gravada no plano
    effective_target_bps: int  # a que vale na conta; 0 na categoria com todos os ativos mantidos
    current_cents: int
    amount_cents: int  # o aporte da categoria; 0 quando todos os ativos estão mantidos
    hold_status: HoldStatus
    receiving_assets: list[ReceivingAssetOut]
    held_assets: list[HeldAssetOut]


class SplitOut(BaseModel):
    plan_id: int
    plan_name: str
    mode: SplitMode
    amount_cents: int
    items: list[SplitItem]


class ComparisonItem(BaseModel):
    class_id: int
    class_key: str
    class_name: str
    color: str
    group_id: int | None
    current_cents: int
    current_bps: int  # participação na carteira inteira, sempre
    target_bps: int  # a meta gravada no plano
    effective_target_bps: int  # a que vale na conta (reescalada se há categoria toda mantida)
    hold_status: HoldStatus
    diff_cents: int | None  # positivo = acima da meta; None quando todos os ativos estão mantidos
    held_assets: list[HeldAssetOut]


class GroupComparisonItem(BaseModel):
    """Soma das categorias de um grupo. Só apresentação: nada daqui entra na divisão do aporte."""

    group_id: int
    name: str
    color: str
    class_keys: list[str]
    current_cents: int
    current_bps: int  # recalculado do valor somado, sobre a carteira inteira sem a reserva
    target_bps: int  # soma das metas gravadas das categorias
    effective_target_bps: int  # soma das metas efetivas
    diff_cents: int | None  # soma das diferenças; None se todas as categorias estão "all"
    hold_status: HoldStatus  # derivado das categorias do grupo


class ComparisonOut(BaseModel):
    plan_id: int
    plan_name: str
    total_cents: int  # a carteira inteira
    base_cents: int  # a carteira sem as categorias com todos os ativos mantidos
    items: list[ComparisonItem]
    groups: list[GroupComparisonItem] = Field(default_factory=list)
