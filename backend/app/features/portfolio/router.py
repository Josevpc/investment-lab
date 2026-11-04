from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.features.portfolio import movements, service, withdrawals
from app.features.portfolio.schemas import (
    AssetClassCreate,
    AssetClassOut,
    AssetClassUpdate,
    AssetCreate,
    AssetGroupCreate,
    AssetGroupOut,
    AssetGroupUpdate,
    AssetOut,
    AssetUpdate,
    BalanceIn,
    InstitutionIn,
    InstitutionOut,
    MonthSummary,
    MovementKind,
    MovementOut,
    MovementUpdate,
    PortfolioSummary,
    ProventoIn,
    PurchaseIn,
    PurchaseOut,
    RedemptionIn,
    TransferIn,
    ValuationIn,
    ValuationOut,
    ValuationUpdate,
    WithdrawalsOut,
)

router = APIRouter(tags=["portfolio"])


@router.get("/asset-classes", response_model=list[AssetClassOut])
def list_asset_classes(include_archived: bool = False, session: Session = Depends(get_session)):
    return service.list_asset_classes(session, include_archived=include_archived)


@router.post("/asset-classes", response_model=AssetClassOut, status_code=status.HTTP_201_CREATED)
def create_asset_class(data: AssetClassCreate, session: Session = Depends(get_session)):
    return service.create_class(session, data)


@router.put("/asset-classes/{class_id}", response_model=AssetClassOut)
def update_asset_class(
    class_id: int, data: AssetClassUpdate, session: Session = Depends(get_session)
):
    return service.update_class(session, class_id, data)


@router.get("/asset-groups", response_model=list[AssetGroupOut])
def list_asset_groups(include_archived: bool = False, session: Session = Depends(get_session)):
    return service.list_groups(session, include_archived=include_archived)


@router.post("/asset-groups", response_model=AssetGroupOut, status_code=status.HTTP_201_CREATED)
def create_asset_group(data: AssetGroupCreate, session: Session = Depends(get_session)):
    return service.create_group(session, data)


@router.put("/asset-groups/{group_id}", response_model=AssetGroupOut)
def update_asset_group(
    group_id: int, data: AssetGroupUpdate, session: Session = Depends(get_session)
):
    return service.update_group(session, group_id, data)


@router.get("/institutions", response_model=list[InstitutionOut])
def list_institutions(session: Session = Depends(get_session)):
    return service.list_institutions(session)


@router.post("/institutions", response_model=InstitutionOut, status_code=status.HTTP_201_CREATED)
def create_institution(data: InstitutionIn, session: Session = Depends(get_session)):
    return service.create_institution(session, data)


@router.put("/institutions/{institution_id}", response_model=InstitutionOut)
def rename_institution(
    institution_id: int, data: InstitutionIn, session: Session = Depends(get_session)
):
    return service.rename_institution(session, institution_id, data)


@router.delete("/institutions/{institution_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_institution(institution_id: int, session: Session = Depends(get_session)):
    service.delete_institution(session, institution_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/assets", response_model=list[AssetOut])
def list_assets(include_archived: bool = False, session: Session = Depends(get_session)):
    return service.list_assets(session, include_archived=include_archived)


@router.post("/assets", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
def create_asset(data: AssetCreate, session: Session = Depends(get_session)):
    return service.create_asset(session, data)


@router.get("/assets/{asset_id}", response_model=AssetOut)
def get_asset(asset_id: int, session: Session = Depends(get_session)):
    return service.get_asset(session, asset_id)


@router.put("/assets/{asset_id}", response_model=AssetOut)
def update_asset(asset_id: int, data: AssetUpdate, session: Session = Depends(get_session)):
    return service.update_asset(session, asset_id, data)


@router.get("/assets/{asset_id}/valuations", response_model=list[ValuationOut])
def list_valuations(asset_id: int, session: Session = Depends(get_session)):
    return service.list_valuations(session, asset_id)


@router.post(
    "/assets/{asset_id}/valuations",
    response_model=ValuationOut,
    status_code=status.HTTP_201_CREATED,
)
def add_valuation(asset_id: int, data: ValuationIn, session: Session = Depends(get_session)):
    return service.add_valuation(session, asset_id, data)


@router.get("/portfolio/summary", response_model=PortfolioSummary)
def get_summary(session: Session = Depends(get_session)):
    return service.get_summary(session)


@router.post("/assets/{asset_id}/balance", response_model=AssetOut)
def record_balance(asset_id: int, data: BalanceIn, session: Session = Depends(get_session)):
    return movements.record_balance(session, asset_id, data)


@router.post("/transfers", response_model=MovementOut, status_code=status.HTTP_201_CREATED)
def create_transfer(data: TransferIn, session: Session = Depends(get_session)):
    return movements.create_transfer(session, data)


@router.post("/redemptions", response_model=MovementOut, status_code=status.HTTP_201_CREATED)
def create_redemption(data: RedemptionIn, session: Session = Depends(get_session)):
    """Resgate: tira valor e custo do ativo; com `credit_cash`, o valor entra no caixa da conta."""
    return movements.create_redemption(session, data)


@router.post("/proventos", response_model=MovementOut, status_code=status.HTTP_201_CREATED)
def create_provento(data: ProventoIn, session: Session = Depends(get_session)):
    return movements.create_provento(session, data)


@router.post("/purchases", response_model=PurchaseOut, status_code=status.HTTP_201_CREATED)
def create_purchase(data: PurchaseIn, session: Session = Depends(get_session)):
    """Compra com o caixa da conta do ativo (aporte + lançamento de compra, numa transação)."""
    return movements.create_purchase(session, data)


@router.get("/movements", response_model=list[MovementOut])
def list_movements(
    month: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    kind: MovementKind | None = None,
    asset_id: int | None = None,
    session: Session = Depends(get_session),
):
    return movements.list_movements(session, month=month, kind=kind, asset_id=asset_id)


@router.get("/withdrawals", response_model=WithdrawalsOut)
def list_withdrawals(
    year: int | None = Query(default=None, ge=1000, le=9999),
    session: Session = Depends(get_session),
):
    """Registro de retiradas: resgates (do ano, se informado) com o saldo da reserva depois."""
    return withdrawals.list_withdrawals(session, year)


@router.delete("/movements/{movement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_movement(movement_id: int, session: Session = Depends(get_session)):
    movements.delete_movement(session, movement_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/movements/{movement_id}", response_model=MovementOut)
def update_movement(
    movement_id: int, data: MovementUpdate, session: Session = Depends(get_session)
):
    """Corrige o valor e/ou a data do movimento e reaplica o efeito nos saldos."""
    return movements.update_movement(session, movement_id, data)


@router.post("/movements/{movement_id}/undo", response_model=MovementOut)
def undo_movement(movement_id: int, session: Session = Depends(get_session)):
    """Desfaz o movimento e o efeito dele nos saldos. Devolve o movimento desfeito."""
    return movements.undo_movement(session, movement_id)


@router.get("/portfolio/month-summary", response_model=MonthSummary)
def month_summary(
    month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    session: Session = Depends(get_session),
):
    return movements.get_month_summary(session, month)


@router.put("/assets/{asset_id}/valuations/{valuation_id}", response_model=ValuationOut)
def update_valuation(
    asset_id: int,
    valuation_id: int,
    data: ValuationUpdate,
    session: Session = Depends(get_session),
):
    return service.update_valuation(session, asset_id, valuation_id, data)


@router.delete(
    "/assets/{asset_id}/valuations/{valuation_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_valuation(asset_id: int, valuation_id: int, session: Session = Depends(get_session)):
    service.delete_valuation(session, asset_id, valuation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
