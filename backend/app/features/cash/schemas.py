import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.core.money import MAX_CENTS

EntryKind = Literal[
    "saldo_inicial",
    "deposito",
    "provento",
    "compra",
    "venda",
    "taxa",
    "retirada",
    "ajuste",
    "transferencia",
]


def _clean_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("O nome não pode ficar vazio.")
    return value


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    institution_id: int

    _clean = field_validator("name")(_clean_name)


class AccountUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    archived: bool | None = None  # omitido: mantém o valor atual (renomear não desarquiva)

    _clean = field_validator("name")(_clean_name)


class AccountOut(BaseModel):
    id: int
    name: str
    institution_id: int
    archived: bool
    cash_enabled: bool  # tem saldo inicial: o caixa da conta está ativado
    opening_date: dt.date | None
    balance_cents: int  # saldo de hoje (0 se o caixa não está ativado)
    reserved_cents: int  # parte do saldo separada para comprar uma categoria
    free_cents: int  # balance_cents - reserved_cents: o que ainda não tem destino


class OpeningBalanceIn(BaseModel):
    date: dt.date
    amount_cents: int = Field(ge=0, le=MAX_CENTS)


class EntryIn(BaseModel):
    """Depósito, retirada ou taxa: o valor é sempre positivo, o tipo decide o sentido."""

    date: dt.date | None = None
    amount_cents: int = Field(gt=0, le=MAX_CENTS)


class AdjustmentIn(BaseModel):
    """Ajuste manual: valor com sinal (+ sobra no caixa, - falta), nunca zero."""

    date: dt.date | None = None
    amount_cents: int = Field(ge=-MAX_CENTS, le=MAX_CENTS)

    @field_validator("amount_cents")
    @classmethod
    def _not_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("O valor do ajuste não pode ser zero.")
        return value


class CashTransferIn(BaseModel):
    from_account_id: int
    to_account_id: int
    amount_cents: int = Field(gt=0, le=MAX_CENTS)
    date: dt.date | None = None


class EntryOut(BaseModel):
    id: int
    account_id: int
    date: dt.date
    kind: EntryKind
    amount_cents: int  # com sinal
    asset_id: int | None
    movement_id: int | None
    transfer_id: str | None
    counterpart_account_id: int | None  # só em transferência: a outra conta
    balance_cents: int  # saldo da conta logo depois deste lançamento (data, depois id)
    # Pode ser removido por DELETE /cash/entries/{id}; senão, desfaça o movimento que o gerou.
    deletable: bool


class StatementOut(BaseModel):
    account_id: int
    balance_cents: int  # saldo ao fim de `end` (ou de hoje)
    entries: list[EntryOut]  # do mais recente para o mais antigo


class CashTransferOut(BaseModel):
    transfer_id: str
    date: dt.date
    amount_cents: int
    from_entry: EntryOut
    to_entry: EntryOut


class AccountBalance(BaseModel):
    account_id: int
    name: str
    archived: bool
    cash_enabled: bool
    balance_cents: int
    reserved_cents: int
    free_cents: int


class CashBalanceOut(BaseModel):
    as_of: dt.date
    total_cents: int
    accounts: list[AccountBalance]


class ReconcileOut(BaseModel):
    account_id: int
    as_of: dt.date
    calculated_cents: int
    real_cents: int
    difference_cents: int  # real - calculado


class ReconcileAdjustIn(BaseModel):
    real_cents: int = Field(ge=0, le=MAX_CENTS)
    as_of: dt.date | None = None
    confirm: bool = False  # só grava o ajuste com a confirmação explícita


class AccountCapital(BaseModel):
    account_id: int
    name: str
    contributed_cents: int


class ContributedCapitalOut(BaseModel):
    as_of: dt.date
    start: dt.date | None
    deposits_cents: int
    withdrawals_cents: int
    contributed_cents: int  # depósitos - retiradas
    by_account: list[AccountCapital]


# ---- dinheiro separado para comprar ----------------------------------------------------------


class ReservationIn(BaseModel):
    class_id: int
    amount_cents: int = Field(gt=0, le=MAX_CENTS)
    date: dt.date | None = None  # omitida: hoje
    # Dinheiro novo: grava antes um depósito avulso do mesmo valor e separa em seguida.
    deposit: bool = False


class ReleaseIn(BaseModel):
    amount_cents: int | None = Field(default=None, gt=0, le=MAX_CENTS)  # omitido: todo o restante
    date: dt.date | None = None


class ReservationOut(BaseModel):
    id: int
    account_id: int
    class_id: int
    class_name: str
    date: dt.date
    amount_cents: int
    used_cents: int  # já virou ativo (compras)
    released_cents: int  # voltou ao caixa livre
    remaining_cents: int  # amount - used - released
    deletable: bool  # sem uso nem liberação: pode ser excluída (correção de digitação)


class ReservationResult(ReservationOut):
    """A separação depois da operação, mais o caixa novo da conta (o saldo não muda ao separar)."""

    balance_cents: int
    reserved_cents: int
    free_cents: int


class ClassReserved(BaseModel):
    class_id: int
    class_name: str
    color: str
    remaining_cents: int


class ReservationsOut(BaseModel):
    reserved_cents: int
    free_cents: int
    by_class: list[ClassReserved]
    reservations: list[ReservationOut]  # da mais antiga à mais nova (ordem de consumo)
