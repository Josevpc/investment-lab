"""Aporte inicial: o dinheiro com que um ativo NOVO entrou na carteira.

Cadastrar um ativo não grava movimento (o valor investido já está na 1ª valorização). Quando o
usuário diz que o ativo é novo, esse valor vira um aporte de verdade no diário, marcado
`initial`, na data da 1ª valorização, para entrar nas somas do mês. Ele é só um registro: nunca
mexe em saldos nem no caixa (o dinheiro já está no investido e no saldo do ativo).

Fica separado do `service` e do `movements` porque os dois precisam dele e um já importa o outro;
aqui só se usa o repositório. Nenhuma função faz `commit`: quem chama decide a transação.
"""

import datetime as dt

from sqlalchemy.orm import Session

from app.core.errors import InvalidInputError
from app.features.portfolio import repository as repo
from app.features.portfolio.models import Asset, AssetMovement


def compute(session: Session, asset: Asset) -> tuple[int, dt.date]:
    """Valor e data do aporte inicial do ativo, a partir da 1ª valorização.

    Valor = investido da 1ª valorização, menos o custo de transferências recebidas até essa data
    (já era patrimônio de outro ativo), mais o custo enviado (foi dinheiro novo deste ativo que
    foi parar em outro; o custo de um resgate no dia entra igual), menos os aportes comuns até a
    data (já estão nesse investido). É a mesma conta de `new_assets_in_period`. Sem valor próprio
    (zero ou menos), recusa.
    """
    session.flush()  # a 1ª valorização pode ter acabado de ser criada ou corrigida
    first = repo.get_first_valuation(session, asset.id)
    if first is None:
        raise InvalidInputError(f"{asset.name} ainda não tem valores cadastrados.")
    amount = first.invested_cents
    for movement in repo.list_movements(session, asset_id=asset.id):
        if movement.date > first.date:
            continue
        if movement.kind == "transferencia":
            cost = movement.cost_cents or 0
            amount += -cost if movement.asset_id == asset.id else cost
        elif movement.kind == "aporte" and movement.asset_id == asset.id and not movement.initial:
            amount -= movement.amount_cents
        elif movement.kind == "resgate" and movement.asset_id == asset.id:
            # Saiu dessa linha, mas o dinheiro que entrou no cadastro foi o de antes do resgate.
            amount += movement.cost_cents or 0
    if amount <= 0:
        raise InvalidInputError(
            f"{asset.name} começou sem valor investido próprio; não há aporte inicial para "
            "registrar."
        )
    return amount, first.date


def mark_as_new(session: Session, asset: Asset) -> None:
    """Cria o aporte inicial do ativo ou, se já existe, atualiza valor e data."""
    amount, on_date = compute(session, asset)
    movement = repo.get_initial_movement(session, asset.id)
    if movement is None:
        session.add(
            AssetMovement(
                date=on_date, kind="aporte", asset_id=asset.id, amount_cents=amount, initial=True
            )
        )
    else:
        movement.amount_cents, movement.date = amount, on_date


def mark_as_old(session: Session, asset: Asset) -> None:
    """Remove o aporte inicial; saldos e valorizações não mudam."""
    movement = repo.get_initial_movement(session, asset.id)
    if movement is not None:
        session.delete(movement)


def resync(session: Session, asset: Asset) -> None:
    """Acompanha a 1ª valorização quando ela muda (valor, data, nova mais antiga ou removida)."""
    if repo.get_initial_movement(session, asset.id) is not None:
        mark_as_new(session, asset)
