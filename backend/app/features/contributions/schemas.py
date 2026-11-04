import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def validate_month(value: str) -> str:
    if not MONTH_PATTERN.match(value):
        raise ValueError("O mês deve estar no formato AAAA-MM.")
    return value


class CalculateIn(BaseModel):
    salary_cents: int = Field(ge=0)
    percent_bps: int = Field(ge=0, le=10_000)


class CalculateOut(BaseModel):
    calculated_cents: int


class PlanFields(CalculateIn):
    final_cents: int | None = Field(default=None, ge=0)
    # Parte do aporte que vai para a reserva; o restante é dividido entre as categorias.
    reserve_cents: int = Field(default=0, ge=0)
    mode: Literal["rebalance", "proportional"] = "rebalance"


class ContributionIn(PlanFields):
    month: str

    _check_month = field_validator("month")(validate_month)


class ContributionUpsert(PlanFields):
    pass


class PlanItemOut(BaseModel):
    class_key: str
    class_name: str
    color: str
    amount_cents: int


class ContributionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    month: str
    salary_cents: int
    percent_bps: int
    calculated_cents: int
    final_cents: int
    overridden: bool
    reserve_cents: int = 0
    mode: str | None = None
    plan_name: str | None = None
    # Divisão gravada ao salvar o aporte (vazia em aportes anteriores a esse recurso).
    plan: list[PlanItemOut] = []
    created_at: datetime | None = None
