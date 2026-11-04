import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field


class TrajectoryIn(BaseModel):
    months: int = Field(default=24, ge=1, le=600)
    # Sem valor, usa o último aporte registrado.
    monthly_contribution_cents: int | None = Field(default=None, ge=0)
    mode: Literal["proportional", "rebalance"] = "rebalance"
    # A meta conta como atingida quando toda categoria está a esta distância dela.
    tolerance_bps: int = Field(default=100, ge=0, le=5000)


class TrajectoryClass(BaseModel):
    key: str
    name: str
    color: str
    group_id: int | None  # só informativo: a simulação é por categoria, com ou sem grupo
    target_bps: int  # a meta gravada no plano
    effective_target_bps: int  # a que vale na conta; 0 quando todos os ativos estão mantidos
    # "all": fora do cálculo de distância; "partial": o ativo mantido conta no valor da categoria.
    hold_status: Literal["none", "partial", "all"]


class TrajectoryPoint(BaseModel):
    month: int  # 0 = hoje
    total_cents: int
    values_cents: dict[str, int]
    shares_bps: dict[str, int]  # participação na carteira inteira
    # Participação dentro da base (sem as categorias "all"); é a medida das distâncias abaixo,
    # contra a meta efetiva. Só traz as categorias que não são "all".
    base_shares_bps: dict[str, int]


class TrajectoryOut(BaseModel):
    plan_id: int
    plan_name: str
    mode: Literal["proportional", "rebalance"]
    months: int
    # Quanto a simulação aportou por mês; 0 quando `all_held` (o valor pedido não foi usado).
    monthly_contribution_cents: int
    # Todas as categorias têm todos os ativos em "manter posição": ninguém recebe aporte.
    all_held: bool
    contribution_source: Literal["informed", "last_contribution", "none"]
    tolerance_bps: int
    months_to_target: int | None
    start_gap_bps: int
    end_gap_bps: int
    classes: list[TrajectoryClass]
    points: list[TrajectoryPoint]


class PerformancePoint(BaseModel):
    date: dt.date
    value_cents: int  # valor do escopo na data
    # Fluxo externo líquido desde o ponto anterior (+ entrou, - saiu); 0 na data-base.
    flows_cents: int
    portfolio_bps: int | None
    cdi_bps: int | None
    # Variação do Ibovespa (só pontos, sem dividendos) desde o ponto-base; None se faltar dado.
    ibovespa_bps: int | None = None


class PerformanceSummary(BaseModel):
    start_date: dt.date | None
    end_date: dt.date | None
    portfolio_bps: int | None
    cdi_bps: int | None
    vs_cdi_bps: int | None  # diferença em pontos-base de ponto percentual (100 = 1 p.p.)
    ibovespa_bps: int | None = None
    vs_ibovespa_bps: int | None = None  # carteira menos Ibovespa, em pontos-base de p.p.
    flows_cents: int = 0  # fluxo externo líquido de todo o período


class StaleAsset(BaseModel):
    """Ativo do escopo cujo último saldo digitado é antigo na data final do período."""

    asset_id: int
    asset_name: str
    last_observed_date: dt.date
    days: int


class PerformanceOut(BaseModel):
    scope: str
    scope_label: str
    include_reserve: bool
    observations_count: int  # datas com saldo digitado no período, para o escopo
    points: list[PerformancePoint]
    summary: PerformanceSummary
    method: str
    warnings: list[str]
    stale_assets: list[StaleAsset]
    benchmark_source: str
    benchmark_updated_at: dt.datetime | None
    # Último dia de CDI diário guardado; None se não há nenhum.
    cdi_covered_through: dt.date | None
    # Último fechamento do Ibovespa guardado (AAAA-MM-DD); None se não há nenhum.
    ibovespa_covered_through: str | None = None
    ibovespa_source: str | None = None  # cita a B3; None enquanto não há dado do Ibovespa


class AssetFlowOut(BaseModel):
    date: dt.date
    kind: Literal[
        "aporte", "transferencia_entrada", "transferencia_saida", "provento_creditado", "resgate"
    ]
    cents: int  # + entrada, - saída


class AssetStepOut(BaseModel):
    """Um intervalo entre dois saldos observados consecutivos dentro do período."""

    start_date: dt.date
    end_date: dt.date
    start_cents: int
    end_cents: int
    flows_cents: int
    yield_cents: int
    return_bps: int | None
    cdi_bps: int | None
    pct_of_cdi_bps: int | None  # 12000 = 120% do CDI


class AssetPerformanceOut(BaseModel):
    asset_id: int
    asset_name: str
    class_key: str
    asset_type: str | None
    indexer: str | None
    contracted_pct_bps: int | None  # só para ativos "CDI": a taxa contratada, em % do CDI
    # Os saldos digitados já vêm sem o IR: o % do CDI não é comparável ao de um ativo bruto.
    balance_is_net: bool
    dates: list[dt.date]  # datas com saldo observado (as opções de início e fim do período)
    start_date: dt.date | None
    end_date: dt.date | None
    start_cents: int | None
    end_cents: int | None
    flows: list[AssetFlowOut]
    flows_cents: int
    # Proventos pagos pelo ativo no período (dividendos, rendimentos de FIIs): não entram no saldo.
    proventos_cents: int
    yield_cents: int | None
    return_bps: int | None  # quanto R$ 1 aplicado no início rendeu no período
    cdi_bps: int | None  # CDI acumulado no mesmo período
    pct_of_cdi_bps: int | None  # 12000 = 120% do CDI
    vs_contracted_bps: int | None  # realizado menos contratado, em pontos-base de % do CDI
    steps: list[AssetStepOut]
    warnings: list[str]
    method: str
    cdi_covered_through: dt.date | None
    # Ibovespa ponto a ponto entre start_date e end_date; None para renda fixa ou sem dado.
    ibovespa_bps: int | None = None
    vs_ibovespa_bps: int | None = None  # return_bps menos ibovespa_bps
    ibovespa_covered_through: dt.date | None = None  # pregão usado no fim do período
