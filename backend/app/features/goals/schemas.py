from typing import Literal

from pydantic import BaseModel, Field, model_validator


class GoalSettingsIn(BaseModel):
    net_worth_goal_cents: int = Field(default=0, ge=0)
    year_goal_cents: int = Field(default=0, ge=0)
    monthly_cents: int = Field(default=0, ge=0)  # 0 = média dos últimos aportes
    horizon_years: int = Field(default=20, ge=1, le=50)
    inflation_bps: int = Field(default=450, ge=0, le=3_000)
    conservative_bps: int = Field(default=600, ge=0, le=5_000)
    base_bps: int = Field(default=900, ge=0, le=5_000)
    optimistic_bps: int = Field(default=1_200, ge=0, le=5_000)

    @model_validator(mode="after")
    def _scenarios_in_order(self):
        if not self.conservative_bps <= self.base_bps <= self.optimistic_bps:
            raise ValueError("Os retornos devem ir do conservador ao otimista, em ordem crescente.")
        return self


class GoalSettingsOut(GoalSettingsIn):
    pass


# ---- progresso -----------------------------------------------------------------------------


class StreakMonth(BaseModel):
    month: str
    state: Literal["met", "missed", "open"]


class StreakOut(BaseModel):
    current: int
    best: int
    current_month_met: bool
    months: list[StreakMonth]  # os últimos 12 meses, do mais antigo ao mais recente


class NetWorthProgress(BaseModel):
    current_cents: int
    goal_cents: int
    remaining_cents: int
    progress_bps: int  # 0 a 10.000, limitado a 100%
    reached: bool


class YearProgress(BaseModel):
    year: int
    goal_cents: int
    # "ok": há saldos digitados em duas datas para medir; "sem_base": faltam saldos em duas datas.
    status: Literal["ok", "sem_base"]
    baseline_date: str | None  # data de partida: o último saldo digitado do ano anterior, se houver
    last_date: str | None  # data mais recente do ano com saldo digitado
    accumulated_cents: int
    contributions_cents: int  # parte que veio de aportes
    # "diario": só aportes lançados; "misto"/"planejado": há meses que usaram o plano (estimativa).
    contributions_source: Literal["diario", "misto", "planejado"] = "diario"
    estimated_months: list[str] = Field(default_factory=list)  # "YYYY-MM", crescente
    # Resgates do período (>= 0). Já estão descontados em `accumulated_cents`; voltam à conta da
    # valorização para o dinheiro que saiu não parecer perda.
    withdrawals_cents: int = 0
    # Saldo de ativos arquivados que deixou de somar no ano (>= 0): saída, não prejuízo.
    archived_out_cents: int = 0
    # Valor inicial (>= 0) de ativos antigos trazidos para o app no ano. Já está contido em
    # `contributions_cents`; aparece à parte só para a tela explicar de onde veio o aporte.
    new_assets_cents: int = 0
    # accumulated_cents - contributions_cents + withdrawals_cents + archived_out_cents
    appreciation_cents: int
    remaining_cents: int
    progress_bps: int
    reached: bool


class PaceWindow(BaseModel):
    months: Literal[3, 6, 12]
    # Média dos meses da janela em que houve aporte; null se nenhum teve.
    average_cents: int | None
    months_with_data: int  # em quantos meses da janela houve aporte


class PaceSuggestion(BaseModel):
    window_months: int
    average_cents: int
    suggested_cents: int


class ContributionPace(BaseModel):
    """Quanto o usuário vem aportando por mês, frente à meta de aporte mensal."""

    reference_month: str  # último mês completo; o mês corrente fica de fora
    windows: list[PaceWindow]
    goal_cents: int  # a meta mensal de Metas; 0 = automática (média dos aportes)
    suggestion: PaceSuggestion | None  # só quando o ritmo passou da meta há tempo suficiente


class GoalsProgress(BaseModel):
    month: str
    streak: StreakOut
    net_worth: NetWorthProgress
    year: YearProgress
    contribution_pace: ContributionPace


# ---- projeção ------------------------------------------------------------------------------


class ProjectionPoint(BaseModel):
    month: str  # AAAA-MM do ponto
    nominal_cents: int
    today_cents: int  # o mesmo valor em poder de compra de hoje


class ProjectionScenario(BaseModel):
    key: Literal["conservador", "base", "otimista"]
    name: str
    annual_bps: int
    final_nominal_cents: int
    final_today_cents: int
    # Primeiro mês em que o patrimônio, em reais de hoje (descontada a inflação), alcança a meta.
    goal_month: str | None
    points: list[ProjectionPoint]  # um por ano, do ano 0 ao último


class ProjectionOut(BaseModel):
    start_month: str
    start_cents: int
    monthly_cents: int
    # "manual": definido em Metas; "media": média dos últimos aportes; "nenhum": sem aportes.
    monthly_source: Literal["manual", "media", "nenhum"]
    monthly_considered: int  # quantos aportes entraram na média
    horizon_years: int
    inflation_bps: int
    net_worth_goal_cents: int
    # Em que valores a meta é comparada para achar `goal_month`: "today" = reais de hoje.
    goal_basis: Literal["today"] = "today"
    contributed_cents: int  # soma dos aportes futuros ao longo do horizonte
    scenarios: list[ProjectionScenario]
