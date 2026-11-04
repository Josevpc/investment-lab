from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import Session

from app.core.errors import ConflictError, InvalidInputError, NotFoundError
from app.features.contributions.service import final_by_month
from app.features.history import repository as repo
from app.features.history.domain import combine_contributions
from app.features.history.models import Snapshot, SnapshotItem
from app.features.history.schemas import (
    EvolutionClass,
    EvolutionOut,
    EvolutionPoint,
    EvolutionSummary,
    SnapshotClassValue,
    SnapshotCreate,
    SnapshotItemIn,
    SnapshotOut,
    SnapshotUpdate,
)
from app.features.portfolio.movements import (
    aportes_in_period,
    new_assets_in_period,
    redemptions_in_period,
)
from app.features.portfolio.service import get_timeline, list_asset_classes, list_positions
from app.features.portfolio.timeline import Timeline


def _all_classes(session: Session) -> dict:
    """Todas as categorias, inclusive arquivadas: o histórico nunca perde uma categoria."""
    return {c.id: c for c in list_asset_classes(session, include_archived=True)}


def _snapshot_out(snapshot: Snapshot, classes: dict) -> SnapshotOut:
    totals: dict[int, list[int]] = {}
    for item in snapshot.items:
        entry = totals.setdefault(item.class_id, [0, 0])
        entry[0] += item.current_cents
        entry[1] += item.invested_cents
    return SnapshotOut(
        id=snapshot.id,
        date=snapshot.date,
        total_cents=snapshot.total_cents,
        invested_cents=snapshot.invested_cents,
        assets_count=sum(1 for item in snapshot.items if item.asset_id is not None),
        manual=any(item.asset_id is None for item in snapshot.items) or not snapshot.items,
        reserve_cents=snapshot.reserve_cents,
        # O investido total inclui o da reserva; tirando o das categorias sobra o dela.
        reserve_invested_cents=max(
            0, snapshot.invested_cents - sum(invested for _, invested in totals.values())
        ),
        by_class=[
            SnapshotClassValue(
                class_id=cid,
                class_key=classes[cid].key,
                class_name=classes[cid].name,
                color=classes[cid].color,
                archived=classes[cid].archived,
                current_cents=current,
                invested_cents=invested,
            )
            for cid, (current, invested) in sorted(totals.items())
        ],
    )


def _manual_items(session: Session, items: list[SnapshotItemIn]) -> list[SnapshotItem]:
    by_key = {c.key: c for c in _all_classes(session).values()}
    seen: set[str] = set()
    result = []
    for item in items:
        if item.class_key not in by_key:
            raise InvalidInputError(f"Categoria desconhecida: {item.class_key}.")
        if item.class_key in seen:
            raise InvalidInputError(f"A categoria {item.class_key} foi informada mais de uma vez.")
        seen.add(item.class_key)
        result.append(
            SnapshotItem(
                asset_id=None,
                class_id=by_key[item.class_key].id,
                invested_cents=item.invested_cents,
                current_cents=item.current_cents,
            )
        )
    return result


def _from_portfolio(session: Session) -> tuple[list[SnapshotItem], int, int]:
    """Itens dos investimentos e, à parte, o valor atual e o investido da reserva."""
    positions = list_positions(session)
    if not positions:
        raise InvalidInputError("Cadastre ao menos um ativo antes de registrar um snapshot.")
    items = [
        SnapshotItem(
            asset_id=p.asset_id,
            class_id=p.class_id,
            invested_cents=p.invested_cents,
            current_cents=p.current_cents,
        )
        for p in positions
        if not p.is_reserve
    ]
    reserve = [p for p in positions if p.is_reserve]
    return (
        items,
        sum(p.current_cents for p in reserve),
        sum(p.invested_cents for p in reserve),
    )


def _totals(items: list[SnapshotItem], reserve: int, reserve_invested: int) -> tuple[int, int]:
    total = sum(i.current_cents for i in items) + reserve
    invested = sum(i.invested_cents for i in items) + reserve_invested
    return total, invested


def _require_content(items: list, reserve: int) -> None:
    if not items and reserve <= 0:
        raise InvalidInputError("Informe o valor de ao menos uma categoria ou da reserva.")


