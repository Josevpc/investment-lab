"""Serviço do caixa (ledger por conta).

O saldo nunca é gravado: é a soma dos lançamentos (`cash_entry`) até uma data. Interface pública
para outras features: `default_account_id`, `create_institution_account`, `get_account`,
`rename_institution_accounts`, `drop_institution_accounts`, `asset_has_entries`, `opening_date`,
`consolidated_cash_cents`, `contributed_capital` e as funções `stage_*`.

As funções `stage_*` gravam na sessão sem confirmar: quem chama junta o lançamento do caixa com a
operação da carteira e confirma tudo numa transação só (ou desfaz tudo).
"""

import uuid
from collections import defaultdict
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import date

from sqlalchemy.orm import Session

from app.core.errors import ConflictError, InvalidInputError, NotFoundError
from app.core.money import format_brl, format_date
from app.features.cash import domain
from app.features.cash import repository as repo
from app.features.cash.domain import NewEntry
from app.features.cash.models import Account, CashEntry
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
    ContributedCapitalOut,
    EntryIn,
    EntryOut,
    OpeningBalanceIn,
    ReconcileAdjustIn,
    ReconcileOut,
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


def _account_out(account: Account, opening: date | None, balance_cents: int) -> AccountOut:
    return AccountOut(
        id=account.id,
        name=account.name,
        institution_id=account.institution_id,
        archived=account.archived,
        cash_enabled=opening is not None,
        opening_date=opening,
        balance_cents=balance_cents,
    )


def list_accounts(session: Session, *, include_archived: bool = False) -> list[AccountOut]:
    openings = repo.openings_by_account(session)
    balances = repo.balances_by_account(session, date.today())
    return [
        _account_out(a, openings.get(a.id), balances.get(a.id, 0))
        for a in repo.list_accounts(session, include_archived=include_archived)
    ]


def get_account(session: Session, account_id: int) -> AccountOut:
    account = _require_account(session, account_id)
    opening = repo.get_opening(session, account_id)
    return _account_out(
        account,
        opening.date if opening else None,
        repo.balance(session, account_id, date.today()),
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
        _ensure_non_negative(
            session,
            _require_account(session, account_id),
            min(e.date for e in group),
            remove_ids=frozenset(e.id for e in group),
            action=action,
        )
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
        _ensure_non_negative(
            session,
            account,
            min([e.date for e in group] + [on_date]),
            add=[(on_date, amount_cents if e.amount_cents > 0 else -amount_cents) for e in group],
            remove_ids=frozenset(e.id for e in group),
            action="alterar",
        )
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
    return AccountBalance(
        account_id=account.id,
        name=account.name,
        archived=account.archived,
        cash_enabled=repo.get_opening(session, account_id) is not None,
        balance_cents=repo.balance(session, account_id, as_of or date.today()),
    )


def cash_balance(session: Session, as_of: date | None = None) -> CashBalanceOut:
    """Caixa por conta e consolidado. Conta arquivada só aparece se ainda tiver saldo."""
    day = as_of or date.today()
    openings = repo.openings_by_account(session)
    balances = repo.balances_by_account(session, day)
    accounts = [
        AccountBalance(
            account_id=a.id,
            name=a.name,
            archived=a.archived,
            cash_enabled=a.id in openings,
            balance_cents=balances.get(a.id, 0),
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
