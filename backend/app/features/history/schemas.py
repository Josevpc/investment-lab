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
    # Só os ativos: o separado não entra aqui, nem em `invested_cents`, nem em `by_class`.
    total_cents: int
    invested_cents: int
    by_class: dict[str, int]
    reserve_cents: int
    # Dinheiro separado para comprar, em aberto nessa data, e por categoria (só as que tinham).
    # `net_worth_cents` = total_cents + reserved_cents.
    reserved_cents: int = 0
    reserved_by_class: dict[str, int] = Field(default_factory=dict)
    net_worth_cents: int = 0


class EvolutionSummary(BaseModel):
    start_date: dt.date
    end_date: dt.date
    # Patrimônio com o separado (`net_worth_cents` do 1º e do último ponto): é o total que a tela
    # mostra. Sem dinheiro separado, é igual ao total dos ativos.
    start_total_cents: int
    end_total_cents: int
    change_cents: int
    # Aportes do diário (por data) + planejado dos meses estimados + ativos novos + dinheiro
    # separado no período - o que as compras gastaram dele (isso já entrou como valor do ativo).
    contributions_cents: int
    # Dinheiro que saiu dos ativos por resgate no período (>= 0): não é prejuízo.
    withdrawals_cents: int = 0
    # Separado devolvido ao caixa livre no período (>= 0): saiu do patrimônio, não é prejuízo.
    released_cents: int = 0
    # Saldo de ativos arquivados que deixou de somar no período (>= 0): saída, não prejuízo.
    archived_out_cents: int = 0
    # change_cents - contributions_cents + withdrawals_cents + released_cents + archived_out_cents.
    # Não muda com o dinheiro separado: é a valorização dos ativos.
    appreciation_cents: int
    # "diario": exato; "misto": parte do plano; "planejado": só o plano.
    contributions_source: Literal["diario", "misto", "planejado"] = "diario"
    estimated_months: list[str] = Field(default_factory=list)  # "YYYY-MM", crescente
    new_assets_cents: int = 0  # valor inicial dos ativos cadastrados no período (já em aportes)


class MonthContribution(BaseModel):
    month: str  # "YYYY-MM"
    # Aporte do mês: o mesmo total do resumo do mês (inclui fora da meta e ativos novos).
    contributed_cents: int
    goal_cents: int  # parte que conta na meta
    off_goal_cents: int  # parte marcada "fora da meta"; goal_cents + off_goal_cents = contributed
    # Saldo de ativos antigos que apareceu neste mês (investido da 1ª valorização). Fica à parte:
    # não é aporte do mês e não entra em `contributed_cents`.
    carried_in_cents: int
    planned_cents: int | None  # aporte planejado do mês; None quando não há plano
    in_progress: bool  # só o mês atual: o valor ainda pode crescer


class ContributionsByMonthOut(BaseModel):
    from_month: str
    to_month: str
    current_month: str
    months: list[MonthContribution]  # um por mês do intervalo, em ordem crescente


class EvolutionClass(BaseModel):
    key: str
    name: str
    color: str
    archived: bool = False


class EvolutionOut(BaseModel):
    classes: list[EvolutionClass]
    points: list[EvolutionPoint]
    summary: EvolutionSummary | None