def create_snapshot(session: Session, data: SnapshotCreate) -> SnapshotOut:
    on_date = data.date or date.today()
    if repo.get_snapshot_by_date(session, on_date):
        raise ConflictError("Já existe um snapshot para essa data. Exclua-o ou edite-o.")

    if data.items is not None or data.reserve_cents is not None:
        items = _manual_items(session, data.items or [])
        reserve = data.reserve_cents or 0
        # Sem reserva não há o que investir nela: um investido informado sozinho seria fantasma.
        reserve_invested = data.reserve_invested_cents if reserve > 0 else 0
        if reserve_invested is None:
            reserve_invested = reserve
        _require_content(items, reserve)
    else:
        items, reserve, reserve_invested = _from_portfolio(session)

    total, invested = _totals(items, reserve, reserve_invested)
    snapshot = Snapshot(
        date=on_date,
        total_cents=total,
        invested_cents=invested,
        reserve_cents=reserve,
        items=items,
    )
    session.add(snapshot)
    session.commit()
    return _snapshot_out(snapshot, _all_classes(session))


def update_snapshot(session: Session, snapshot_id: int, data: SnapshotUpdate) -> SnapshotOut:
    """Substitui data e valores por categoria (a edição converte o snapshot em digitado)."""
    snapshot = repo.get_snapshot(session, snapshot_id)
    if snapshot is None:
        raise NotFoundError("Snapshot não encontrado.")
    other = repo.get_snapshot_by_date(session, data.date)
    if other and other.id != snapshot.id:
        raise ConflictError("Já existe um snapshot para essa data.")
    items = _manual_items(session, data.items)
    _require_content(items, data.reserve_cents)
    reserve_invested = data.reserve_invested_cents if data.reserve_cents > 0 else 0
    if data.reserve_invested_cents is None:
        # Editar não pode virar aporte: mantém o investido da reserva. Se o fechamento não tinha
        # reserva (ou a edição a zera), não há rendimento a preservar: investido igual ao atual.
        keeps_reserve = snapshot.reserve_cents > 0 and data.reserve_cents > 0
        reserve_invested = (
            max(0, snapshot.invested_cents - sum(i.invested_cents for i in snapshot.items))
            if keeps_reserve
            else data.reserve_cents
        )
    snapshot.items.clear()
    session.flush()
    snapshot.items.extend(items)
    snapshot.date = data.date
    snapshot.reserve_cents = data.reserve_cents
    snapshot.total_cents, snapshot.invested_cents = _totals(
        items, data.reserve_cents, reserve_invested
    )
    session.commit()
    return _snapshot_out(snapshot, _all_classes(session))


def list_snapshots(session: Session) -> list[SnapshotOut]:
    classes = _all_classes(session)
    return [_snapshot_out(s, classes) for s in repo.list_snapshots(session, newest_first=True)]


def delete_snapshot(session: Session, snapshot_id: int) -> None:
    snapshot = repo.get_snapshot(session, snapshot_id)
    if snapshot is None:
        raise NotFoundError("Snapshot não encontrado.")
    session.delete(snapshot)
    session.commit()


