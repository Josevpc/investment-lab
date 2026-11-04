import datetime as dt

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.features.portfolio.models import (
    Asset,
    AssetClass,
    AssetGroup,
    AssetMovement,
    AssetValuation,
    Institution,
)


def list_classes(session: Session, *, include_archived: bool = False) -> list[AssetClass]:
    stmt = select(AssetClass).order_by(AssetClass.id)
    if not include_archived:
        stmt = stmt.where(AssetClass.archived.is_(False))
    return list(session.scalars(stmt))


def get_class(session: Session, class_id: int) -> AssetClass | None:
    return session.get(AssetClass, class_id)


def get_class_by_key(session: Session, key: str) -> AssetClass | None:
    return session.scalar(select(AssetClass).where(AssetClass.key == key))


def get_class_by_name(session: Session, name: str) -> AssetClass | None:
    return session.scalar(select(AssetClass).where(func.lower(AssetClass.name) == name.lower()))


def list_groups(session: Session, *, include_archived: bool = False) -> list[AssetGroup]:
    stmt = select(AssetGroup).order_by(AssetGroup.id)
    if not include_archived:
        stmt = stmt.where(AssetGroup.archived.is_(False))
    return list(session.scalars(stmt))


def get_group(session: Session, group_id: int) -> AssetGroup | None:
    return session.get(AssetGroup, group_id)


def get_group_by_name(session: Session, name: str) -> AssetGroup | None:
    return session.scalar(select(AssetGroup).where(func.lower(AssetGroup.name) == name.lower()))


def list_classes_in_group(session: Session, group_id: int) -> list[AssetClass]:
    """Categorias do grupo, arquivadas inclusive (o histórico delas continua sendo do grupo)."""
    return list(
        session.scalars(
            select(AssetClass).where(AssetClass.group_id == group_id).order_by(AssetClass.id)
        )
    )


def class_has_active_assets(session: Session, class_id: int) -> bool:
    return (
        session.scalar(
            select(Asset.id).where(Asset.class_id == class_id, Asset.archived.is_(False)).limit(1)
        )
        is not None
    )


def list_institutions(session: Session) -> list[Institution]:
    return list(session.scalars(select(Institution).order_by(Institution.name)))


def get_institution(session: Session, institution_id: int) -> Institution | None:
    return session.get(Institution, institution_id)


def get_institution_by_name(session: Session, name: str) -> Institution | None:
    return session.scalar(select(Institution).where(func.lower(Institution.name) == name.lower()))


def institution_has_assets(session: Session, institution_id: int) -> bool:
    return (
        session.scalar(select(Asset.id).where(Asset.institution_id == institution_id).limit(1))
        is not None
    )


def account_has_active_assets(session: Session, account_id: int) -> bool:
    return (
        session.scalar(
            select(Asset.id)
            .where(Asset.account_id == account_id, Asset.archived.is_(False))
            .limit(1)
        )
        is not None
    )


def get_asset(session: Session, asset_id: int) -> Asset | None:
    return session.get(Asset, asset_id)


def _latest_valuation_subquery():
    return (
        select(AssetValuation.asset_id, func.max(AssetValuation.date).label("latest"))
        .group_by(AssetValuation.asset_id)
        .subquery()
    )


def list_assets_with_latest(
    session: Session, *, include_archived: bool
) -> list[tuple[Asset, AssetValuation]]:
    latest = _latest_valuation_subquery()
    stmt = (
        select(Asset, AssetValuation)
        .join(AssetValuation, AssetValuation.asset_id == Asset.id)
        .join(
            latest,
            and_(
                latest.c.asset_id == AssetValuation.asset_id, latest.c.latest == AssetValuation.date
            ),
        )
        .order_by(Asset.name)
    )
    if not include_archived:
        stmt = stmt.where(Asset.archived.is_(False))
    return [(row[0], row[1]) for row in session.execute(stmt)]


def list_assets(session: Session) -> list[Asset]:
    """Todos os ativos, arquivados inclusive."""
    return list(session.scalars(select(Asset).order_by(Asset.id)))


def list_first_valuations(session: Session) -> list[AssetValuation]:
    """A primeira linha de valor de cada ativo (inclusive arquivados): o cadastro dele."""
    first = (
        select(AssetValuation.asset_id, func.min(AssetValuation.date).label("first"))
        .group_by(AssetValuation.asset_id)
        .subquery()
    )
    stmt = select(AssetValuation).join(
        first,
        and_(first.c.asset_id == AssetValuation.asset_id, first.c.first == AssetValuation.date),
    )
    return list(session.scalars(stmt))


