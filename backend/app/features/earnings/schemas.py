import datetime as dt
from typing import Literal

from pydantic import BaseModel

MilestoneKey = Literal[
    "first_salary",
    "share_1",
    "share_5",
    "share_10",
    "share_25",
    "share_50",
    "share_100",
    "total_100",
    "total_1000",
    "total_10000",
    "total_100000",
]


class EarningsTotal(BaseModel):
    earned_cents: int  # tudo que o dinheiro rendeu, inclusive o que já vinha ao cadastrar
    before_tracking_cents: int  # ganho que os ativos já tinham quando foram cadastrados
    since_tracking_cents: int  # o que rendeu depois do cadastro (earned - before)
    uncredited_proventos_cents: int  # proventos que não entraram no saldo de nenhum ativo


class MonthEarningsOut(BaseModel):
    month: str  # AAAA-MM
    earned_cents: int  # appreciation_cents + proventos_cents
    appreciation_cents: int  # valorização dos ativos no mês, sem contar aportes
    proventos_cents: int  # só proventos não creditados (os creditados já estão na valorização)
    partial: bool  # mês corrente, medido só até `through`
    through: dt.date
    has_update: bool  # False: mês sem saldo digitado nem provento (não é "rendeu zero")
    salary_share_bps: int | None  # rendimento sobre o salário do mês; None sem salário
    # Último saldo digitado ou provento do mês (o rendimento só vale até ele); None sem atualização.
    measured_through: dt.date | None
    per_day_cents: int | None  # rendimento por dia (até `measured_through` no mês corrente)
    work_minutes: (
        int | None
    )  # minutos de trabalho equivalentes, pela jornada; None sem salário ou ganho


class PaceOut(BaseModel):
    per_day_cents: int
    basis_months: int  # quantos meses completos formam o ritmo (até 3)
    from_month: str
    to_month: str


class SalaryOut(BaseModel):
    salary_cents: int
    month: str  # mês de referência (o corrente); o valor pode vir de um aporte anterior


class VsSalaryOut(BaseModel):
    month: str  # último mês completo (ou o corrente, se ainda não houver um completo)
    earned_cents: int
    share_bps: int
    work_minutes: int | None  # minutos de trabalho equivalentes; None se o mês não rendeu


class MilestoneOut(BaseModel):
    key: MilestoneKey
    kind: Literal["first", "monthly_share", "total_amount"]
    threshold: int | None  # bps (monthly_share), centavos (total_amount), None (first)
    achieved_month: str | None


class NextMilestoneOut(BaseModel):
    key: MilestoneKey
    progress_bps: int  # 0 a 9.999


class EarningsOut(BaseModel):
    as_of: dt.date
    tracking_since: dt.date | None  # data do primeiro registro de valor; None sem ativos
    total: EarningsTotal
    current_month: MonthEarningsOut
    last_complete_month: MonthEarningsOut | None
    pace: PaceOut | None
    salary: SalaryOut | None
    vs_salary: VsSalaryOut | None
    months: list[MonthEarningsOut]  # até 12, do mais antigo ao corrente
    milestones: list[MilestoneOut]
    next_milestone: NextMilestoneOut | None