def get_evolution(
    session: Session,
    start: date | None,
    end: date | None,
    timeline: Timeline | None = None,
) -> EvolutionOut:
    """Patrimônio nas datas com saldo digitado (e não nos fechamentos), por categoria.

    Quem já montou a linha do tempo pode passá-la para não montá-la de novo.
    """
    classes = _all_classes(session)
    timeline = timeline or get_timeline(session)
    days = [
        d for d in timeline.dates if (start is None or d >= start) and (end is None or d <= end)
    ]

    used_keys = {
        timeline.assets[asset_id].class_key
        for day in days
        for asset_id, state in timeline.states[day].items()
        if state.current_cents > 0 and not timeline.assets[asset_id].is_reserve
    }
    # Categorias ativas sempre aparecem; as arquivadas só se tiveram valor no período.
    shown = [c for c in classes.values() if not c.archived or c.key in used_keys]

    points = []
    for day in days:
        by_class = {c.key: 0 for c in shown}
        reserve = 0
        for asset_id, state in timeline.states[day].items():
            info = timeline.assets[asset_id]
            if info.is_reserve:
                reserve += state.current_cents
            elif info.class_key in by_class:
                by_class[info.class_key] += state.current_cents
        total, invested = timeline.totals(day, lambda _asset_id: True)
        points.append(
            EvolutionPoint(
                date=day,
                total_cents=total,
                invested_cents=invested,
                by_class=by_class,
                reserve_cents=reserve,
            )
        )

    summary = None
    if len(points) >= 2:
        first, last = points[0], points[-1]
        # Diário por data: entra o aporte feito depois do 1º fechamento até o dia do último
        # (inclusive); o do dia do 1º já estava naquele patrimônio. Mês com diário usa só o diário;
        # sem diário, o planejado (por mês, depois do mês do 1º fechamento até o do último) vale
        # como estimativa e o resumo avisa quais meses foram.
        diary = aportes_in_period(session, first.date, last.date)
        planned = final_by_month(session, first.date.strftime("%Y-%m"), last.date.strftime("%Y-%m"))
        # Ativo cadastrado no período não tem movimento: o valor investido inicial dele é dinheiro
        # que entrou. Aportes que já estão nesse valor saem do diário, mas o mês continua "com
        # diário" (a chave fica, mesmo zerada) para não cair no planejado e contar de novo.
        new_assets = new_assets_in_period(session, first.date, last.date)
        diary = {m: cents - new_assets.folded_by_month.get(m, 0) for m, cents in diary.items()}
        combined = combine_contributions(diary, planned)
        contributions = combined.cents + new_assets.invested_cents
        change = last.total_cents - first.total_cents
        # O resgate tirou dinheiro do patrimônio sem ser perda: volta à conta da valorização.
        withdrawals = redemptions_in_period(session, first.date, last.date)
        # Arquivar um ativo com saldo, sem resgate, também tira dinheiro do patrimônio sem ser
        # perda: a saída vale na data em que a linha do tempo deixa de somá-lo.
        archived_out = timeline.archived_out(first.date, last.date)
        summary = EvolutionSummary(
            start_date=first.date,
            end_date=last.date,
            start_total_cents=first.total_cents,
            end_total_cents=last.total_cents,
            change_cents=change,
            contributions_cents=contributions,
            withdrawals_cents=withdrawals,
            archived_out_cents=archived_out,
            appreciation_cents=change - contributions + withdrawals + archived_out,
            contributions_source=combined.source,
            estimated_months=combined.estimated_months,
            new_assets_cents=new_assets.invested_cents,
        )

    return EvolutionOut(
        classes=[
            EvolutionClass(key=c.key, name=c.name, color=c.color, archived=c.archived)
            for c in shown
        ],
        points=points,
        summary=summary,
    )


# ---- interface pública para outras features (metas) -------------------------


@dataclass(frozen=True)
class SnapshotRow:
    """Um snapshot em forma simples: valores por categoria e o que estava na reserva."""

    date: date
    total_cents: int
    invested_cents: int
    reserve_cents: int
    # categoria (chave) -> (valor atual, valor investido), sem a reserva
    by_class: dict[str, tuple[int, int]]

    @property
    def reserve_invested_cents(self) -> int:
        """O investido total inclui o da reserva; tirando o das categorias sobra o dela."""
        return self.invested_cents - sum(invested for _, invested in self.by_class.values())


def list_snapshot_rows(
    session: Session, start: date | None = None, end: date | None = None
) -> list[SnapshotRow]:
    classes = _all_classes(session)
    rows = []
    for snapshot in repo.list_snapshots(session, start=start, end=end, newest_first=False):
        by_class: dict[str, list[int]] = {}
        for item in snapshot.items:
            entry = by_class.setdefault(classes[item.class_id].key, [0, 0])
            entry[0] += item.current_cents
            entry[1] += item.invested_cents
        rows.append(
            SnapshotRow(
                date=snapshot.date,
                total_cents=snapshot.total_cents,
                invested_cents=snapshot.invested_cents,
                reserve_cents=snapshot.reserve_cents,
                by_class={
                    key: (current, invested) for key, (current, invested) in by_class.items()
                },
            )
        )
    return rows
