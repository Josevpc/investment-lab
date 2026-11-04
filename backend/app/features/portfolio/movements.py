"""Movimentos da carteira: aporte, transferência entre ativos, proventos e resgates.

Cada operação altera a valorização mais recente do(s) ativo(s) e deixa um registro no diário
(`asset_movement`), que alimenta os relatórios (aportado no mês, proventos recebidos, resgatado).
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.errors import ConflictError, InvalidInputError, NotFoundError
from app.core.money import format_date
from app.features.cash import domain as cash_domain
from app.features.cash import service as cash
from app.features.portfolio import initial_contribution as initial
from app.features.portfolio import repository as repo
from app.features.portfolio.domain import redemption_effective_date
from app.features.portfolio.models import Asset, AssetMovement, AssetValuation
from app.features.portfolio.schemas import (
    AssetOut,
    BalanceIn,
    ClassMonthAmount,
    MonthSummary,
    MovementOut,
    MovementUpdate,
    NewAssetAmount,
    ProventoIn,
    PurchaseIn,
    PurchaseOut,
    RedemptionIn,
    TransferIn,
)
from app.features.portfolio.service import get_asset


def _fmt_date(value: date) -> str:
    return value.strftime("%d/%m/%Y")


def _fmt_money(cents: int) -> str:
    whole, frac = divmod(cents, 100)
    return f"R$ {whole:,}".replace(",", ".") + f",{frac:02d}"


def _require_active_asset(session: Session, asset_id: int, label: str = "Ativo") -> Asset:
    asset = repo.get_asset(session, asset_id)
    if asset is None:
        raise NotFoundError(f"{label} não encontrado.")
    if asset.archived:
        raise InvalidInputError(f"{asset.name} está arquivado.")
    return asset


def _valuation_for_change(session: Session, asset: Asset, on_date: date) -> AssetValuation:
    """Valorização que será alterada em `on_date`: a do próprio dia ou uma cópia da última.

    Exige data igual ou posterior à última atualização, para que a "carteira atual" (que usa a
    valorização mais recente) reflita a mudança.
    """
    latest = repo.get_latest_valuation(session, asset.id)
    if latest is None:
        raise InvalidInputError(f"{asset.name} ainda não tem valores cadastrados.")
    if on_date < latest.date:
        raise InvalidInputError(
            f"A data deve ser igual ou posterior à última atualização de {asset.name} "
            f"({_fmt_date(latest.date)})."
        )
    if latest.date == on_date:
        return latest
    valuation = AssetValuation(
        asset_id=asset.id,
        date=on_date,
        invested_cents=latest.invested_cents,
        current_cents=latest.current_cents,
        observed=False,
    )
    session.add(valuation)
    return valuation


def _contribution_date(session: Session, asset: Asset, on_date: date, given: date | None) -> date:
    """Data em que o aporte foi feito: entre o último saldo observado e a data do saldo.

    Um aporte fora desse intervalo pertenceria a outro período do ativo e distorceria o cálculo
    de quanto % do CDI ele rendeu.
    """
    if given is None:
        return on_date
    if given > on_date:
        raise InvalidInputError("A data do aporte não pode ser depois da data do saldo.")
    earlier = [
        v.date for v in repo.list_valuations(session, asset.id) if v.observed and v.date < on_date
    ]
    if earlier and given <= max(earlier):
        raise InvalidInputError(
            f"A data do aporte deve ser depois do último saldo de {asset.name} "
            f"({_fmt_date(max(earlier))})."
        )
    return given


def _book_contribution_in_cash(
    session: Session, asset: Asset, movement: AssetMovement, use_cash: bool
) -> None:
    """Reflete o aporte do fechamento no caixa da conta do ativo, se ela tem caixa ativado.

    Padrão: dinheiro novo, então entra um depósito e sai a compra (o caixa não muda e o capital
    aportado sobe). Com `use_cash`, só a compra: o dinheiro já estava no caixa. Sem caixa
    ativado, ou com aporte datado antes do saldo inicial, nada vai ao ledger (o histórico anterior
    ao corte continua sendo o da carteira) e `use_cash` é recusado.
    """
    account_id = asset.account_id
    opening = cash.opening_date(session, account_id) if account_id is not None else None
    if opening is None or movement.date < opening:
        if use_cash:
            raise InvalidInputError(
                f"Para usar o caixa, a conta de {asset.name} precisa ter o caixa ativado e o "
                "aporte não pode ser anterior ao saldo inicial"
                + (f" ({format_date(opening)})." if opening else ".")
            )
        return
    session.flush()  # o movimento precisa de id para ser ligado aos lançamentos
    entries = [
        cash_domain.NewEntry(
            movement.date, cash_domain.PURCHASE, -movement.amount_cents, asset.id, movement.id
        )
    ]
    if not use_cash:
        deposit = cash_domain.NewEntry(
            movement.date, cash_domain.DEPOSIT, movement.amount_cents, asset.id, movement.id
        )
        entries.insert(0, deposit)
    cash.stage_entries(session, account_id, entries)


def record_balance(session: Session, asset_id: int, data: BalanceIn) -> AssetOut:
    """Fechamento do mês: grava o saldo do extrato e soma o aporte ao investido.

    Se a conta do ativo tem caixa ativado, o aporte também vira lançamentos no caixa (veja
    `_book_contribution_in_cash`); tudo na mesma transação.
    """
    asset = _require_active_asset(session, asset_id)
    on_date = data.date or date.today()
    try:
        contribution_date = _contribution_date(session, asset, on_date, data.contribution_date)
        valuation = _valuation_for_change(session, asset, on_date)
        if data.invested_cents is not None:
            valuation.invested_cents = data.invested_cents
        valuation.invested_cents += data.contribution_cents
        valuation.current_cents = data.balance_cents
        valuation.observed = True
        if data.quantity_added is not None:
            total = Decimal(asset.quantity or "0") + Decimal(data.quantity_added)
            asset.quantity = format(total.normalize(), "f")
        if data.contribution_cents > 0:
            movement = AssetMovement(
                date=contribution_date,
                kind="aporte",
                asset_id=asset.id,
                amount_cents=data.contribution_cents,
            )
            session.add(movement)
            _book_contribution_in_cash(session, asset, movement, data.use_cash)
        if data.invested_cents is not None:
            initial.resync(session, asset)  # o investido corrigido pode ser o da 1ª valorização
        session.commit()
    except Exception:
        session.rollback()
        raise
    return get_asset(session, asset_id)


def create_purchase(session: Session, data: PurchaseIn) -> PurchaseOut:
    """Compra um ativo com o caixa da conta dele.

    O ativo ganha o valor no investido e no saldo (como um aporte) e o caixa perde o valor. Se o
    caixa não bastar, a compra é recusada com `shortfall_cents`; `deposit_cents` grava um depósito
    explícito antes (dinheiro novo, entra no capital aportado). Uma transação só: se algo
    falhar, nem o movimento nem os lançamentos ficam gravados.
    """
    asset = _require_active_asset(session, data.asset_id)
    if asset.account_id is None:
        raise InvalidInputError(f"{asset.name} não está ligado a uma conta.")
    on_date = data.date or date.today()
    amount = data.resolved_amount_cents()
    try:
        valuation = _valuation_for_change(session, asset, on_date)
        valuation.invested_cents += amount
        valuation.current_cents += amount
        movement = AssetMovement(
            date=on_date,
            kind="aporte",
            asset_id=asset.id,
            amount_cents=amount,
            from_purchase=True,
        )
        session.add(movement)
        session.flush()
        entries = []
        if data.deposit_cents:
            # Depósito avulso, sem ligação com o movimento: desfazer a compra devolve o dinheiro
            # ao caixa, não o tira da conta.
            entries.append(
                cash_domain.NewEntry(on_date, cash_domain.DEPOSIT, data.deposit_cents, asset.id)
            )
        entries.append(
            cash_domain.NewEntry(on_date, cash_domain.PURCHASE, -amount, asset.id, movement.id)
        )
        cash.stage_entries(session, asset.account_id, entries)
        session.commit()
    except Exception:
        session.rollback()
        raise
    return PurchaseOut(
        movement=_movement_out(movement),
        account_id=asset.account_id,
        deposit_cents=data.deposit_cents or 0,
        cash_balance_cents=cash.account_balance(session, asset.account_id, on_date).balance_cents,
    )


def _move_cost(invested: int, current: int, amount: int) -> int:
    """Custo de aquisição proporcional ao valor movido (arredondado meio para cima)."""
    return (2 * invested * amount + current) // (2 * current)


def create_transfer(session: Session, data: TransferIn) -> MovementOut:
    """Leva dinheiro de um ativo para outro mantendo o histórico de rentabilidade.

    O custo proporcional sai da origem e entra no destino, então o total investido e o
    rendimento da carteira não mudam com a transferência.
    """
    if data.from_asset_id == data.to_asset_id:
        raise InvalidInputError("Escolha ativos diferentes para a origem e o destino.")
    source = _require_active_asset(session, data.from_asset_id, "Ativo de origem")
    target = _require_active_asset(session, data.to_asset_id, "Ativo de destino")
    on_date = data.date or date.today()

    origin = _valuation_for_change(session, source, on_date)
    if data.amount_cents > origin.current_cents:
        raise InvalidInputError(
            f"O valor é maior que o saldo atual de {source.name} "
            f"({_fmt_money(origin.current_cents)})."
        )
    cost = _move_cost(origin.invested_cents, origin.current_cents, data.amount_cents)
    destination = _valuation_for_change(session, target, on_date)

    origin.invested_cents -= cost
    origin.current_cents -= data.amount_cents
    destination.invested_cents += cost
    destination.current_cents += data.amount_cents

    movement = AssetMovement(
        date=on_date,
        kind="transferencia",
        asset_id=target.id,
        related_asset_id=source.id,
        amount_cents=data.amount_cents,
        cost_cents=cost,
    )
    session.add(movement)
    session.commit()
    return _movement_out(movement)


def _redemption_closing(session: Session, asset: Asset, on_date: date) -> AssetValuation:
    """Saldo digitado que já vem sem o dinheiro resgatado: o primeiro a partir da data do resgate.

    Precisa existir um saldo digitado antes da data também: sem ele o resgate cairia no cadastro do
    ativo (o ponto de partida), que não tem o dinheiro que saiu.
    """
    rows = repo.list_valuations(session, asset.id)
    if not rows:
        raise InvalidInputError(f"{asset.name} ainda não tem valores cadastrados.")
    observed = sorted((v for v in rows if v.observed), key=lambda v: v.date)
    closing = next((v for v in observed if v.date >= on_date), None)
    if closing is None:
        raise InvalidInputError(
            f"{asset.name} não tem saldo digitado em {_fmt_date(on_date)} ou depois. Lance o saldo "
            "do extrato antes, ou use o resgate que tira o valor do saldo atual."
        )
    if not any(v.date < on_date for v in observed):
        raise InvalidInputError(
            f"A data do resgate deve ser depois do primeiro saldo de {asset.name} "
            f"({_fmt_date(observed[0].date)})."
        )
    return closing


def _redemption_cost_in_balance(closing: AssetValuation, amount: int) -> int:
    """Custo do resgate cujo saldo já veio sem o dinheiro.

    A proporção é a de antes do resgate: o saldo digitado mais o que saiu. O investido da linha
    ainda é o de antes (o app só o reduz agora).
    """
    return _move_cost(closing.invested_cents, closing.current_cents + amount, amount)


def _require_cash_for_redemption(session: Session, asset: Asset, on_date: date) -> None:
    """Creditar o resgate no caixa exige caixa ativado na conta e data a partir do saldo inicial."""
    account_id = asset.account_id
    opening = cash.opening_date(session, account_id) if account_id is not None else None
    if opening is None or on_date < opening:
        raise InvalidInputError(
            f"Para creditar no caixa, a conta de {asset.name} precisa ter o caixa ativado e o "
            "resgate não pode ser anterior ao saldo inicial"
            + (f" ({format_date(opening)})." if opening else ".")
        )


def create_redemption(session: Session, data: RedemptionIn) -> MovementOut:
    """Tira dinheiro de um ativo, levando junto o custo proporcional ao valor.

    O custo sai do investido pela mesma regra da transferência, então a rentabilidade do que sobra
    não muda. Dois modos:

    - normal: a data é igual ou posterior à última atualização do ativo; valor e custo saem do
      saldo atual;
    - `already_in_balance`: o saldo digitado do extrato já está sem esse dinheiro; só o custo sai do
      investido (do primeiro saldo digitado a partir da data em diante) e o saldo fica como está.

    Com `credit_cash`, o valor também entra no caixa da conta (uma "venda"). Tudo numa transação.
    """
    asset = _require_active_asset(session, data.asset_id)
    on_date = data.date or date.today()
    if data.credit_cash:
        _require_cash_for_redemption(session, asset, on_date)
    try:
        movement = AssetMovement(
            date=on_date,
            kind="resgate",
            asset_id=asset.id,
            amount_cents=data.amount_cents,
            note=data.note,
            in_balance=data.already_in_balance,
        )
        if data.already_in_balance:
            closing = _redemption_closing(session, asset, on_date)
            cost = _redemption_cost_in_balance(closing, data.amount_cents)
            later = [v for v in repo.list_valuations(session, asset.id) if v.date >= closing.date]
            if any(v.invested_cents < cost for v in later):
                raise InvalidInputError(
                    f"O custo do resgate é maior que o valor investido de {asset.name} em "
                    f"{_fmt_date(closing.date)}. Confira o valor e o investido do ativo."
                )
            _shift(session, asset, on_date, invested=-cost, current=0, observed_only_start=True)
        else:
            origin = _valuation_for_change(session, asset, on_date)
            if data.amount_cents > origin.current_cents:
                raise InvalidInputError(
                    f"O valor é maior que o saldo de {asset.name} em {_fmt_date(on_date)} "
                    f"({_fmt_money(origin.current_cents)})."
                )
            cost = _move_cost(origin.invested_cents, origin.current_cents, data.amount_cents)
            origin.invested_cents -= cost
            origin.current_cents -= data.amount_cents
        movement.cost_cents = cost
        session.add(movement)
        if data.credit_cash:
            session.flush()  # o movimento precisa de id para ser ligado ao lançamento
            cash.stage_entries(
                session,
                asset.account_id,
                [
                    cash_domain.NewEntry(
                        on_date, cash_domain.SALE, data.amount_cents, asset.id, movement.id
                    )
                ],
            )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return _movement_out(movement)


def create_provento(session: Session, data: ProventoIn) -> MovementOut:
    """Registra um provento (dividendo, rendimento de FII, JCP) pago por um ativo.

    Se a conta do ativo tem caixa ativado e a data não é anterior ao saldo inicial, o valor também
    entra no caixa da conta, na mesma transação. `credited_asset_id` é o caminho antigo (o valor
    entra no saldo de outro ativo, sem aumentar o investido: é rendimento, não capital novo);
    quando informado, o caixa não é usado, para o dinheiro não contar duas vezes.
    """
    payer = _require_active_asset(session, data.asset_id)
    on_date = data.date or date.today()
    try:
        return _create_provento(session, data, payer, on_date)
    except Exception:
        session.rollback()
        raise


def _create_provento(
    session: Session, data: ProventoIn, payer: Asset, on_date: date
) -> MovementOut:
    if data.credited_asset_id is not None:
        if data.credited_asset_id == data.asset_id:
            raise InvalidInputError("Credite o provento em outro ativo (ex.: saldo em conta).")
        receiver = _require_active_asset(session, data.credited_asset_id, "Ativo de destino")
        valuation = _valuation_for_change(session, receiver, on_date)
        valuation.current_cents += data.amount_cents

    movement = AssetMovement(
        date=on_date,
        kind="provento",
        asset_id=payer.id,
        related_asset_id=data.credited_asset_id,
        amount_cents=data.amount_cents,
    )
    session.add(movement)
    if data.credited_asset_id is None and payer.account_id is not None:
        opening = cash.opening_date(session, payer.account_id)
        if opening is not None and on_date >= opening:
            session.flush()
            cash.stage_entries(
                session,
                payer.account_id,
                [
                    cash_domain.NewEntry(
                        on_date, cash_domain.PROVENTO, data.amount_cents, payer.id, movement.id
                    )
                ],
            )
    session.commit()
    return _movement_out(movement)


def _movement_out(movement: AssetMovement) -> MovementOut:
    return MovementOut(
        id=movement.id,
        date=movement.date,
        kind=movement.kind,
        asset_id=movement.asset_id,
        asset_name=movement.asset.name,
        related_asset_id=movement.related_asset_id,
        related_asset_name=movement.related_asset.name if movement.related_asset else None,
        amount_cents=movement.amount_cents,
        cost_cents=movement.cost_cents,
        initial=movement.initial,
        note=movement.note,
        in_balance=movement.in_balance,
    )


def list_movements(
    session: Session,
    *,
    month: str | None = None,
    kind: str | None = None,
    asset_id: int | None = None,
) -> list[MovementOut]:
    movements = repo.list_movements(session, month=month, kind=kind, asset_id=asset_id)
    return [_movement_out(m) for m in movements]


def delete_movement(session: Session, movement_id: int) -> None:
    """Só proventos sem crédito podem ser apagados; os demais mexem em saldos já registrados."""
    movement = repo.get_movement(session, movement_id)
    if movement is None:
        raise NotFoundError("Movimento não encontrado.")
    if movement.initial:
        # O aporte inicial nunca mexeu em saldos: o caminho certo é desfazê-lo.
        raise ConflictError(
            "Um aporte inicial não pode ser apagado. Use Desfazer no movimento "
            "ou marque o ativo como antigo na edição dele."
        )
    if movement.kind != "provento" or movement.related_asset_id is not None:
        raise ConflictError(
            "Esse movimento já alterou saldos. Para corrigir, ajuste os valores do ativo."
        )
    try:
        cash.stage_remove_movement_entries(session, movement.id)
        session.delete(movement)
        session.commit()
    except Exception:
        session.rollback()
        raise


def _shift(
    session: Session,
    asset: Asset,
    from_date: date,
    *,
    invested: int,
    current: int,
    observed_only_start: bool = False,
) -> None:
    """Soma `invested` e `current` aos valores do ativo a partir de `from_date`.

    Com `observed_only_start`, a alteração começa no primeiro saldo digitado a partir da data: as
    linhas criadas por transferência no meio do caminho nunca incluíram esse aporte.
    """
    rows = sorted(repo.list_valuations(session, asset.id), key=lambda v: v.date)
    start = from_date
    if observed_only_start:
        observed = [v.date for v in rows if v.observed and v.date >= from_date]
        if not observed:
            return
        start = observed[0]
    for row in rows:
        if row.date < start:
            continue
        if row.invested_cents + invested < 0 or row.current_cents + current < 0:
            raise ConflictError(
                f"Não dá para fazer isso: o saldo de {asset.name} em {_fmt_date(row.date)} ficaria "
                "negativo. Ajuste os valores do ativo antes."
            )
    for row in rows:
        if row.date >= start:
            row.invested_cents += invested
            row.current_cents += current


def _unapply(session: Session, movement: AssetMovement) -> None:
    """Tira dos saldos o efeito que o movimento teve, como se o dinheiro nunca tivesse entrado."""
    if movement.initial:  # só registro: o dinheiro já está nos saldos do ativo
        return
    amount = movement.amount_cents
    if movement.kind == "aporte":
        _shift(
            session,
            movement.asset,
            movement.date,
            invested=-amount,
            current=-amount,
            observed_only_start=not movement.from_purchase,
        )
    elif movement.kind == "transferencia":
        cost = movement.cost_cents or 0
        _shift(session, movement.asset, movement.date, invested=-cost, current=-amount)
        if movement.related_asset is not None:
            _shift(session, movement.related_asset, movement.date, invested=cost, current=amount)
    elif movement.kind == "resgate":
        cost = movement.cost_cents or 0
        if movement.in_balance:  # o saldo digitado já estava sem o valor: só o custo volta
            _shift(
                session,
                movement.asset,
                movement.date,
                invested=cost,
                current=0,
                observed_only_start=True,
            )
        else:
            _shift(session, movement.asset, movement.date, invested=cost, current=amount)
    elif movement.related_asset is not None:  # provento creditado em outro ativo
        _shift(session, movement.related_asset, movement.date, invested=0, current=-amount)


def _row_at(session: Session, asset: Asset, on_date: date) -> AssetValuation:
    """Valorização do ativo em `on_date`; se não houver, nasce uma cópia da anterior.

    Diferente de `_valuation_for_change`, aceita datas no passado: é o que permite corrigir a data
    de um movimento antigo. A cópia herda o estado de antes do movimento, que é o que a linha
    teria se ele sempre tivesse sido lançado nesse dia.
    """
    rows = repo.list_valuations(session, asset.id)
    for row in rows:
        if row.date == on_date:
            return row
    before = [v for v in rows if v.date < on_date]
    if not before:
        raise InvalidInputError(f"{asset.name} ainda não tinha valores em {_fmt_date(on_date)}.")
    base = max(before, key=lambda v: v.date)
    row = AssetValuation(
        asset_id=asset.id,
        date=on_date,
        invested_cents=base.invested_cents,
        current_cents=base.current_cents,
        observed=False,
    )
    session.add(row)
    return row


def _apply(session: Session, movement: AssetMovement) -> None:
    """Aplica aos saldos o efeito do movimento com o valor e a data que ele tem agora."""
    if movement.initial:
        return
    amount, on_date = movement.amount_cents, movement.date
    if movement.kind == "aporte" and movement.from_purchase:
        _row_at(session, movement.asset, on_date)
        _shift(session, movement.asset, on_date, invested=amount, current=amount)
    elif movement.kind == "aporte":
        rows = repo.list_valuations(session, movement.asset_id)
        closings = sorted(v.date for v in rows if v.observed and v.date >= on_date)
        if not closings:
            raise InvalidInputError(
                f"{movement.asset.name} não tem saldo registrado a partir de "
                f"{_fmt_date(on_date)}. Use uma data até o último saldo."
            )
        # Sem validar contra o fechamento anterior: o aporte pertence ao primeiro fechamento a
        # partir da data, então por construção ele cai depois do fechamento anterior.
        _shift(
            session,
            movement.asset,
            on_date,
            invested=amount,
            current=amount,
            observed_only_start=True,
        )
    elif movement.kind == "transferencia":
        source, target = movement.related_asset, movement.asset
        origin = _row_at(session, source, on_date)
        if amount > origin.current_cents:
            raise InvalidInputError(
                f"O valor é maior que o saldo de {source.name} em {_fmt_date(on_date)} "
                f"({_fmt_money(origin.current_cents)})."
            )
        cost = _move_cost(origin.invested_cents, origin.current_cents, amount)
        _row_at(session, target, on_date)
        movement.cost_cents = cost
        _shift(session, source, on_date, invested=-cost, current=-amount)
        _shift(session, target, on_date, invested=cost, current=amount)
    elif movement.kind == "resgate" and movement.in_balance:
        closing = _redemption_closing(session, movement.asset, on_date)
        cost = _redemption_cost_in_balance(closing, amount)
        movement.cost_cents = cost
        _shift(
            session, movement.asset, on_date, invested=-cost, current=0, observed_only_start=True
        )
    elif movement.kind == "resgate":
        origin = _row_at(session, movement.asset, on_date)
        if amount > origin.current_cents:
            raise InvalidInputError(
                f"O valor é maior que o saldo de {movement.asset.name} em {_fmt_date(on_date)} "
                f"({_fmt_money(origin.current_cents)})."
            )
        cost = _move_cost(origin.invested_cents, origin.current_cents, amount)
        movement.cost_cents = cost
        _shift(session, movement.asset, on_date, invested=-cost, current=-amount)
    elif movement.related_asset is not None:
        _row_at(session, movement.related_asset, on_date)
        _shift(session, movement.related_asset, on_date, invested=0, current=amount)


def undo_movement(session: Session, movement_id: int) -> MovementOut:
    """Desfaz um movimento que já mexeu em saldos, como se o dinheiro nunca tivesse entrado.

    - aporte: tira o valor do investido e do saldo, do primeiro saldo digitado a partir da data;
    - transferência: devolve o dinheiro e o custo à origem e tira do destino;
    - provento creditado: tira o valor do saldo do ativo que o recebeu;
    - resgate: devolve o valor e o custo ao ativo (no modo "já no saldo", só o custo, porque o
      saldo digitado nunca deixou de ser o do extrato);
    - aporte inicial (ativo novo): só apaga o registro, os saldos ficam como estão e o ativo volta
      a ser "antigo".

    Os lançamentos de caixa ligados ao movimento saem junto (e o desfazer é recusado se o caixa
    ficasse negativo).

    Fechamentos (snapshots) já gravados são cópias e não mudam. Tudo ocorre numa transação.
    """
    movement = repo.get_movement(session, movement_id)
    if movement is None:
        raise NotFoundError("Movimento não encontrado.")
    out = _movement_out(movement)
    try:
        if not movement.initial:  # o inicial nunca teve caixa nem mexeu em saldos
            cash.stage_remove_movement_entries(session, movement.id)
            _unapply(session, movement)
        session.delete(movement)
        session.commit()
    except Exception:
        session.rollback()
        raise
    return out


def _refuse_crossing_into_cash(session: Session, movement: AssetMovement, on_date: date) -> None:
    """Um aporte/provento/resgate lançado antes do saldo inicial não tem lançamento de caixa;
    movê-lo para depois do corte o deixaria de fora do caixa sem aviso, então a correção é
    recusada."""
    if (
        movement.kind not in ("aporte", "provento", "resgate")
        or movement.related_asset_id is not None
    ):
        return
    account_id = movement.asset.account_id
    opening = cash.opening_date(session, account_id) if account_id is not None else None
    if opening is not None and movement.date < opening <= on_date:
        raise InvalidInputError(
            f"Esse lançamento foi feito antes do caixa da conta (saldo inicial em "
            f"{format_date(opening)}). Desfaça e lance de novo para que ele entre no caixa."
        )


def update_movement(session: Session, movement_id: int, data: MovementUpdate) -> MovementOut:
    """Corrige o valor e/ou a data de um movimento, refazendo o efeito dele nos saldos.

    É desfazer e relançar numa transação só: se algum saldo ficar negativo ou a nova data não
    couber no histórico do ativo, nada muda. Numa transferência ou num resgate, o custo é
    recalculado proporcionalmente ao saldo do dia. Fechamentos (snapshots) já gravados não mudam.

    Num resgate também dá para trocar ou apagar o motivo, sem mexer em saldo nenhum.
    """
    movement = repo.get_movement(session, movement_id)
    if movement is None:
        raise NotFoundError("Movimento não encontrado.")
    if movement.initial:
        raise ConflictError(
            "Esse é o aporte inicial do ativo. Para mudar, edite o valor do ativo ou "
            "marque-o como antigo."
        )
    note_given = "note" in data.model_fields_set
    if note_given and movement.kind != "resgate":
        raise InvalidInputError("O motivo só pode ser informado em resgates.")
    amount = data.amount_cents if data.amount_cents is not None else movement.amount_cents
    on_date = data.date if data.date is not None else movement.date
    moved = (amount, on_date) != (movement.amount_cents, movement.date)
    if not moved and not note_given:
        return _movement_out(movement)
    if moved:
        _refuse_crossing_into_cash(session, movement, on_date)
    try:
        if moved:
            _unapply(session, movement)
            movement.amount_cents = amount
            movement.date = on_date
            _apply(session, movement)
            cash.stage_change_movement(session, movement.id, on_date=on_date, amount_cents=amount)
        if note_given:
            movement.note = data.note
        session.commit()
    except Exception:
        session.rollback()
        raise
    return _movement_out(movement)


def aportes_by_month(session: Session, after_month: str, up_to_month: str) -> dict[str, int]:
    """Aportes lançados nos ativos, somados por mês, no intervalo (after_month, up_to_month]."""
    totals: dict[str, int] = {}
    for movement in repo.list_movements(session, kind="aporte"):
        month = movement.date.strftime("%Y-%m")
        if after_month < month <= up_to_month:
            totals[month] = totals.get(month, 0) + movement.amount_cents
    return totals


def _observed_dates(session: Session) -> dict[int, list[date]]:
    observed: dict[int, list[date]] = {}
    for valuation in repo.list_valuation_history(session):
        if valuation.observed:
            observed.setdefault(valuation.asset_id, []).append(valuation.date)
    return observed


def aporte_effective_date(movement: AssetMovement, observed_dates: list[date]) -> date | None:
    """Primeira data em que os saldos do ativo já mostram o aporte.

    A compra com o caixa está na linha do próprio dia. O aporte do fechamento só aparece no
    primeiro saldo digitado a partir da data: um ativo atrasado o mostra depois do dia em que o
    dinheiro entrou, e o período só pode contá-lo quando o patrimônio o traz. None se nenhum saldo
    o mostra ainda.
    """
    if movement.from_purchase:
        return movement.date
    return min((d for d in observed_dates if d >= movement.date), default=None)


def aportes_in_period(session: Session, after: date, up_to: date) -> dict[str, int]:
    """Aportes do diário que entram no patrimônio de (after, up_to], somados por mês ("YYYY-MM").

    Vale a data em que o saldo passa a mostrar o aporte (`aporte_effective_date`, em geral a do
    próprio aporte), não o mês: o que já estava no patrimônio de `after` fica de fora. O mês é o
    da data do aporte. Só `kind="aporte"` entra (inclui compras com o caixa); transferência é
    neutra e provento é rendimento.
    """
    observed = _observed_dates(session)
    totals: dict[str, int] = {}
    for movement in repo.list_movements(session, kind="aporte"):
        effective = aporte_effective_date(movement, observed.get(movement.asset_id, []))
        if effective is not None and after < effective <= up_to:
            month = movement.date.strftime("%Y-%m")
            totals[month] = totals.get(month, 0) + movement.amount_cents
    return totals


def redemptions_in_period(session: Session, after: date, up_to: date) -> int:
    """Total resgatado dos ativos com data em (after, up_to].

    A data é a efetiva (`redemption_effective_date`): a em que o patrimônio dos fechamentos passa a
    mostrar a queda. No resgate comum é a do movimento; no que já veio no saldo digitado, a do
    primeiro saldo digitado depois dele, porque um fechamento tirado antes disso ainda tem o
    dinheiro. Mesma regra de borda de `aportes_in_period`: o que vale na data de `after` já estava
    no fechamento daquele dia. Quem mede a valorização soma isso de volta à variação do patrimônio,
    porque o dinheiro que saiu não é prejuízo.
    """
    observed = _observed_dates(session)
    total = 0
    for movement in repo.list_movements(session, kind="resgate"):
        effective = redemption_effective_date(
            movement.date, movement.in_balance, observed.get(movement.asset_id, [])
        )
        if effective is not None and after < effective <= up_to:
            total += movement.amount_cents
    return total


@dataclass(frozen=True)
class NewAssets:
    """Ativos cadastrados num período e o que já está embutido no valor inicial deles."""

    invested_cents: int  # soma do investido na 1ª valorização de cada ativo novo
    # Aportes do diário (dentro do período) já contidos nesse investido, por mês: quem soma o
    # diário os descontaria para não contar o mesmo dinheiro duas vezes.
    folded_by_month: dict[str, int]


def new_assets_in_period(session: Session, after: date, up_to: date) -> NewAssets:
    """Ativos cadastrados em (after, up_to]: a data é a da 1ª linha de valor do ativo.

    Só entram ativos SEM aporte inicial: o marcado como novo já tem esse dinheiro no diário
    (`aportes_in_period`), e somar aqui de novo o contaria em dobro.

    Entra o valor INVESTIDO inicial, não o atual: o ganho já acumulado até o cadastro é
    valorização, não dinheiro novo. Cadastrar não grava movimento, mas aportes lançados até a data
    da 1ª valorização (ex.: aporte dias antes, saldo lançado depois) já estão nesse investido.
    Transferências feitas no dia do cadastro também mexem nessa linha (ela é reaproveitada): o
    custo recebido já era patrimônio de outro ativo, então sai; o custo enviado volta, pois foi
    dinheiro novo do ativo que foi parar em outro. O custo de um resgate no dia do cadastro conta
    como custo enviado: saiu da mesma linha, mas o dinheiro que entrou foi o de antes.
    """
    aportes = repo.list_movements(session, kind="aporte")
    transfers = repo.list_movements(session, kind="transferencia")
    redemptions = repo.list_movements(session, kind="resgate")
    invested = 0
    folded: dict[str, int] = {}
    with_initial = repo.initial_movements_by_asset(session)
    for first in repo.list_first_valuations(session):
        if not after < first.date <= up_to or first.asset_id in with_initial:
            continue
        received = sum(
            m.cost_cents or 0
            for m in transfers
            if m.asset_id == first.asset_id and m.date <= first.date
        )
        sent = sum(
            m.cost_cents or 0
            for m in transfers
            if m.related_asset_id == first.asset_id and m.date <= first.date
        ) + sum(
            m.cost_cents or 0
            for m in redemptions
            if m.asset_id == first.asset_id and m.date <= first.date
        )
        invested += max(0, first.invested_cents - received + sent)
        for movement in aportes:
            # Mesmo o aporte datado antes do período: o saldo do ativo novo o mostra no cadastro
            # (`aportes_in_period` o conta ali), então sai do diário junto com o investido.
            if movement.asset_id == first.asset_id and movement.date <= first.date:
                month = movement.date.strftime("%Y-%m")
                folded[month] = folded.get(month, 0) + movement.amount_cents
    return NewAssets(invested_cents=invested, folded_by_month=folded)


def get_month_summary(session: Session, month: str) -> MonthSummary:
    """Quanto já foi aportado no mês, por categoria e na reserva (para comparar com o plano).

    Inclui o aporte inicial dos ativos novos; `registered_cents` e `new_assets_cents` separam o
    que foi lançado do que entrou com o cadastro, e os dois somam `total_cents`.
    """
    classes = {c.id: c for c in repo.list_classes(session)}
    by_class = {cid: 0 for cid in classes}
    reserve = proventos = registered = redemptions = 0
    new_assets: list[NewAssetAmount] = []
    for movement in repo.list_movements(session, month=month):
        if movement.kind == "provento":
            proventos += movement.amount_cents
        elif movement.kind == "resgate":
            redemptions += movement.amount_cents
        elif movement.kind == "aporte":
            if movement.initial:
                new_assets.append(
                    NewAssetAmount(
                        asset_id=movement.asset_id,
                        asset_name=movement.asset.name,
                        amount_cents=movement.amount_cents,
                    )
                )
            else:
                registered += movement.amount_cents
            if movement.asset.purpose == "reserva":
                reserve += movement.amount_cents
            elif movement.asset.class_id in by_class:
                by_class[movement.asset.class_id] += movement.amount_cents
    return MonthSummary(
        month=month,
        by_class=[
            ClassMonthAmount(
                class_key=classes[cid].key,
                class_name=classes[cid].name,
                color=classes[cid].color,
                amount_cents=amount,
            )
            for cid, amount in by_class.items()
        ],
        reserve_cents=reserve,
        total_cents=reserve + sum(by_class.values()),
        registered_cents=registered,
        new_assets_cents=sum(item.amount_cents for item in new_assets),
        new_assets=new_assets,
        proventos_cents=proventos,
        redemptions_cents=redemptions,
    )
