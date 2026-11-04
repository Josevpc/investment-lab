import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.features.cash.domain import OPENING
from app.features.cash.models import Account, CashEntry


def list_accounts(session: Session, *, include_archived: bool = False) -> list[Account]:
    stmt = select(Account).order_by(Account.name)
    if not include_archived:
        stmt = stmt.where(Account.archived.is_(False))
    return list(session.scalars(stmt))


def get_account(session: Session, account_id: int) -> Account | None:
    return session.get(Account, account_id)


def accounts_named(session: Session, name: str) -> list[Account]:
    """Contas com esse nome, ignorando a caixa. Pode haver mais de uma em bancos antigos."""
    return list(
        session.scalars(
            select(Account).where(func.lower(Account.name) == name.lower()).order_by(Account.id)
        )
    )


def list_accounts_of_institution(session: Session, institution_id: int) -> list[Account]:
    stmt = select(Account).where(Account.institution_id == institution_id).order_by(Account.id)
    return list(session.scalars(stmt))


def get_entry(session: Session, entry_id: int) -> CashEntry | None:
    return session.get(CashEntry, entry_id)


def get_opening(session: Session, account_id: int) -> CashEntry | None:
    return session.scalar(
        select(CashEntry).where(CashEntry.account_id == account_id, CashEntry.kind == OPENING)
    )


def openings_by_account(session: Session) -> dict[int, dt.date]:
    rows = session.execute(
        select(CashEntry.account_id, CashEntry.date).where(CashEntry.kind == OPENING)
    )
    return {account_id: day for account_id, day in rows}


def list_entries(
    session: Session, account_id: int | None = None, *, kind: str | None = None
) -> list[CashEntry]:
    """Lançamentos em ordem cronológica (data, depois id), de uma conta ou de todas."""
    stmt = select(CashEntry).order_by(CashEntry.date, CashEntry.id)
    if account_id is not None:
        stmt = stmt.where(CashEntry.account_id == account_id)
    if kind is not None:
        stmt = stmt.where(CashEntry.kind == kind)
    return list(session.scalars(stmt))


def count_entries(session: Session, account_id: int) -> int:
    return int(
        session.scalar(
            select(func.count()).select_from(CashEntry).where(CashEntry.account_id == account_id)
        )
        or 0
    )


def entries_for_movement(session: Session, movement_id: int) -> list[CashEntry]:
    return list(
        session.scalars(
            select(CashEntry).where(CashEntry.movement_id == movement_id).order_by(CashEntry.id)
        )
    )


def entries_of_transfers(session: Session, transfer_ids: set[str]) -> list[CashEntry]:
    if not transfer_ids:
        return []
    return list(session.scalars(select(CashEntry).where(CashEntry.transfer_id.in_(transfer_ids))))


def asset_has_entries(session: Session, asset_id: int) -> bool:
    return (
        session.scalar(select(CashEntry.id).where(CashEntry.asset_id == asset_id).limit(1))
        is not None
    )


def balance(session: Session, account_id: int, as_of: dt.date) -> int:
    total = session.scalar(
        select(func.sum(CashEntry.amount_cents)).where(
            CashEntry.account_id == account_id, CashEntry.date <= as_of
        )
    )
    return int(total or 0)


def balances_by_account(session: Session, as_of: dt.date) -> dict[int, int]:
    """Saldo de cada conta ao fim de `as_of`: soma dos lançamentos até a data, inclusive."""
    rows = session.execute(
        select(CashEntry.account_id, func.sum(CashEntry.amount_cents))
        .where(CashEntry.date <= as_of)
        .group_by(CashEntry.account_id)
    )
    return {account_id: int(total) for account_id, total in rows}
