import datetime as dt

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.errors import ConflictError
from app.core.money import MAX_CENTS
from app.features.cash import service
from app.features.cash.schemas import (
    AccountBalance,
    AccountCreate,
    AccountOut,
    AccountUpdate,
    AdjustmentIn,
    CashBalanceOut,
    CashTransferIn,
    CashTransferOut,
    ContributedCapitalOut,
    EntryIn,
    EntryOut,
    OpeningBalanceIn,
    ReconcileAdjustIn,
    ReconcileOut,
    StatementOut,
)
from app.features.portfolio import service as portfolio

router = APIRouter(tags=["cash"])


@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(include_archived: bool = False, session: Session = Depends(get_session)):
    return service.list_accounts(session, include_archived=include_archived)


@router.post("/accounts", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(data: AccountCreate, session: Session = Depends(get_session)):
    portfolio.require_institution(session, data.institution_id)
    return service.create_account(session, data)


@router.get("/accounts/{account_id}", response_model=AccountOut)
def get_account(account_id: int, session: Session = Depends(get_session)):
    return service.get_account(session, account_id)


@router.put("/accounts/{account_id}", response_model=AccountOut)
def update_account(account_id: int, data: AccountUpdate, session: Session = Depends(get_session)):
    # Arquivar esconde a conta; com ativo ligado a ela, o fechamento do mês e os proventos
    # desse ativo passariam a falhar.
    if data.archived and not service.get_account(session, account_id).archived:
        if portfolio.account_has_active_assets(session, account_id):
            raise ConflictError(
                "A conta ainda tem ativos. Mova-os para outra conta ou arquive-os antes."
            )
    return service.update_account(session, account_id, data)


@router.post(
    "/accounts/{account_id}/opening-balance",
    response_model=EntryOut,
    status_code=status.HTTP_201_CREATED,
)
def set_opening_balance(
    account_id: int, data: OpeningBalanceIn, session: Session = Depends(get_session)
):
    """Ativa o caixa da conta. Só vale uma vez; lançamentos antes dessa data são recusados."""
    return service.set_opening_balance(session, account_id, data)


@router.get("/accounts/{account_id}/balance", response_model=AccountBalance)
def account_balance(
    account_id: int, as_of: dt.date | None = None, session: Session = Depends(get_session)
):
    return service.account_balance(session, account_id, as_of)


@router.get("/accounts/{account_id}/entries", response_model=StatementOut)
def statement(
    account_id: int,
    start: dt.date | None = None,
    end: dt.date | None = None,
    session: Session = Depends(get_session),
):
    """Extrato da conta com o saldo corrente derivado, do mais recente ao mais antigo."""
    return service.statement(session, account_id, start=start, end=end)


@router.post(
    "/accounts/{account_id}/deposits", response_model=EntryOut, status_code=status.HTTP_201_CREATED
)
def add_deposit(account_id: int, data: EntryIn, session: Session = Depends(get_session)):
    return service.add_deposit(session, account_id, data)


@router.post(
    "/accounts/{account_id}/withdrawals",
    response_model=EntryOut,
    status_code=status.HTTP_201_CREATED,
)
def add_withdrawal(account_id: int, data: EntryIn, session: Session = Depends(get_session)):
    return service.add_withdrawal(session, account_id, data)


@router.post(
    "/accounts/{account_id}/fees", response_model=EntryOut, status_code=status.HTTP_201_CREATED
)
def add_fee(account_id: int, data: EntryIn, session: Session = Depends(get_session)):
    return service.add_fee(session, account_id, data)


@router.post(
    "/accounts/{account_id}/adjustments",
    response_model=EntryOut,
    status_code=status.HTTP_201_CREATED,
)
def add_adjustment(account_id: int, data: AdjustmentIn, session: Session = Depends(get_session)):
    return service.add_adjustment(session, account_id, data)


@router.get("/accounts/{account_id}/reconcile", response_model=ReconcileOut)
def reconcile(
    account_id: int,
    real_cents: int = Query(ge=0, le=MAX_CENTS),
    as_of: dt.date | None = None,
    session: Session = Depends(get_session),
):
    """Compara o caixa calculado com o saldo real. Só leitura."""
    return service.reconcile(session, account_id, real_cents, as_of)


@router.post(
    "/accounts/{account_id}/reconcile/adjustment",
    response_model=EntryOut,
    status_code=status.HTTP_201_CREATED,
)
def apply_reconciliation(
    account_id: int, data: ReconcileAdjustIn, session: Session = Depends(get_session)
):
    """Grava o ajuste da diferença. Exige `confirm: true`."""
    return service.apply_reconciliation(session, account_id, data)


@router.delete("/cash/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: int, session: Session = Depends(get_session)):
    service.delete_entry(session, entry_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/cash/transfers", response_model=CashTransferOut, status_code=status.HTTP_201_CREATED)
def transfer(data: CashTransferIn, session: Session = Depends(get_session)):
    return service.transfer(session, data)


@router.get("/cash/balance", response_model=CashBalanceOut)
def cash_balance(as_of: dt.date | None = None, session: Session = Depends(get_session)):
    """Caixa por conta e consolidado."""
    return service.cash_balance(session, as_of)


@router.get("/cash/contributed-capital", response_model=ContributedCapitalOut)
def contributed_capital(
    account_id: int | None = None,
    as_of: dt.date | None = None,
    start: dt.date | None = None,
    session: Session = Depends(get_session),
):
    """Capital aportado pelo ledger (depósitos - retiradas), por conta e consolidado."""
    return service.contributed_capital(session, account_id=account_id, as_of=as_of, start=start)