def get_asset_with_latest(session: Session, asset_id: int) -> tuple[Asset, AssetValuation] | None:
    latest = _latest_valuation_subquery()
    stmt = (
        select(Asset, AssetValuation)
        .join(AssetValuation, AssetValuation.asset_id == Asset.id)
        .join(
            latest,
            and_(
                latest.c.asset_id == AssetValuation.asset_id, latest.c.latest == AssetValuation.date
            ),
        )
        .where(Asset.id == asset_id)
    )
    row = session.execute(stmt).first()
    return (row[0], row[1]) if row else None


def get_valuation(session: Session, asset_id: int, on_date) -> AssetValuation | None:
    return session.scalar(
        select(AssetValuation).where(
            AssetValuation.asset_id == asset_id, AssetValuation.date == on_date
        )
    )


def list_valuations(session: Session, asset_id: int) -> list[AssetValuation]:
    return list(
        session.scalars(
            select(AssetValuation)
            .where(AssetValuation.asset_id == asset_id)
            .order_by(AssetValuation.date.desc())
        )
    )


def get_first_valuation(session: Session, asset_id: int) -> AssetValuation | None:
    return session.scalar(
        select(AssetValuation)
        .where(AssetValuation.asset_id == asset_id)
        .order_by(AssetValuation.date)
        .limit(1)
    )


def get_latest_valuation(session: Session, asset_id: int) -> AssetValuation | None:
    return session.scalar(
        select(AssetValuation)
        .where(AssetValuation.asset_id == asset_id)
        .order_by(AssetValuation.date.desc())
        .limit(1)
    )


def proventos_by_asset(session: Session) -> dict[int, int]:
    rows = session.execute(
        select(AssetMovement.asset_id, func.sum(AssetMovement.amount_cents))
        .where(AssetMovement.kind == "provento")
        .group_by(AssetMovement.asset_id)
    )
    return {asset_id: int(total) for asset_id, total in rows}


def list_valuation_history(session: Session) -> list[AssetValuation]:
    """Todos os registros de valor de todos os ativos, inclusive os arquivados, numa só consulta.

    Arquivar tira o ativo da carteira atual, mas não reescreve os meses em que ele existiu.
    """
    stmt = select(AssetValuation).order_by(AssetValuation.asset_id, AssetValuation.date)
    return list(session.scalars(stmt))


def list_proventos(session: Session) -> list[tuple[dt.date, int, bool]]:
    """Proventos pagos por qualquer ativo: (data, valor, creditado em algum ativo)."""
    stmt = (
        select(AssetMovement.date, AssetMovement.amount_cents, AssetMovement.related_asset_id)
        .where(AssetMovement.kind == "provento")
        .order_by(AssetMovement.date, AssetMovement.id)
    )
    return [
        (day, int(amount), related is not None) for day, amount, related in session.execute(stmt)
    ]


def get_movement(session: Session, movement_id: int) -> AssetMovement | None:
    return session.get(AssetMovement, movement_id)


def get_initial_movement(session: Session, asset_id: int) -> AssetMovement | None:
    return session.scalar(
        select(AssetMovement).where(AssetMovement.asset_id == asset_id, AssetMovement.initial)
    )


def initial_movements_by_asset(session: Session) -> dict[int, AssetMovement]:
    """O aporte inicial de cada ativo marcado como novo (no máximo um por ativo)."""
    rows = session.scalars(select(AssetMovement).where(AssetMovement.initial))
    return {movement.asset_id: movement for movement in rows}


def list_movements(
    session: Session,
    *,
    month: str | None = None,
    kind: str | None = None,
    asset_id: int | None = None,
) -> list[AssetMovement]:
    stmt = select(AssetMovement).order_by(AssetMovement.date.desc(), AssetMovement.id.desc())
    if month is not None:
        year, mon = (int(part) for part in month.split("-"))
        start = dt.date(year, mon, 1)
        end = dt.date(year + (mon == 12), mon % 12 + 1, 1)
        stmt = stmt.where(AssetMovement.date >= start, AssetMovement.date < end)
    if kind is not None:
        stmt = stmt.where(AssetMovement.kind == kind)
    if asset_id is not None:
        stmt = stmt.where(
            (AssetMovement.asset_id == asset_id) | (AssetMovement.related_asset_id == asset_id)
        )
    return list(session.scalars(stmt))


def get_valuation_by_id(
    session: Session, asset_id: int, valuation_id: int
) -> AssetValuation | None:
    return session.scalar(
        select(AssetValuation).where(
            AssetValuation.id == valuation_id, AssetValuation.asset_id == asset_id
        )
    )


def count_valuations(session: Session, asset_id: int) -> int:
    return int(
        session.scalar(
            select(func.count())
            .select_from(AssetValuation)
            .where(AssetValuation.asset_id == asset_id)
        )
        or 0
    )
