from collections.abc import Collection

from sqlalchemy.orm import Session

from app.core.errors import ConflictError, InvalidInputError, NotFoundError
from app.core.money import BPS, split_by_weights
from app.features.allocation import domain
from app.features.allocation import repository as repo
from app.features.allocation.models import AllocationPlan, AllocationTarget
from app.features.allocation.schemas import (
    ComparisonItem,
    ComparisonOut,
    GroupComparisonItem,
    HeldAssetOut,
    PlanIn,
    PlanOut,
    ReceivingAssetOut,
    SplitIn,
    SplitItem,
    SplitOut,
    TargetOut,
)
from app.features.portfolio.movements import get_month_summary
from app.features.portfolio.service import (
    ClassHold,
    class_current_values,
    class_hold_status,
    list_asset_classes,
    list_asset_groups,
)

DEFAULT_PLAN_NAME = "Plano padrão"


def ensure_default_plan(session: Session) -> None:
    """Cria um plano neutro (partes iguais) na primeira execução."""
    if repo.list_plans(session):
        return
    classes = list_asset_classes(session)
    if not classes:
        return
    shares = split_by_weights(BPS, {c.id: 1 for c in classes})
    plan = AllocationPlan(name=DEFAULT_PLAN_NAME, is_active=True)
    plan.targets = [AllocationTarget(class_id=cid, percent_bps=bps) for cid, bps in shares.items()]
    session.add(plan)
    session.commit()


def sync_plan_targets(session: Session) -> None:
    """Mantém todos os planos alinhados às categorias ativas.

    Categoria nova entra com 0% e categoria arquivada sai do plano, com o percentual dela
    redistribuído proporcionalmente entre as que ficam. A soma volta sempre a 100% (RN-01).

    Só a lista de categorias mexe nas metas. A marca "manter posição" (que é dos ativos) nunca
    reescreve um plano, ativo ou não: a meta gravada só muda quando o usuário salva o plano. A
    categoria com todos os ativos mantidos é tratada na hora do cálculo (`effective_targets`).
    """
    active_ids = [c.id for c in list_asset_classes(session)]
    if not active_ids:
        return
    changed = False
    for plan in repo.list_plans(session):
        current = {t.class_id: t.percent_bps for t in plan.targets}
        if set(current) == set(active_ids) and sum(current.values()) == BPS:
            continue
        kept = {cid: current.get(cid, 0) for cid in active_ids}
        if sum(kept.values()) != BPS:
            weights = kept if sum(kept.values()) > 0 else {cid: 1 for cid in active_ids}
            kept = split_by_weights(BPS, weights)
        plan.targets.clear()
        session.flush()
        plan.targets.extend(
            AllocationTarget(class_id=cid, percent_bps=kept[cid]) for cid in active_ids
        )
        changed = True
    if changed:
        session.commit()


def split_amounts(
    amount_cents: int,
    targets_bps: dict[int, int],
    current_cents: dict[int, int],
    mode: str,
    fully_held: Collection[int] = (),
) -> dict[int, int]:
    """Divide um aporte entre as categorias (função pura, usada também pelas projeções).

    O aporte é dividido por categoria. As categorias em `fully_held` (todos os ativos em "manter
    posição") saem do cálculo antes de dividir: ficam sem peso e fora do total da carteira que o
    rebalanceamento usa, e as metas das outras são reescaladas (`effective_targets`). Assim nenhum
    centavo de arredondamento sobra nelas, elas recebem 0 e a soma continua exatamente o aporte. Já
    o ativo mantido de uma categoria só parcialmente mantida segue contando no valor dela.
    """
    receiving = [cid for cid in targets_bps if cid not in fully_held]
    if not receiving:
        if amount_cents:
            raise InvalidInputError(
                "Todos os ativos de todas as categorias estão em 'manter posição'. "
                "Desmarque algum ativo para dividir o aporte.",
                code="all_held",  # código estável: a tela não depende do texto da mensagem
            )
        return dict.fromkeys(targets_bps, 0)
    effective = effective_targets(targets_bps, fully_held)
    weights = {cid: effective[cid] for cid in receiving}
    values = {cid: current_cents.get(cid, 0) for cid in receiving}
    if mode == "rebalance":
        parts = domain.split_rebalance(amount_cents, weights, values)
    else:
        parts = domain.split_proportional(amount_cents, weights)
    return {cid: parts.get(cid, 0) for cid in targets_bps}


