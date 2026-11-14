"""Serviço do caixa (ledger por conta).

O saldo nunca é gravado: é a soma dos lançamentos (`cash_entry`) até uma data. Interface pública
para outras features: `default_account_id`, `create_institution_account`, `get_account`,
`rename_institution_accounts`, `drop_institution_accounts`, `asset_has_entries`, `opening_date`,
`consolidated_cash_cents`, `contributed_capital`, `reserved_left`, `reserved_in_class`,
`reserved_by_class`, `reserved_by_class_on`, `reserve_flows_in_period`, `separated_by_month`,
`reserved_used_by_movement` e as funções `stage_*`.

Dinheiro separado para comprar: o caixa continua sendo a soma dos lançamentos; a separação só marca
quanto dele já tem destino (`reserved_cents`), e o resto é o caixa livre (`free_cents`). Nenhuma
operação do caixa pode deixar o separado maior que o saldo, em dia nenhum.

As funções `stage_*` gravam na sessão sem confirmar: quem chama junta o lançamento do caixa com a
operação da carteira e confirma tudo numa transação só (ou desfaz tudo).
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable, Iterator, Sequence
from contextlib import contextmanager
from datetime import date
from typing import NamedTuple, Protocol

from sqlalchemy.orm import Session

from app.core.errors import ConflictError, InvalidInputError, NotFoundError
from app.core.money import format_brl, format_date
from app.features.cash import domain
from app.features.cash import repository as repo
from app.features.cash.domain import NewEntry
from app.features.cash.models import Account, CashEntry, CashReservation, CashReservationUse
from app.features.cash.schemas import (
    AccountBalance,
    AccountCapital,
    AccountCreate,
    AccountOut,
    AccountUpdate,
    AdjustmentIn,
    CashBalanceOut,
    CashTransferIn,
    CashTransferOut,
    ClassReserved,
    ContributedCapitalOut,
    EntryIn,
    EntryOut,
    OpeningBalanceIn,
    ReconcileAdjustIn,
    ReconcileOut,
    ReleaseIn,
    ReservationIn,
    ReservationOut,
    ReservationResult,
    ReservationsOut,
    StatementOut,
)


@contextmanager
def _atomic(session: Session) -> Iterator[None]:
    """Confirma ao final ou desfaz tudo: nenhuma operação do caixa grava pela metade."""
    try:
        yield
        session.commit()
    except Exception:
        session.rollback()
        raise


# ---- contas --------------------------------------------------------------------------------


def _require_account(session: Session, account_id: int) -> Account:
    account = repo.get_account(session, account_id)
    if account is None:
        raise NotFoundError("Conta não encontrada.")
    return account


def _account_out(
    account: Account, opening: date | None, balance_cents: int, reserved_cents: int
) -> AccountOut:
    return AccountOut(
        id=account.id,
        name=account.name,
        institution_id=account.institution_id,
        archived=account.archived,
        cash_enabled=opening is not None,
        opening_date=opening,
        balance_cents=balance_cents,
        reserved_cents=reserved_cents,
        free_cents=balance_cents - reserved_cents,
    )


def list_accounts(session: Session, *, include_archived: bool = False) -> list[AccountOut]:
    day = date.today()
    openings = repo.openings_by_account(session)
    balances = repo.balances_by_account(session, day)
    reserved = _reserved_by_account(session, day)
    return [
        _account_out(a, openings.get(a.id), balances.get(a.id, 0), reserved.get(a.id, 0))
        for a in repo.list_accounts(session, include_archived=include_archived)
    ]


def get_account(session: Session, account_id: int) -> AccountOut:
    account = _require_account(session, account_id)
    opening = repo.get_opening(session, account_id)
    today = date.today()
    return _account_out(
        account,
        opening.date if opening else None,
        repo.balance(session, account_id, today),
        _reserved_cents(session, account_id, today),
    )


def _check_name_free(session: Session, name: str, *, except_id: int | None = None) -> None:
    if any(a.id != except_id for a in repo.accounts_named(session, name)):
        raise ConflictError("Já existe uma conta com esse nome.")


def create_account(session: Session, data: AccountCreate) -> AccountOut:
    """Conta nova numa instituição que já existe (quem chama confere a instituição)."""
    _check_name_free(session, data.name)
    account = Account(name=data.name, institution_id=data.institution_id, archived=False)
    session.add(account)
    session.commit()
    return get_account(session, account.id)


def update_account(session: Session, account_id: int, data: AccountUpdate) -> AccountOut:
    account = _require_account(session, account_id)
    if data.name != account.name:  # manter o nome atual nunca é conflito
        _check_name_free(session, data.name, except_id=account_id)
    archived = account.archived if data.archived is None else data.archived
    if archived and not account.archived:
        balance = repo.balance(session, account_id, date.max)
        if balance != 0:
            raise ConflictError(
                f"A conta ainda tem {format_brl(balance)} em caixa. Transfira ou retire o "
                "dinheiro antes de arquivar."
            )
    account.name = data.name
    account.archived = archived
    session.commit()
    return get_account(session, account_id)


def _unique_account_name(session: Session, base: str) -> str:
    name, n = base, 2
    while repo.accounts_named(session, name):
        name = f"{base} ({n})"
        n += 1
    return name


def create_institution_account(session: Session, institution_id: int, institution_name: str) -> int:
    """Conta que nasce junto com a instituição (mesmo nome). Não confirma a transação."""
    account = Account(
        name=_unique_account_name(session, institution_name),
        institution_id=institution_id,
        archived=False,
    )
    session.add(account)
    session.flush()
    return account.id


def default_account_id(session: Session, institution_id: int, institution_name: str) -> int:
    """Conta padrão da instituição (a mais antiga ativa); cria uma se não houver. Não confirma."""
    for account in repo.list_accounts_of_institution(session, institution_id):
        if not account.archived:
            return account.id
    return create_institution_account(session, institution_id, institution_name)


def rename_institution_accounts(session: Session, institution_id: int, old: str, new: str) -> None:
    """Acompanha o novo nome da instituição nas contas que ainda têm o nome antigo."""
    for account in repo.list_accounts_of_institution(session, institution_id):
        taken = any(a.id != account.id for a in repo.accounts_named(session, new))
        if account.name == old and not taken:
            account.name = new


def drop_institution_accounts(session: Session, institution_id: int) -> None:
    """Remove as contas da instituição que será excluída; se alguma tem lançamentos, recusa."""
    accounts = repo.list_accounts_of_institution(session, institution_id)
    for account in accounts:
        if repo.count_entries(session, account.id) > 0:
            raise ConflictError(
                f"A conta {account.name} tem lançamentos de caixa; a instituição não pode ser "
                "excluída."
            )
    for account in accounts:
        session.delete(account)


def asset_has_entries(session: Session, asset_id: int) -> bool:
    return repo.asset_has_entries(session, asset_id)


def opening_date(session: Session, account_id: int) -> date | None:
    """Data do saldo inicial: a conta só tem caixa a partir dela. None = caixa desativado."""
    opening = repo.get_opening(session, account_id)
    return opening.date if opening else None


# ---- dinheiro separado: leitura e trava ----------------------------------------------------


class ClassLabel(NamedTuple):
    name: str
    color: str


class PurchaseMovement(Protocol):
    """O que `stage_consume_reservations` lê do aporte: já com id (quem chama deu `flush`)."""

    id: int
    date: date
    amount_cents: int


def _class_labels(session: Session) -> dict[int, ClassLabel]:
    """Nome e cor de cada categoria, arquivadas inclusive (o separado delas continua valendo).

    A carteira importa este serviço, então o import é tardio para não fechar um ciclo.
    """
    from app.features.portfolio.service import list_asset_classes

    return {
        c.id: ClassLabel(c.name, c.color)
        for c in list_asset_classes(session, include_archived=True)
    }


def _to_domain(
    reservations: Sequence[CashReservation], uses: Sequence[CashReservationUse]
) -> tuple[list[domain.Reservation], list[domain.ReservationUse]]:
    return (
        [domain.Reservation(r.id, r.class_id, r.date, r.amount_cents) for r in reservations],
        [domain.ReservationUse(u.reservation_id, u.kind, u.date, u.amount_cents) for u in uses],
    )


def _account_state(
    session: Session, account_id: int
) -> tuple[list[domain.Reservation], list[domain.ReservationUse]]:
    """Separações e baixas da conta, já como valores puros do domínio."""
    return _to_domain(
        repo.list_reservations(session, account_id),
        repo.list_reservation_uses(session, account_id),
    )


def _reserved_cents(session: Session, account_id: int, as_of: date) -> int:
    """Quanto do caixa da conta está separado ao fim de `as_of`."""
    reservations, uses = _account_state(session, account_id)
    return sum(domain.outstanding(reservations, uses, as_of).values())


def _reserved_by_account(session: Session, as_of: date) -> dict[int, int]:
    all_rows = repo.list_reservations(session)
    account_of = {r.id: r.account_id for r in all_rows}
    reservations, uses = _to_domain(all_rows, repo.list_reservation_uses(session))
    totals: dict[int, int] = defaultdict(int)
    for item in domain.open_reservations(reservations, uses, as_of):
        totals[account_of[item.id]] += item.remaining_cents
    return dict(totals)


def _free_shortfall(
    session: Session,
    account_id: int,
    from_date: date,
    *,
    add: Sequence[tuple[date, int]] = (),
    remove_ids: frozenset[int] = frozenset(),
) -> int:
    """Quanto falta no pior dia, de `from_date` em diante, para o separado caber no caixa da conta
    depois da mudança descrita por `add` e `remove_ids` (que ainda não foi gravada). 0 = cabe."""
    reservations, uses = _account_state(session, account_id)
    if not reservations:  # sem nada separado, o saldo negativo já é barrado em outro lugar
        return 0
    rows = [
        (e.date, e.amount_cents)
        for e in repo.list_entries(session, account_id)
        if e.id not in remove_ids
    ]
    rows.extend(add)
    return domain.worst_free_shortfall(rows, reservations, uses, from_date)


def _separated_names(session: Session, account_id: int) -> str:
    """Categorias com dinheiro ainda separado na conta, em texto: "A", "A e B", "A, B e C"."""
    reservations, uses = _account_state(session, account_id)
    labels = _class_labels(session)
    names = sorted(
        labels[class_id].name for class_id in domain.outstanding(reservations, uses, date.max)
    )
    return ", ".join(names[:-1]) + " e " + names[-1] if len(names) > 1 else "".join(names)


def _ensure_free_cash(
    session: Session,
    account: Account,
    from_date: date,
    *,
    add: Sequence[tuple[date, int]] = (),
    remove_ids: frozenset[int] = frozenset(),
    action: str | None = None,
) -> None:
    """Recusa a mudança no caixa se, em algum dia, o separado passar do saldo (caixa livre < 0).

    Mesmo desenho de `_ensure_non_negative`: com `action` (remover, alterar) o erro é 409; sem ele
    (lançamento novo), 422. Os dois trazem `shortfall_cents` e mandam liberar o separado antes.
    """
    shortfall = _free_shortfall(session, account.id, from_date, add=add, remove_ids=remove_ids)
    if shortfall == 0:
        return
    names = _separated_names(session, account.id)
    if action is None:
        raise InvalidInputError(
            f"O caixa livre de {account.name} não cobre isso: {format_brl(shortfall)} está "
            f"separado para {names}; libere antes.",
            shortfall_cents=shortfall,
        )
    raise ConflictError(
        f"Não dá para {action}: o caixa livre de {account.name} ficaria negativo. "
        f"{format_brl(shortfall)} está separado para {names}; libere antes.",
        shortfall_cents=shortfall,
    )


# ---- validação e gravação ------------------------------------------------------------------


def _require_cash_account(session: Session, account_id: int) -> tuple[Account, date]:
    """A conta e a data do saldo inicial; recusa conta arquivada ou sem caixa ativado."""
    account = _require_account(session, account_id)
    if account.archived:
        raise InvalidInputError(f"A conta {account.name} está arquivada.")
    opening = repo.get_opening(session, account_id)
    if opening is None:
        raise InvalidInputError(
            f"A conta {account.name} ainda não tem caixa ativado. Informe o saldo inicial antes."
        )
    return account, opening.date


def _ensure_non_negative(
    session: Session,
    account: Account,
    from_date: date,
    *,
    add: Sequence[tuple[date, int]] = (),
    remove_ids: frozenset[int] = frozenset(),
    action: str | None = None,
) -> None:
    """Recusa a mudança se o saldo ao fim de algum dia, de `from_date` em diante, ficar negativo.

    `add` e `remove_ids` descrevem a mudança sem gravá-la. Com `action` (remover, alterar), o
    erro é 409; sem ele (lançamento novo), é 422. Os dois trazem `shortfall_cents`: quanto
    faltaria no pior dia.
    """
    rows = [
        (e.date, e.amount_cents)
        for e in repo.list_entries(session, account.id)
        if e.id not in remove_ids
    ]
    rows.extend(add)
    shortfall = domain.worst_shortfall(rows, from_date)
    if shortfall is None:
        return
    if action is None:
        raise InvalidInputError(
            f"Caixa insuficiente em {account.name}: faltam {format_brl(shortfall.cents)} "
            f"em {format_date(shortfall.day)}.",
            shortfall_cents=shortfall.cents,
        )
    raise ConflictError(
        f"Não dá para {action}: o caixa de {account.name} ficaria negativo em "
        f"{format_date(shortfall.day)} (faltariam {format_brl(shortfall.cents)}). "
        "Ajuste os lançamentos seguintes antes.",
        shortfall_cents=shortfall.cents,
    )


def stage_entries(
    session: Session, account_id: int, new: Sequence[NewEntry], *, allow_opening: bool = False
) -> list[CashEntry]:
    """Valida e adiciona lançamentos novos à sessão, sem confirmar.

    Recusa: sinal errado para o tipo, data anterior ao saldo inicial e saldo negativo em qualquer
    dia daí em diante. O saldo inicial só entra por `set_opening_balance`.
    """
    if allow_opening:
        account = _require_account(session, account_id)
        cutoff = None
    else:
        account, cutoff = _require_cash_account(session, account_id)
    for entry in new:
        if error := domain.sign_error(entry.kind, entry.amount_cents):
            raise InvalidInputError(error)
        if entry.kind == domain.OPENING and not allow_opening:
            raise InvalidInputError("O saldo inicial é informado ao ativar o caixa da conta.")
        if cutoff is not None and entry.date < cutoff:
            raise InvalidInputError(
                f"A conta {account.name} só tem caixa a partir de {format_date(cutoff)} "
                f"(saldo inicial); o lançamento é de {format_date(entry.date)}."
            )
    _ensure_non_negative(
        session,
        account,
        min(e.date for e in new),
        add=[(e.date, e.amount_cents) for e in new],
    )
    _ensure_free_cash(
        session, account, min(e.date for e in new), add=[(e.date, e.amount_cents) for e in new]
    )
    rows = [
        CashEntry(
            account_id=account_id,
            date=e.date,
            kind=e.kind,
            amount_cents=e.amount_cents,
            asset_id=e.asset_id,
            movement_id=e.movement_id,
            transfer_id=e.transfer_id,
        )
        for e in new
    ]
    session.add_all(rows)
    session.flush()
    return rows


def stage_remove_entries(
    session: Session, entries: Sequence[CashEntry], *, action: str = "remover"
) -> None:
    """Remove lançamentos (sem confirmar) se o saldo continuar não negativo depois disso."""
    by_account: dict[int, list[CashEntry]] = defaultdict(list)
    for entry in entries:
        by_account[entry.account_id].append(entry)
    for account_id, group in by_account.items():
        account = _require_account(session, account_id)
        first = min(e.date for e in group)
        removed = frozenset(e.id for e in group)
        _ensure_non_negative(session, account, first, remove_ids=removed, action=action)
        _ensure_free_cash(session, account, first, remove_ids=removed, action=action)
    for entry in entries:
        session.delete(entry)
    session.flush()


def stage_remove_movement_entries(session: Session, movement_id: int) -> None:
    """Remove os lançamentos de caixa ligados a um movimento da carteira (desfazer/apagar)."""
    entries = repo.entries_for_movement(session, movement_id)
    if entries:
        stage_remove_entries(session, entries, action="desfazer")


def stage_change_movement(
    session: Session, movement_id: int, *, on_date: date, amount_cents: int
) -> None:
    """Acompanha a correção de valor/data de um movimento nos lançamentos ligados a ele.

    O sinal de cada lançamento é mantido; só o valor (em módulo) e a data mudam.
    """
    entries = repo.entries_for_movement(session, movement_id)
    if not entries:
        return
    by_account: dict[int, list[CashEntry]] = defaultdict(list)
    for entry in entries:
        by_account[entry.account_id].append(entry)
    for account_id, group in by_account.items():
        account, cutoff = _require_cash_account(session, account_id)
        if on_date < cutoff:
            raise InvalidInputError(
                f"A conta {account.name} só tem caixa a partir de {format_date(cutoff)} "
                f"(saldo inicial); a nova data é {format_date(on_date)}."
            )
        first = min([e.date for e in group] + [on_date])
        added = [(on_date, amount_cents if e.amount_cents > 0 else -amount_cents) for e in group]
        removed = frozenset(e.id for e in group)
        _ensure_non_negative(
            session, account, first, add=added, remove_ids=removed, action="alterar"
        )
        _ensure_free_cash(session, account, first, add=added, remove_ids=removed, action="alterar")
    for entry in entries:
        entry.date = on_date
        entry.amount_cents = amount_cents if entry.amount_cents > 0 else -amount_cents
    session.flush()


def consolidated_cash_cents(session: Session, as_of: date | None = None) -> int:
    """Caixa de todas as contas somado, ao fim de `as_of` (padrão: hoje)."""
    return sum(repo.balances_by_account(session, as_of or date.today()).values())


# ---- saída ---------------------------------------------------------------------------------


def _entries_out(session: Session, account_id: int) -> list[EntryOut]:
    """Todos os lançamentos da conta, em ordem cronológica, com o saldo corrente derivado."""
    entries = repo.list_entries(session, account_id)
    transfer_ids = {e.transfer_id for e in entries if e.transfer_id}
    legs: dict[str, list[int]] = defaultdict(list)
    for leg in repo.entries_of_transfers(session, transfer_ids):
        legs[leg.transfer_id].append(leg.account_id)
    out: list[EntryOut] = []
    running = 0
    for entry in entries:
        running += entry.amount_cents
        counterpart = None
        if entry.transfer_id:
            others = [a for a in legs[entry.transfer_id] if a != entry.account_id]
            counterpart = others[0] if others else None
        out.append(
            EntryOut(
                id=entry.id,
                account_id=entry.account_id,
                date=entry.date,
                kind=entry.kind,
                amount_cents=entry.amount_cents,
                asset_id=entry.asset_id,
                movement_id=entry.movement_id,
                transfer_id=entry.transfer_id,
                counterpart_account_id=counterpart,
                balance_cents=running,
                deletable=entry.movement_id is None
                and (entry.kind != domain.OPENING or len(entries) == 1),
            )
        )
    return out


def _entry_out(session: Session, account_id: int, entry_id: int) -> EntryOut:
    return next(e for e in _entries_out(session, account_id) if e.id == entry_id)


def statement(
    session: Session, account_id: int, *, start: date | None = None, end: date | None = None
) -> StatementOut:
    """Extrato da conta, do mais recente ao mais antigo; o saldo corrente conta desde o início."""
    _require_account(session, account_id)
    shown = [
        e
        for e in _entries_out(session, account_id)
        if (start is None or e.date >= start) and (end is None or e.date <= end)
    ]
    return StatementOut(
        account_id=account_id,
        balance_cents=repo.balance(session, account_id, end or date.today()),
        entries=list(reversed(shown)),
    )


def account_balance(session: Session, account_id: int, as_of: date | None = None) -> AccountBalance:
    account = _require_account(session, account_id)
    day = as_of or date.today()
    balance = repo.balance(session, account_id, day)
    reserved = _reserved_cents(session, account_id, day)
    return AccountBalance(
        account_id=account.id,
        name=account.name,
        archived=account.archived,
        cash_enabled=repo.get_opening(session, account_id) is not None,
        balance_cents=balance,
        reserved_cents=reserved,
        free_cents=balance - reserved,
    )


def cash_balance(session: Session, as_of: date | None = None) -> CashBalanceOut:
    """Caixa por conta e consolidado. Conta arquivada só aparece se ainda tiver saldo."""
    day = as_of or date.today()
    openings = repo.openings_by_account(session)
    balances = repo.balances_by_account(session, day)
    reserved = _reserved_by_account(session, day)
    accounts = [
        AccountBalance(
            account_id=a.id,
            name=a.name,
            archived=a.archived,
            cash_enabled=a.id in openings,
            balance_cents=balances.get(a.id, 0),
            reserved_cents=reserved.get(a.id, 0),
            free_cents=balances.get(a.id, 0) - reserved.get(a.id, 0),
        )
        for a in repo.list_accounts(session, include_archived=True)
        if not a.archived or balances.get(a.id, 0) != 0
    ]
    return CashBalanceOut(as_of=day, total_cents=sum(balances.values()), accounts=accounts)


# ---- operações do usuário ------------------------------------------------------------------


def set_opening_balance(session: Session, account_id: int, data: OpeningBalanceIn) -> EntryOut:
    """Ativa o caixa da conta com o saldo de partida. Daqui para trás, nada é lançado."""
    account = _require_account(session, account_id)
    if account.archived:
        raise InvalidInputError(f"A conta {account.name} está arquivada.")
    existing = repo.get_opening(session, account_id)
    if existing is not None:
        raise ConflictError(
            f"O caixa de {account.name} já foi ativado em {format_date(existing.date)}. "
            "Para recomeçar, remova o saldo inicial (só possível sem outros lançamentos)."
        )
    with _atomic(session):
        [row] = stage_entries(
            session,
            account_id,
            [NewEntry(data.date, domain.OPENING, data.amount_cents)],
            allow_opening=True,
        )
    return _entry_out(session, account_id, row.id)


def _add_manual(
    session: Session, account_id: int, kind: str, signed_cents: int, on_date: date | None
) -> EntryOut:
    with _atomic(session):
        [row] = stage_entries(
            session, account_id, [NewEntry(on_date or date.today(), kind, signed_cents)]
        )
    return _entry_out(session, account_id, row.id)


def add_deposit(session: Session, account_id: int, data: EntryIn) -> EntryOut:
    return _add_manual(session, account_id, domain.DEPOSIT, data.amount_cents, data.date)


def add_withdrawal(session: Session, account_id: int, data: EntryIn) -> EntryOut:
    return _add_manual(session, account_id, domain.WITHDRAWAL, -data.amount_cents, data.date)


def add_fee(session: Session, account_id: int, data: EntryIn) -> EntryOut:
    return _add_manual(session, account_id, "taxa", -data.amount_cents, data.date)


def add_adjustment(session: Session, account_id: int, data: AdjustmentIn) -> EntryOut:
    return _add_manual(session, account_id, domain.ADJUSTMENT, data.amount_cents, data.date)


def transfer(session: Session, data: CashTransferIn) -> CashTransferOut:
    """Leva caixa de uma conta a outra. Não mexe no capital aportado nem no total consolidado.

    Os dois lançamentos (saída e entrada) nascem juntos, com o mesmo `transfer_id`; se a origem
    não tiver caixa ou a conta de destino não puder receber, nada é gravado.
    """
    if data.from_account_id == data.to_account_id:
        raise InvalidInputError("Escolha contas diferentes para a origem e o destino.")
    on_date = data.date or date.today()
    transfer_id = str(uuid.uuid4())
    with _atomic(session):
        [out_row] = stage_entries(
            session,
            data.from_account_id,
            [NewEntry(on_date, domain.TRANSFER, -data.amount_cents, transfer_id=transfer_id)],
        )
        [in_row] = stage_entries(
            session,
            data.to_account_id,
            [NewEntry(on_date, domain.TRANSFER, data.amount_cents, transfer_id=transfer_id)],
        )
    return CashTransferOut(
        transfer_id=transfer_id,
        date=on_date,
        amount_cents=data.amount_cents,
        from_entry=_entry_out(session, data.from_account_id, out_row.id),
        to_entry=_entry_out(session, data.to_account_id, in_row.id),
    )


def delete_entry(session: Session, entry_id: int) -> None:
    """Remove um lançamento feito à mão (ou os dois lados de uma transferência).

    Lançamentos que nasceram de um movimento da carteira (compra, provento, aporte) saem só ao
    desfazer o movimento. O saldo nunca pode ficar negativo por causa da remoção.
    """
    entry = repo.get_entry(session, entry_id)
    if entry is None:
        raise NotFoundError("Lançamento não encontrado.")
    if entry.movement_id is not None:
        raise ConflictError(
            "Esse lançamento faz parte de um movimento da carteira. Para corrigir, desfaça o "
            "movimento."
        )
    if entry.kind == domain.OPENING and repo.count_entries(session, entry.account_id) > 1:
        raise ConflictError(
            "O saldo inicial só pode ser removido quando a conta não tem outros lançamentos."
        )
    legs = repo.entries_of_transfers(session, {entry.transfer_id}) if entry.transfer_id else [entry]
    with _atomic(session):
        stage_remove_entries(session, legs)


# ---- conciliação ---------------------------------------------------------------------------


def reconcile(
    session: Session, account_id: int, real_cents: int, as_of: date | None = None
) -> ReconcileOut:
    """Compara o caixa calculado com o saldo real do extrato. Só leitura: não grava nada."""
    account, cutoff = _require_cash_account(session, account_id)
    day = as_of or date.today()
    if day < cutoff:
        raise InvalidInputError(
            f"A conta {account.name} só tem caixa a partir de {format_date(cutoff)}."
        )
    calculated = repo.balance(session, account_id, day)
    return ReconcileOut(
        account_id=account_id,
        as_of=day,
        calculated_cents=calculated,
        real_cents=real_cents,
        difference_cents=domain.reconciliation_difference(real_cents, calculated),
    )


def apply_reconciliation(session: Session, account_id: int, data: ReconcileAdjustIn) -> EntryOut:
    """Grava um `ajuste` que leva o caixa calculado ao saldo real. Só com `confirm` verdadeiro."""
    if not data.confirm:
        raise InvalidInputError(
            "Confirme o ajuste para gravar a diferença da conciliação no caixa."
        )
    result = reconcile(session, account_id, data.real_cents, data.as_of)
    if result.difference_cents == 0:
        raise InvalidInputError("O caixa já confere com o saldo informado: não há o que ajustar.")
    return _add_manual(
        session, account_id, domain.ADJUSTMENT, result.difference_cents, result.as_of
    )


# ---- capital aportado ----------------------------------------------------------------------


def contributed_capital(
    session: Session,
    *,
    account_id: int | None = None,
    as_of: date | None = None,
    start: date | None = None,
) -> ContributedCapitalOut:
    """Capital aportado pelo ledger: depósitos - retiradas, por conta e somado.

    Só o que está no ledger: o capital anterior ao saldo inicial segue vindo do histórico da
    carteira (valor investido dos ativos).
    """
    day = as_of or date.today()
    if account_id is not None:
        _require_account(session, account_id)
    entries = repo.list_entries(session, account_id)
    total = domain.contributed_capital(
        [(e.date, e.kind, e.amount_cents) for e in entries], day, start
    )

    openings = repo.openings_by_account(session)
    by_account = []
    for account in repo.list_accounts(session, include_archived=True):
        if (account_id is not None and account.id != account_id) or account.id not in openings:
            continue
        mine = [(e.date, e.kind, e.amount_cents) for e in entries if e.account_id == account.id]
        by_account.append(
            AccountCapital(
                account_id=account.id,
                name=account.name,
                contributed_cents=domain.contributed_capital(mine, day, start).contributed_cents,
            )
        )
    return ContributedCapitalOut(
        as_of=day,
        start=start,
        deposits_cents=total.deposits_cents,
        withdrawals_cents=total.withdrawals_cents,
        contributed_cents=total.contributed_cents,
        by_account=by_account,
    )


# ---- dinheiro separado: operações ----------------------------------------------------------


def _require_reservation(session: Session, reservation_id: int) -> CashReservation:
    reservation = repo.get_reservation(session, reservation_id)
    if reservation is None:
        raise NotFoundError("Separação não encontrada.")
    return reservation


def _reservation_out(
    reservation: CashReservation, uses: Sequence[CashReservationUse], labels: dict[int, ClassLabel]
) -> ReservationOut:
    used = sum(u.amount_cents for u in uses if u.kind == domain.PURCHASE)
    released = sum(u.amount_cents for u in uses if u.kind == domain.RELEASE)
    return ReservationOut(
        id=reservation.id,
        account_id=reservation.account_id,
        class_id=reservation.class_id,
        class_name=labels[reservation.class_id].name,
        date=reservation.date,
        amount_cents=reservation.amount_cents,
        used_cents=used,
        released_cents=released,
        remaining_cents=reservation.amount_cents - used - released,
        deletable=not uses,
    )


def _uses_of(session: Session, reservation: CashReservation) -> list[CashReservationUse]:
    return [
        u
        for u in repo.list_reservation_uses(session, reservation.account_id)
        if u.reservation_id == reservation.id
    ]


def _reservation_result(session: Session, reservation: CashReservation) -> ReservationResult:
    """A separação como ficou e o caixa novo da conta (saldo, separado e livre de hoje)."""
    today = date.today()
    balance = repo.balance(session, reservation.account_id, today)
    reserved = _reserved_cents(session, reservation.account_id, today)
    out = _reservation_out(reservation, _uses_of(session, reservation), _class_labels(session))
    return ReservationResult(
        **out.model_dump(),
        balance_cents=balance,
        reserved_cents=reserved,
        free_cents=balance - reserved,
    )


def list_reservations(
    session: Session, account_id: int, *, include_closed: bool = False
) -> ReservationsOut:
    """O que está separado na conta hoje, por categoria e por separação.

    Separação encerrada (usada ou liberada por inteiro) só vem com `include_closed`.
    """
    _require_account(session, account_id)
    today = date.today()
    rows = repo.list_reservations(session, account_id)
    all_uses = repo.list_reservation_uses(session, account_id)
    uses_of: dict[int, list[CashReservationUse]] = defaultdict(list)
    for use in all_uses:
        uses_of[use.reservation_id].append(use)
    labels = _class_labels(session)
    reservations, domain_uses = _to_domain(rows, all_uses)
    by_class = domain.outstanding(reservations, domain_uses, today)
    reserved = sum(by_class.values())
    items = [_reservation_out(r, uses_of[r.id], labels) for r in rows]
    return ReservationsOut(
        reserved_cents=reserved,
        free_cents=repo.balance(session, account_id, today) - reserved,
        by_class=[
            ClassReserved(
                class_id=class_id,
                class_name=labels[class_id].name,
                color=labels[class_id].color,
                remaining_cents=cents,
            )
            for class_id, cents in sorted(by_class.items())
        ],
        reservations=[i for i in items if include_closed or i.remaining_cents > 0],
    )


def create_reservation(session: Session, account_id: int, data: ReservationIn) -> ReservationResult:
    """Separa dinheiro do caixa para comprar uma categoria (quem chama já conferiu a categoria).

    Não move saldo. Sem `deposit`, o valor precisa caber no caixa livre em todos os dias daí em
    diante; com `deposit`, o depósito avulso (dinheiro novo, sem compra ligada) e a separação nascem
    juntos, na mesma transação.
    """
    account, cutoff = _require_cash_account(session, account_id)
    on_date = data.date or date.today()
    if on_date > date.today():
        raise InvalidInputError("A data da separação não pode ser no futuro.")
    if on_date < cutoff:
        raise InvalidInputError(
            f"A conta {account.name} só tem caixa a partir de {format_date(cutoff)} "
            f"(saldo inicial); a separação é de {format_date(on_date)}."
        )
    with _atomic(session):
        if data.deposit:
            deposit = NewEntry(on_date, domain.DEPOSIT, data.amount_cents)
            stage_entries(session, account_id, [deposit])
        reservation = CashReservation(
            account_id=account_id,
            class_id=data.class_id,
            date=on_date,
            amount_cents=data.amount_cents,
        )
        session.add(reservation)
        session.flush()  # a conferência abaixo enxerga a separação nova
        shortfall = _free_shortfall(session, account_id, on_date)
        if shortfall:
            raise InvalidInputError(
                f"O caixa livre de {account.name} não cobre {format_brl(data.amount_cents)}: "
                f"faltam {format_brl(shortfall)}. Deposite antes ou marque “Depositar agora e "
                "separar”.",
                shortfall_cents=shortfall,
            )
    return _reservation_result(session, reservation)


def _stage_use(
    session: Session,
    reservation: CashReservation,
    kind: str,
    on_date: date,
    cents: int,
    movement_id: int | None = None,
) -> None:
    """Grava uma baixa da separação (sem confirmar). A separação em si nunca é editada.

    Recusa baixa anterior à separação e baixas que somem mais que o valor separado: o banco não tem
    essa trava, porque é uma soma entre linhas.
    """
    if on_date < reservation.date:
        label = "liberação" if kind == domain.RELEASE else "compra"
        raise InvalidInputError(
            f"A {label} não pode ser anterior à separação, de {format_date(reservation.date)}."
        )
    reservations, uses = _account_state(session, reservation.account_id)
    new_use = domain.ReservationUse(reservation.id, kind, on_date, cents)
    if domain.overused_reservations(reservations, [*uses, new_use]):
        raise InvalidInputError(
            "O valor passa do que ainda está separado na separação de "
            f"{format_date(reservation.date)}."
        )
    session.add(
        CashReservationUse(
            reservation_id=reservation.id,
            kind=kind,
            date=on_date,
            amount_cents=cents,
            movement_id=movement_id,
        )
    )
    session.flush()


def release_reservation(
    session: Session, reservation_id: int, data: ReleaseIn
) -> ReservationResult:
    """Devolve ao caixa livre o que ainda está separado (tudo, ou `amount_cents`).

    Grava uma baixa do tipo liberação; a separação original e o mês dela ficam como eram.
    """
    reservation = _require_reservation(session, reservation_id)
    on_date = data.date or date.today()
    if on_date > date.today():
        raise InvalidInputError("A data da liberação não pode ser no futuro.")
    remaining = reservation.amount_cents - sum(
        u.amount_cents for u in _uses_of(session, reservation)
    )
    if remaining == 0:
        raise InvalidInputError("Essa separação já foi usada ou liberada por inteiro.")
    cents = remaining if data.amount_cents is None else data.amount_cents
    if cents > remaining:
        raise InvalidInputError(
            f"Só restam {format_brl(remaining)} separados nessa separação; não dá para liberar "
            f"{format_brl(cents)}.",
            remaining_cents=remaining,
        )
    with _atomic(session):
        _stage_use(session, reservation, domain.RELEASE, on_date, cents)
    return _reservation_result(session, reservation)


def delete_reservation(session: Session, reservation_id: int) -> None:
    """Exclui uma separação sem uso nem liberação: só para corrigir um erro de digitação."""
    reservation = _require_reservation(session, reservation_id)
    if _uses_of(session, reservation):
        raise ConflictError(
            "Essa separação já foi usada em compra ou liberada, então não pode ser excluída. "
            "Para devolver o que sobrou ao caixa livre, libere o restante."
        )
    with _atomic(session):
        session.delete(reservation)


def stage_consume_reservations(
    session: Session, account_id: int, class_id: int, movement: PurchaseMovement
) -> int:
    """Gasta o separado da categoria numa compra: das separações mais antigas às mais novas.

    Grava uma baixa de compra por separação tocada, ligada ao movimento, sem confirmar. Devolve
    quanto saiu do separado; o que sobrar da compra sai do caixa livre. Chame antes de gravar o
    lançamento de compra no caixa: assim a trava do separado já enxerga o separado consumido.
    """
    reservations, uses = _account_state(session, account_id)
    rows = {r.id: r for r in repo.list_reservations(session, account_id)}
    open_items = [
        item
        for item in domain.open_reservations(reservations, uses, movement.date)
        if item.class_id == class_id
    ]
    slices, _free = domain.fifo_consume(open_items, movement.amount_cents, movement.date)
    for reservation_id, cents in slices:
        _stage_use(
            session, rows[reservation_id], domain.PURCHASE, movement.date, cents, movement.id
        )
    return sum(cents for _, cents in slices)


def stage_release_movement_uses(session: Session, movement_id: int) -> int:
    """Apaga as baixas de compra de um movimento (sem confirmar): o separado volta a ficar em
    aberto. Devolve quanto voltou. Quem chama confere o caixa depois, porque o separado cresce."""
    uses = repo.uses_for_movement(session, movement_id)
    for use in uses:
        session.delete(use)
    session.flush()
    return sum(use.amount_cents for use in uses)


def stage_refresh_consumption(
    session: Session, movement: PurchaseMovement, class_id: int, *, spend: bool
) -> int | None:
    """Refaz o consumo do separado de uma compra corrigida (valor, data ou "fora da meta").

    Apaga as baixas antigas e roda o consumo de novo com o valor e a data de agora, na ordem
    determinística (separação mais antiga primeiro, depois id), sem confirmar. Com `spend` falso, a
    compra só devolve o separado e não gasta mais nada. Devolve quanto saiu do separado, ou None se
    o movimento não sai do caixa que já existia (aporte padrão, resgate...): aí nada muda.
    """
    entries = repo.entries_for_movement(session, movement.id)
    if not domain.spends_existing_cash(e.kind for e in entries):
        return None
    stage_release_movement_uses(session, movement.id)
    if not spend:
        return 0
    return stage_consume_reservations(session, entries[0].account_id, class_id, movement)


def reserved_used_by_movement(session: Session) -> dict[int, int]:
    """Quanto cada movimento da carteira gastou do separado (só os que gastaram)."""
    return repo.purchase_uses_by_movement(session)


def reserved_left(session: Session, account_id: int, class_id: int) -> int:
    """Quanto continua separado para a categoria na conta, sem limite de data."""
    reservations, uses = _account_state(session, account_id)
    return domain.outstanding(reservations, uses, date.max).get(class_id, 0)


def reserved_by_class(session: Session, as_of: date = date.max) -> dict[int, int]:
    """Separado em aberto por categoria, em todas as contas, ao fim de `as_of` (padrão: sem limite
    de data). Categoria sem nada não aparece."""
    reservations, uses = _to_domain(
        repo.list_reservations(session), repo.list_reservation_uses(session)
    )
    return domain.outstanding(reservations, uses, as_of)


def reserved_by_class_on(session: Session, days: Iterable[date]) -> dict[date, dict[int, int]]:
    """Separado em aberto por categoria ao fim de cada dia pedido, em todas as contas.

    Lê o banco uma vez só: serve a evolução, que pede o separado de cada ponto do gráfico.
    """
    reservations, uses = _to_domain(
        repo.list_reservations(session), repo.list_reservation_uses(session)
    )
    return {day: domain.outstanding(reservations, uses, day) for day in days}


def reserve_flows_in_period(session: Session, after: date, up_to: date) -> domain.ReserveFlows:
    """Separações, compras e liberações datadas em (after, up_to], em todas as contas."""
    reservations, uses = _to_domain(
        repo.list_reservations(session), repo.list_reservation_uses(session)
    )
    return domain.reserve_flows(reservations, uses, after, up_to)


def reserved_in_class(session: Session, class_id: int) -> int:
    """Separado em aberto para a categoria em todas as contas (arquivar a categoria o deixaria
    sem destino)."""
    return reserved_by_class(session).get(class_id, 0)


def separated_by_month(session: Session) -> dict[str, dict[int, int]]:
    """O que foi separado em cada mês ("YYYY-MM"), por categoria, em todas as contas."""
    reservations, _ = _to_domain(repo.list_reservations(session), [])
    return domain.separated_by_month(reservations)
