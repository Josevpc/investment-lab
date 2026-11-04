"""Serviço de aportes. `sum_final_between` e `salary_for_month` são a interface pública."""

from sqlalchemy.orm import Session

from app.core.errors import ConflictError, InvalidInputError
from app.features.allocation.schemas import SplitIn
from app.features.allocation.service import split_contribution
from app.features.contributions import repository as repo
from app.features.contributions.domain import calculate_contribution
from app.features.contributions.models import Contribution, ContributionItem
from app.features.contributions.schemas import (
    ContributionIn,
    ContributionOut,
    ContributionUpsert,
    PlanItemOut,
)
from app.features.portfolio.service import list_asset_classes


def to_out(session: Session, contribution: Contribution) -> ContributionOut:
    classes = {c.id: c for c in list_asset_classes(session, include_archived=True)}
    return ContributionOut(
        id=contribution.id,
        month=contribution.month,
        salary_cents=contribution.salary_cents,
        percent_bps=contribution.percent_bps,
        calculated_cents=contribution.calculated_cents,
        final_cents=contribution.final_cents,
        overridden=contribution.final_cents != contribution.calculated_cents,
        reserve_cents=contribution.reserve_cents,
        mode=contribution.mode,
        plan_name=contribution.plan_name,
        plan=[
            PlanItemOut(
                class_key=classes[item.class_id].key,
                class_name=classes[item.class_id].name,
                color=classes[item.class_id].color,
                amount_cents=item.amount_cents,
            )
            for item in contribution.items
            if item.class_id in classes
        ],
        created_at=contribution.created_at,
    )


def list_contributions(session: Session) -> list[ContributionOut]:
    return [to_out(session, c) for c in repo.list_all(session)]


def _apply(
    session: Session, contribution: Contribution, data: ContributionUpsert | ContributionIn
) -> None:
    calculated = calculate_contribution(data.salary_cents, data.percent_bps)
    final = calculated if data.final_cents is None else data.final_cents
    if data.reserve_cents > final:
        raise InvalidInputError("A parte da reserva não pode passar do valor do aporte.")

    contribution.salary_cents = data.salary_cents
    contribution.percent_bps = data.percent_bps
    contribution.calculated_cents = calculated
    contribution.final_cents = final
    _freeze_plan(session, contribution, data)


def _freeze_plan(
    session: Session, contribution: Contribution, data: ContributionUpsert | ContributionIn
) -> None:
    """Grava a divisão do mês. É calculada aqui, no servidor, a partir do plano ativo.

    Ao salvar de novo no mesmo mês, o que já foi aportado sai da carteira antes do cálculo: o plano
    parte da posição de antes dos aportes do mês, em vez de contá-los duas vezes.
    """
    split = split_contribution(
        session,
        SplitIn(
            amount_cents=contribution.final_cents - data.reserve_cents,
            mode=data.mode,
            month=contribution.month,
        ),
    )
    classes = {c.key: c.id for c in list_asset_classes(session, include_archived=True)}
    contribution.reserve_cents = data.reserve_cents
    contribution.mode = data.mode
    contribution.plan_name = split.plan_name
    contribution.items.clear()
    session.flush()
    contribution.items.extend(
        ContributionItem(class_id=classes[item.class_key], amount_cents=item.amount_cents)
        for item in split.items
    )


def create_contribution(session: Session, data: ContributionIn) -> ContributionOut:
    if repo.get_by_month(session, data.month):
        raise ConflictError("Já existe um aporte registrado para esse mês.")
    contribution = Contribution(month=data.month)
    session.add(contribution)
    _apply(session, contribution, data)
    session.commit()
    return to_out(session, contribution)


def upsert_contribution(
    session: Session, month: str, data: ContributionUpsert
) -> tuple[ContributionOut, bool]:
    """Cria ou atualiza o aporte do mês. Retorna (aporte, criado?)."""
    contribution = repo.get_by_month(session, month)
    created = contribution is None
    if contribution is None:
        contribution = Contribution(month=month)
        session.add(contribution)
    _apply(session, contribution, data)
    session.commit()
    return to_out(session, contribution), created


def final_by_month(session: Session, after_month: str, up_to_month: str) -> dict[str, int]:
    return repo.final_by_month(session, after_month, up_to_month)


def sum_final_between(session: Session, after_month: str, up_to_month: str) -> int:
    return repo.sum_final_between(session, after_month, up_to_month)


def salary_for_month(session: Session, month: str) -> int | None:
    """Salário vigente no mês: o do aporte do próprio mês ou o mais recente antes dele.

    O salário mais antigo registrado vale para meses anteriores ao primeiro registro.
    """
    return repo.salary_on_or_before(session, month)


def average_salary(session: Session, last_n: int = 12) -> tuple[int | None, int]:
    """Média dos salários dos últimos `last_n` meses registrados e quantos entraram na conta."""
    recent = repo.list_all(session)[:last_n]
    if not recent:
        return None, 0
    total = sum(c.salary_cents for c in recent)
    return (2 * total + len(recent)) // (2 * len(recent)), len(recent)