def effective_targets(
    targets_bps: dict[int, int], fully_held: Collection[int] = ()
) -> dict[int, int]:
    """Metas que valem na conta (interface para as projeções): um só lugar para o arredondamento."""
    return domain.effective_targets(targets_bps, fully_held)


def fully_held_ids(hold: dict[int, ClassHold]) -> set[int]:
    """Categorias com ao menos um ativo e todos eles em "manter posição" (status "all")."""
    return {cid for cid, info in hold.items() if info.status == "all"}


def _plan_out(session: Session, plan: AllocationPlan) -> PlanOut:
    classes = {c.id: c for c in list_asset_classes(session)}
    return PlanOut(
        id=plan.id,
        name=plan.name,
        is_active=plan.is_active,
        created_at=plan.created_at,
        targets=[
            TargetOut(
                class_id=t.class_id,
                class_key=classes[t.class_id].key,
                class_name=classes[t.class_id].name,
                color=classes[t.class_id].color,
                percent_bps=t.percent_bps,
            )
            for t in plan.targets
        ],
    )


def _get_plan(session: Session, plan_id: int) -> AllocationPlan:
    sync_plan_targets(session)
    plan = repo.get_plan(session, plan_id)
    if plan is None:
        raise NotFoundError("Plano de alocação não encontrado.")
    return plan


def _targets_from_input(session: Session, data: PlanIn) -> list[AllocationTarget]:
    classes = {c.key: c for c in list_asset_classes(session)}
    by_class: dict[int, int] = {c.id: 0 for c in classes.values()}
    seen: set[str] = set()
    for target in data.targets:
        if target.class_key not in classes:
            raise InvalidInputError(f"Categoria desconhecida ou arquivada: {target.class_key}.")
        if target.class_key in seen:
            raise InvalidInputError(
                f"A categoria {target.class_key} foi informada mais de uma vez."
            )
        seen.add(target.class_key)
        by_class[classes[target.class_key].id] = target.percent_bps
    domain.validate_targets(by_class)
    return [AllocationTarget(class_id=cid, percent_bps=bps) for cid, bps in by_class.items()]


def list_plans(session: Session) -> list[PlanOut]:
    sync_plan_targets(session)
    return [_plan_out(session, p) for p in repo.list_plans(session)]


def get_plan(session: Session, plan_id: int) -> PlanOut:
    return _plan_out(session, _get_plan(session, plan_id))


def create_plan(session: Session, data: PlanIn) -> PlanOut:
    sync_plan_targets(session)
    if repo.get_plan_by_name(session, data.name):
        raise ConflictError("Já existe um plano com esse nome.")
    plan = AllocationPlan(name=data.name, is_active=False)
    plan.targets = _targets_from_input(session, data)
    session.add(plan)
    session.commit()
    return _plan_out(session, plan)


def update_plan(session: Session, plan_id: int, data: PlanIn) -> PlanOut:
    plan = _get_plan(session, plan_id)
    other = repo.get_plan_by_name(session, data.name)
    if other and other.id != plan.id:
        raise ConflictError("Já existe um plano com esse nome.")
    new_targets = _targets_from_input(session, data)
    plan.name = data.name
    plan.targets.clear()
    session.flush()
    plan.targets.extend(new_targets)
    session.commit()
    return _plan_out(session, plan)


def activate_plan(session: Session, plan_id: int) -> PlanOut:
    plan = _get_plan(session, plan_id)
    repo.deactivate_all(session)
    plan.is_active = True
    session.commit()
    return _plan_out(session, plan)


def delete_plan(session: Session, plan_id: int) -> None:
    plan = _get_plan(session, plan_id)
    if plan.is_active:
        raise ConflictError("O plano ativo não pode ser excluído. Ative outro plano antes.")
    session.delete(plan)
    session.commit()


def _resolve_plan(session: Session, plan_id: int | None) -> AllocationPlan:
    if plan_id is not None:
        return _get_plan(session, plan_id)
    sync_plan_targets(session)
    plan = repo.get_active_plan(session)
    if plan is None:
        raise NotFoundError("Nenhum plano de alocação ativo.")
    return plan


