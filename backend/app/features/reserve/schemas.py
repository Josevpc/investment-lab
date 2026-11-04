from typing import Literal

from pydantic import BaseModel, Field


class ReserveIn(BaseModel):
    goal_cents: int = Field(ge=0)
    months: int = Field(default=6, ge=1, le=60)
    monthly_cents: int = Field(default=0, ge=0)
    # "fixed": valor em reais por mês; "percent": parte do aporte do mês.
    monthly_mode: Literal["fixed", "percent"] = "fixed"
    percent_bps: int = Field(default=0, ge=0, le=10_000)


class ReserveAsset(BaseModel):
    id: int
    name: str
    institution_name: str
    current_cents: int


class ReserveOut(BaseModel):
    goal_cents: int
    months: int
    monthly_cents: int
    monthly_mode: str
    percent_bps: int
    balance_cents: int
    remaining_cents: int
    progress_bps: int  # 0 a 10.000, limitado a 100%
    reached: bool
    average_salary_cents: int | None
    salaries_considered: int
    suggested_goal_cents: int | None  # months x média dos salários registrados
    coverage_months: float | None  # saldo da reserva em meses de salário médio
    assets: list[ReserveAsset]
