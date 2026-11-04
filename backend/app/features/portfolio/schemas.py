import datetime as dt
import re
from decimal import Decimal, InvalidOperation
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.money import MAX_CENTS
from app.features.portfolio.domain import purchase_amount_cents

Indexer = Literal["CDI", "IPCA", "PRE", "SELIC", "OUTRO"]
Purpose = Literal["reserva"]
AssetType = Literal["acao", "etf", "fii"]
FiiSegment = Literal["papel", "tijolo"]
MovementKind = Literal["aporte", "provento", "transferencia", "resgate"]
NOTE_MAX_LENGTH = 120


def _clean_note(value):
    """Motivo do resgate: aparado antes de medir o tamanho; vazio vira nulo."""
    if isinstance(value, str):
        return value.strip() or None
    return value


class AssetClassOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    name: str
    color: str
    archived: bool = False
    group_id: int | None = None


COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"


def _clean_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("O nome não pode ficar vazio.")
    return value


class AssetClassCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    color: str | None = Field(default=None, pattern=COLOR_PATTERN)
    group_id: int | None = None

    _clean = field_validator("name")(_clean_name)


class AssetClassUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    color: str = Field(pattern=COLOR_PATTERN)
    archived: bool = False
    # Omitido: mantém o grupo atual. `null`: tira a categoria do grupo.
    group_id: int | None = None

    _clean = field_validator("name")(_clean_name)


class AssetGroupOut(BaseModel):
    id: int
    name: str
    color: str
    archived: bool = False
    # Categorias ativas dentro do grupo.
    class_ids: list[int]


class AssetGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    color: str | None = Field(default=None, pattern=COLOR_PATTERN)

    _clean = field_validator("name")(_clean_name)


class AssetGroupUpdate(BaseModel):
    """Campos omitidos ficam como estão."""

    name: str | None = Field(default=None, min_length=1, max_length=40)
    color: str | None = Field(default=None, pattern=COLOR_PATTERN)
    archived: bool | None = None

    @field_validator("name")
    @classmethod
    def _clean(cls, value: str | None) -> str | None:
        return None if value is None else _clean_name(value)


class InstitutionIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("O nome não pode ficar vazio.")
        return value


class InstitutionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class _AssetFields(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    class_key: str
    institution_id: int
    ticker: str | None = Field(default=None, max_length=20)
    indexer: Indexer | None = None
    rate_bps: int | None = Field(default=None, ge=0)
    maturity_date: dt.date | None = None
    quantity: str | None = Field(default=None, max_length=40)
    purpose: Purpose | None = None
    asset_type: AssetType | None = None
    fii_segment: FiiSegment | None = None
    # Conta do ativo. Omitida: a conta da instituição (criada junto com ela). Na edição, omitida
    # mantém a conta atual.
    account_id: int | None = None

    @field_validator("quantity")
    @classmethod
    def _quantity_is_decimal(cls, value: str | None) -> str | None:
        if value is None or value.strip() == "":
            return None
        try:
            if Decimal(value.strip()) < 0:
                raise ValueError("A quantidade não pode ser negativa.")
        except InvalidOperation as exc:
            raise ValueError("A quantidade deve ser um número decimal.") from exc
        return value.strip()

    @field_validator("ticker")
    @classmethod
    def _ticker_upper(cls, value: str | None) -> str | None:
        if value is None or value.strip() == "":
            return None
        return value.strip().upper()

    @model_validator(mode="after")
    def _fii_segment_rules(self):
        """Papel/tijolo existe só para fundos imobiliários, e todo FII precisa dele."""
        if self.asset_type == "fii" and self.fii_segment is None:
            raise ValueError("Informe se o fundo imobiliário é de papel ou de tijolo.")
        if self.asset_type != "fii" and self.fii_segment is not None:
            raise ValueError("Papel ou tijolo vale só para fundos imobiliários.")
        return self


class AssetCreate(_AssetFields):
    # "Manter posição": o ativo não recebe aportes novos, mas conta no valor da categoria.
    hold_only: bool = False
    # O saldo digitado já vem sem o IR (padrão: bruto).
    balance_is_net: bool = False
    # Ativo NOVO: o investido do cadastro é dinheiro que entrou agora e vira um aporte (inicial) no
    # diário. Falso: ativo que você já tinha, o valor entra só como ponto de partida.
    is_new_investment: bool = False
    # Sem valor investido, assume-se igual ao atual: a rentabilidade conta a partir de hoje.
    invested_cents: int | None = Field(default=None, ge=0)
    current_cents: int = Field(ge=0)
    valuation_date: dt.date | None = None


class AssetUpdate(_AssetFields):
    archived: bool = False
    # Omitido (ou null) mantém a marca atual; true/false a altera. Assim editar outro campo sem
    # enviar a marca não a apaga.
    hold_only: bool | None = None
    # Omitido (ou null) mantém a marca de saldo líquido atual.
    balance_is_net: bool | None = None
    # Omitido (ou null) mantém a marca de ativo novo; true/false cria ou remove o aporte inicial.
    is_new_investment: bool | None = None


class ValuationIn(BaseModel):
    date: dt.date | None = None
    invested_cents: int = Field(ge=0)
    current_cents: int = Field(ge=0)


class ValuationUpdate(BaseModel):
    """Correção de um registro do histórico de valores de um ativo."""

    date: dt.date
    invested_cents: int = Field(ge=0)
    current_cents: int = Field(ge=0)


class ValuationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    asset_id: int
    date: dt.date
    invested_cents: int
    current_cents: int
    observed: bool = True


class BalanceIn(BaseModel):
    """Fechamento do mês de um ativo: saldo atual e, se houve, o aporte do mês."""

    date: dt.date | None = None
    balance_cents: int = Field(ge=0)  # saldo mostrado no extrato, já com o aporte
    contribution_cents: int = Field(default=0, ge=0)  # dinheiro novo depositado
    # Dia em que o aporte foi feito (padrão: a data do saldo). Entra no cálculo do % do CDI.
    contribution_date: dt.date | None = None
    invested_cents: int | None = Field(default=None, ge=0)  # só para corrigir o investido
    # Só para contas com caixa ativado. Falso (padrão): o aporte é dinheiro novo, vira depósito
    # + compra no caixa. Verdadeiro: o aporte sai do caixa que já está na conta (só a compra).
    use_cash: bool = False
    # Moedas compradas no aporte (cripto): somam à quantidade do ativo (até 8 casas).
    quantity_added: str | None = Field(default=None, max_length=40)

    @field_validator("quantity_added")
    @classmethod
    def _quantity_added_is_positive_decimal(cls, value: str | None) -> str | None:
        if value is None or value.strip() == "":
            return None
        text = value.strip()
        if not re.fullmatch(r"\d{1,20}(\.\d{1,8})?", text) or Decimal(text) <= 0:
            raise ValueError(
                "A quantidade comprada deve ser um número maior que zero, com até 8 casas."
            )
        return text


class TransferIn(BaseModel):
    from_asset_id: int
    to_asset_id: int
    amount_cents: int = Field(gt=0)
    date: dt.date | None = None


class ProventoIn(BaseModel):
    asset_id: int
    amount_cents: int = Field(gt=0)
    date: dt.date | None = None
    # Ativo que recebeu o dinheiro (ex.: saldo em conta da corretora). Opcional.
    credited_asset_id: int | None = None


class RedemptionIn(BaseModel):
    """Resgate: dinheiro que sai de um ativo (para a conta bancária, por exemplo)."""

    asset_id: int
    amount_cents: int = Field(gt=0, le=MAX_CENTS)
    date: dt.date | None = None
    # Motivo livre, só para lembrar depois. Opcional.
    note: str | None = Field(default=None, max_length=NOTE_MAX_LENGTH)
    # Só para contas com caixa ativado: o valor resgatado entra no caixa da conta (uma "venda").
    # Falso (padrão): o dinheiro saiu da carteira e o caixa não muda.
    credit_cash: bool = False
    # O saldo que você digitou do extrato já está sem esse dinheiro: o resgate só tira o custo do
    # investido e não mexe no saldo. Falso (padrão): tira valor e custo do saldo atual.
    already_in_balance: bool = False

    _clean_note = field_validator("note", mode="before")(_clean_note)


class PurchaseIn(BaseModel):
    """Compra de um ativo com o caixa da conta dele: informe o valor, ou quantidade e preço."""

    asset_id: int
    date: dt.date | None = None
    amount_cents: int | None = Field(default=None, gt=0, le=MAX_CENTS)
    quantity: str | None = Field(default=None, max_length=40)
    unit_price_cents: int | None = Field(default=None, gt=0, le=MAX_CENTS)
    # Atalho para caixa insuficiente: grava um depósito desse valor antes da compra.
    deposit_cents: int | None = Field(default=None, gt=0, le=MAX_CENTS)

    @field_validator("quantity")
    @classmethod
    def _quantity_is_positive_decimal(cls, value: str | None) -> str | None:
        if value is None or value.strip() == "":
            return None
        try:
            number = Decimal(value.strip())
        except InvalidOperation as exc:
            raise ValueError("A quantidade deve ser um número decimal.") from exc
        if not number.is_finite() or number <= 0:
            raise ValueError("A quantidade deve ser maior que zero.")
        if number.adjusted() > 15 or len(number.as_tuple().digits) > 30:
            raise ValueError("A quantidade é grande demais.")
        return value.strip()

    @model_validator(mode="after")
    def _one_way_to_give_the_amount(self):
        by_quantity = self.quantity is not None or self.unit_price_cents is not None
        if (self.amount_cents is not None) == by_quantity:
            raise ValueError("Informe o valor da compra ou então a quantidade e o preço unitário.")
        if by_quantity and (self.quantity is None or self.unit_price_cents is None):
            raise ValueError("Informe a quantidade e o preço unitário.")
        if not 0 < self.resolved_amount_cents() <= MAX_CENTS:
            raise ValueError("O valor da compra deve ficar entre R$ 0,01 e R$ 100 bilhões.")
        return self

    def resolved_amount_cents(self) -> int:
        """Valor da compra em centavos; quantidade x preço arredonda meio para cima."""
        if self.amount_cents is not None:
            return self.amount_cents
        return purchase_amount_cents(Decimal(self.quantity or "0"), self.unit_price_cents or 0)


class MovementUpdate(BaseModel):
    """Correção de um movimento já lançado: o valor, a data e, nos resgates, o motivo."""

    amount_cents: int | None = Field(default=None, gt=0)
    date: dt.date | None = None
    # Só vale em resgate. Enviado (mesmo vazio ou nulo), troca ou apaga o motivo; omitido, mantém.
    note: str | None = Field(default=None, max_length=NOTE_MAX_LENGTH)

    _clean_note = field_validator("note", mode="before")(_clean_note)

    @model_validator(mode="after")
    def _something_to_change(self):
        if self.amount_cents is None and self.date is None and "note" not in self.model_fields_set:
            raise ValueError("Informe o novo valor, a nova data ou o motivo.")
        return self


class MovementOut(BaseModel):
    id: int
    date: dt.date
    kind: MovementKind
    asset_id: int
    asset_name: str
    related_asset_id: int | None
    related_asset_name: str | None
    amount_cents: int
    cost_cents: int | None
    initial: bool = False  # aporte inicial de um ativo novo: só registro, não mexe em saldos
    note: str | None = None  # motivo do resgate (só resgates têm)
    # Resgate cujo saldo digitado já veio sem o dinheiro: só o custo saiu do investido.
    in_balance: bool = False


class WithdrawalOut(BaseModel):
    """Um resgate no Registro de retiradas, já com o contexto da reserva de emergência."""

    movement_id: int
    date: dt.date
    # Primeira data em que os saldos já mostram o resgate; None = nenhum saldo digitado ainda.
    effective_date: dt.date | None
    asset_id: int
    asset_name: str
    institution_name: str
    asset_archived: bool
    amount_cents: int
    cost_cents: int
    note: str | None
    in_balance: bool
    # Vale a finalidade que o ativo tem hoje, não a que tinha no dia do resgate.
    from_reserve: bool
    # Total da reserva na data efetiva, depois do resgate. None fora da reserva ou sem data efetiva.
    reserve_balance_after_cents: int | None
    # Quanto faltava para a meta nesse saldo (0 se já atingida). None sem meta, fora da reserva ou
    # sem data efetiva.
    reserve_below_goal_cents: int | None


class WithdrawalsOut(BaseModel):
    items: list[WithdrawalOut]
    # Os três totais seguem o filtro de ano; `years` não (lista os anos com resgate, do mais novo).
    total_cents: int
    count: int
    reserve_total_cents: int
    years: list[int]


class PurchaseOut(BaseModel):
    movement: MovementOut
    account_id: int
    deposit_cents: int  # depósito gravado junto (0 se não houve)
    cash_balance_cents: int  # caixa da conta ao fim do dia da compra


class ClassMonthAmount(BaseModel):
    class_key: str
    class_name: str
    color: str
    amount_cents: int


class NewAssetAmount(BaseModel):
    asset_id: int
    asset_name: str
    amount_cents: int


class MonthSummary(BaseModel):
    month: str
    by_class: list[ClassMonthAmount]
    reserve_cents: int
    # registered_cents (aportes lançados) + new_assets_cents (aportes iniciais de ativos novos).
    # O total, as categorias e a reserva já incluem os dois.
    total_cents: int
    registered_cents: int
    new_assets_cents: int
    new_assets: list[NewAssetAmount]
    proventos_cents: int
    # Resgates do mês (dinheiro que saiu dos ativos). Não abatem o total acima: ele só soma aportes.
    redemptions_cents: int = 0


class AssetOut(BaseModel):
    id: int
    name: str
    ticker: str | None
    class_key: str
    class_name: str
    institution_id: int
    institution_name: str
    indexer: str | None
    rate_bps: int | None
    maturity_date: dt.date | None
    quantity: str | None
    archived: bool
    purpose: Purpose | None
    asset_type: AssetType | None
    fii_segment: FiiSegment | None
    account_id: int | None
    hold_only: bool  # manter posição: não recebe aportes novos
    balance_is_net: bool  # o saldo digitado já vem com o IR descontado
    # Ativo novo: tem aporte inicial no diário (valor e data dele; nulos se o ativo é antigo).
    is_new_investment: bool
    initial_contribution_cents: int | None
    initial_contribution_date: dt.date | None
    invested_cents: int
    current_cents: int
    gain_cents: int  # rendimento: atual - investido
    return_bps: int | None
    proventos_cents: int  # proventos recebidos (FIIs, dividendos)
    total_return_bps: int | None  # inclui proventos
    valuation_date: dt.date


class ClassBreakdown(BaseModel):
    class_id: int
    class_key: str
    class_name: str
    color: str
    current_cents: int
    invested_cents: int
    share_bps: int


class GroupBreakdown(BaseModel):
    """Participação de um grupo de categorias; categoria sem grupo não aparece aqui."""

    group_id: int
    name: str
    color: str
    current_cents: int
    invested_cents: int
    share_bps: int


class InstitutionBreakdown(BaseModel):
    institution_id: int
    institution_name: str
    current_cents: int
    invested_cents: int
    share_bps: int


class TypeBreakdown(BaseModel):
    """Participação de um tipo de ativo (ação, ETF, FII) entre os ativos que têm tipo."""

    asset_type: AssetType
    label: str
    assets_count: int
    current_cents: int
    invested_cents: int
    share_bps: int


class FiiSegmentBreakdown(BaseModel):
    """Papel x tijolo dentro dos fundos imobiliários."""

    segment: Literal["papel", "tijolo", "sem_segmento"]
    label: str
    assets_count: int
    current_cents: int
    invested_cents: int
    proventos_cents: int
    share_bps: int


class PortfolioSummary(BaseModel):
    # Totais incluem a reserva de emergência; `by_class`, `by_type` e as participações cobrem
    # só os investimentos.
    total_current_cents: int
    total_invested_cents: int
    return_bps: int | None
    assets_count: int
    investments_current_cents: int
    reserve_current_cents: int
    reserve_invested_cents: int
    proventos_cents: int
    # Caixa das contas (hoje), à parte dos totais acima: eles seguem só com os ativos, para não
    # diluir a rentabilidade. `total_with_cash_cents` = total_current_cents + cash_cents.
    cash_cents: int
    total_with_cash_cents: int
    by_class: list[ClassBreakdown]
    # Só apresentação: os grupos somam as categorias deles (a reserva fica de fora, como em
    # `by_class`).
    by_group: list[GroupBreakdown] = Field(default_factory=list)
    by_type: list[TypeBreakdown]
    fii_segments: list[FiiSegmentBreakdown]
    # Ativos de renda variável ainda sem tipo definido (para o usuário completar o cadastro).
    untyped_count: int
    untyped_current_cents: int
    by_institution: list[InstitutionBreakdown]


class PositionOut(BaseModel):
    """Posição atual de um ativo ativo; é a interface que outras features consomem."""

    asset_id: int
    class_id: int
    class_key: str
    is_reserve: bool
    invested_cents: int
    current_cents: int


class ValuationPoint(BaseModel):
    """Um registro do histórico de valores de um ativo (interface para o cálculo de rendimento)."""

    asset_id: int
    date: dt.date
    invested_cents: int
    current_cents: int
    observed: bool


class ProventoPoint(BaseModel):
    """Um provento recebido; `credited` diz se o valor já entrou no saldo de algum ativo."""

    date: dt.date
    amount_cents: int
    credited: bool


class RedemptionPoint(BaseModel):
    """Um resgate e a data em que ele passa a aparecer nas linhas de valor do ativo.

    `date` é a do resgate; nos que já vinham no saldo digitado é a do primeiro saldo digitado
    depois do resgate (antes dela as linhas ainda não mudaram). O ganho realizado (valor menos
    custo) saiu do ganho do ativo a partir dessa data.
    """

    asset_id: int
    date: dt.date
    amount_cents: int
    cost_cents: int


class ValueHistory(BaseModel):
    """Valores e proventos dos ativos não arquivados, para quem mede o rendimento no tempo."""

    valuations: list[ValuationPoint]
    proventos: list[ProventoPoint]
    redemptions: list[RedemptionPoint] = Field(default_factory=list)