def split_contribution(session: Session, data: SplitIn) -> SplitOut:
    """Divide o aporte pelo plano.

    Com `data.month`, o que já foi aportado nesse mês sai da carteira atual antes do cálculo: a
    divisão parte da posição de antes dos aportes do mês, e salvar de novo não os conta duas vezes.
    """
    plan = _resolve_plan(session, data.plan_id)
    classes = {c.id: c for c in list_asset_classes(session)}
    targets = {t.class_id: t.percent_bps for t in plan.targets}
    hold = class_hold_status(session)
    fully_held = fully_held_ids(hold)
    effective = effective_targets(targets, fully_held)
    current = class_current_values(session)
    if data.month:
        already = {
            c.class_key: c.amount_cents for c in get_month_summary(session, data.month).by_class
        }
        current = {
            cid: max(0, value - already.get(classes[cid].key, 0)) if cid in classes else value
            for cid, value in current.items()
        }

    amounts = split_amounts(data.amount_cents, targets, current, data.mode, fully_held)

    return SplitOut(
        plan_id=plan.id,
        plan_name=plan.name,
        mode=data.mode,
        amount_cents=data.amount_cents,
        items=[
            SplitItem(
                class_id=cid,
                class_key=classes[cid].key,
                class_name=classes[cid].name,
                color=classes[cid].color,
                group_id=classes[cid].group_id,
                target_bps=targets[cid],
                effective_target_bps=effective[cid],
                current_cents=current.get(cid, 0),
                amount_cents=amounts[cid],
                hold_status=hold[cid].status,
                receiving_assets=_receiving_out(hold[cid]),
                held_assets=_held_out(hold[cid]),
            )
            for cid in targets
        ],
    )


def _receiving_out(info: ClassHold) -> list[ReceivingAssetOut]:
    return [ReceivingAssetOut(asset_id=a.asset_id, name=a.name) for a in info.receiving_assets]


def _held_out(info: ClassHold) -> list[HeldAssetOut]:
    return [
        HeldAssetOut(asset_id=a.asset_id, name=a.name, current_cents=a.current_cents)
        for a in info.held_assets
    ]


def compare_portfolio(session: Session, plan_id: int | None = None) -> ComparisonOut:
    plan = _resolve_plan(session, plan_id)
    classes = {c.id: c for c in list_asset_classes(session)}
    targets = {t.class_id: t.percent_bps for t in plan.targets}
    hold = class_hold_status(session)
    fully_held = fully_held_ids(hold)
    current = class_current_values(session)
    comparison = domain.compare_with_targets(current, targets, fully_held)
    groups = _compare_groups(session, classes, comparison, hold)
    return ComparisonOut(
        plan_id=plan.id,
        plan_name=plan.name,
        total_cents=sum(current.values()),
        base_cents=domain.base_cents(current, fully_held),
        items=[
            ComparisonItem(
                class_id=cid,
                class_key=classes[cid].key,
                class_name=classes[cid].name,
                color=classes[cid].color,
                group_id=classes[cid].group_id,
                current_cents=row.current_cents,
                current_bps=row.current_bps,
                target_bps=row.target_bps,
                effective_target_bps=row.effective_target_bps,
                hold_status=hold[cid].status,
                diff_cents=row.diff_cents,
                held_assets=_held_out(hold[cid]),
            )
            for cid, row in comparison.items()
        ],
        groups=groups,
    )


def _compare_groups(
    session: Session,
    classes: dict,
    comparison: dict[int, domain.ClassComparison],
    hold: dict[int, ClassHold],
) -> list[GroupComparisonItem]:
    """Soma, por grupo, a comparação das categorias dele (só apresentação)."""
    groups = list_asset_groups(session)
    members = {g.id: [cid for cid in comparison if classes[cid].group_id == g.id] for g in groups}
    rows = domain.compare_groups(
        members, comparison, {cid: info.status for cid, info in hold.items()}
    )
    return [
        GroupComparisonItem(
            group_id=g.id,
            name=g.name,
            color=g.color,
            class_keys=[classes[cid].key for cid in members[g.id]],
            current_cents=rows[g.id].current_cents,
            current_bps=rows[g.id].current_bps,
            target_bps=rows[g.id].target_bps,
            effective_target_bps=rows[g.id].effective_target_bps,
            diff_cents=rows[g.id].diff_cents,
            hold_status=rows[g.id].hold_status,
        )
        for g in groups
        if g.id in rows
    ]
