"""Serviço da carteira. As funções `list_asset_classes`, `list_asset_groups`,
`class_current_values`, `class_hold_status`, `list_positions`, `get_value_history` e `get_timeline`
são a interface pública consumida por outras features."""

import re
import unicodedata
from dataclasses import dataclass
from datetime import date

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, InvalidInputError, NotFoundError
from app.features.cash import service as cash
from app.features.portfolio import initial_contribution as initial
from app.features.portfolio import repository as repo
from app.features.portfolio.domain import (
    hold_status,
    redemption_effective_date,
    return_bps,
    share_bps,
)
from app.features.portfolio.models import (
    Asset,
    AssetClass,
    AssetGroup,
    AssetMovement,
    AssetValuation,
    Institution,
)
from app.features.portfolio.schemas import (
    AssetClassCreate,
    AssetClassUpdate,
    AssetCreate,
    AssetGroupCreate,
    AssetGroupOut,
    AssetGroupUpdate,
    AssetOut,
    AssetUpdate,
    ClassBreakdown,
    FiiSegmentBreakdown,
    GroupBreakdown,
    InstitutionBreakdown,
    InstitutionIn,
    PortfolioSummary,
    PositionOut,
    ProventoPoint,
    RedemptionPoint,
    TypeBreakdown,
    ValuationIn,
    ValuationPoint,
    ValuationUpdate,
    ValueHistory,
)
from app.features.portfolio.timeline import (
    AssetInfo,
    MovementRow,
    Timeline,
    ValuationRow,
    build_timeline,
)

# Visão macro inicial. O usuário pode renomear, adicionar e arquivar categorias.
DEFAULT_CLASSES = [
    ("renda_fixa", "Renda Fixa", "#5aa88a"),
    ("renda_variavel", "Renda Variável", "#5b8fd9"),
    ("acoes_etfs", "Ações/ETF", "#8f78d6"),
    ("cripto", "Criptomoedas", "#e5a05a"),
]

TYPE_LABELS = {"acao": "Ações", "etf": "ETFs", "fii": "Fundos imobiliários"}
SEGMENT_LABELS = {"papel": "Papel", "tijolo": "Tijolo", "sem_segmento": "Sem segmento"}
# Categorias em que o tipo (ação, ETF, FII) não se aplica; o resto pede o tipo.
FIXED_INCOME_AND_CRYPTO = {"renda_fixa", "cripto"}

# Cores sugeridas para categorias novas, em ordem de uso.
PALETTE = ["#4fb3bf", "#d9728a", "#9bbf5a", "#b89c7a", "#7d8ccf", "#e0795b", "#5fa8a0", "#c78fd0"]


def ensure_asset_classes(session: Session) -> None:
    """Cria as categorias iniciais só em banco vazio: depois disso o usuário é o dono delas."""
    if repo.list_classes(session, include_archived=True):
        return
    for key, name, color in DEFAULT_CLASSES:
        session.add(AssetClass(key=key, name=name, color=color))
    session.commit()


# ---- interface pública -------------------------------------------------------------------


def list_asset_classes(session: Session, *, include_archived: bool = False):
    return repo.list_classes(session, include_archived=include_archived)


def list_asset_groups(session: Session, *, include_archived: bool = False):
    """Grupos de categorias (só apresentação). A categoria diz o seu grupo em `group_id`."""
    return repo.list_groups(session, include_archived=include_archived)


# ---- categorias --------------------------------------------------------------------------


def _slugify(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "_", ascii_name.lower()).strip("_")
    return slug[:28] or "categoria"


def _unique_key(session: Session, name: str) -> str:
    base = _slugify(name)
    key, n = base, 2
    while repo.get_class_by_key(session, key):
        key = f"{base}_{n}"
        n += 1
    return key


def create_class(session: Session, data: AssetClassCreate) -> AssetClass:
    if repo.get_class_by_name(session, data.name):
        raise ConflictError("Já existe uma categoria com esse nome.")
    all_classes = repo.list_classes(session, include_archived=True)
    used = {c.color.lower() for c in all_classes}
    free = [color for color in PALETTE if color not in used]
    color = data.color or (free[0] if free else PALETTE[len(all_classes) % len(PALETTE)])
    group_id = _resolve_group(session, data.group_id) if data.group_id is not None else None
    asset_class = AssetClass(
        key=_unique_key(session, data.name), name=data.name, color=color, group_id=group_id
    )
    session.add(asset_class)
    session.commit()
    return asset_class


def update_class(session: Session, class_id: int, data: AssetClassUpdate) -> AssetClass:
    asset_class = repo.get_class(session, class_id)
    if asset_class is None:
        raise NotFoundError("Categoria não encontrada.")
    other = repo.get_class_by_name(session, data.name)
    if other and other.id != asset_class.id:
        raise ConflictError("Já existe uma categoria com esse nome.")

    if data.archived and not asset_class.archived:
        if repo.class_has_active_assets(session, class_id):
            raise ConflictError(
                "A categoria ainda tem ativos. Mova-os para outra categoria ou arquive-os antes."
            )
        if len(repo.list_classes(session)) <= 1:
            raise InvalidInputError("A carteira precisa de ao menos uma categoria.")

    # Omitido, o grupo fica; `null` solta a categoria do grupo.
    if "group_id" in data.model_fields_set:
        asset_class.group_id = (
            _resolve_group(session, data.group_id) if data.group_id is not None else None
        )
    asset_class.name = data.name
    asset_class.color = data.color
    asset_class.archived = data.archived
    session.commit()
    return asset_class


# ---- grupos de categorias ----------------------------------------------------------------


def _group_out(session: Session, group: AssetGroup) -> AssetGroupOut:
    members = [c.id for c in repo.list_classes_in_group(session, group.id) if not c.archived]
    return AssetGroupOut(
        id=group.id,
        name=group.name,
        color=group.color,
        archived=group.archived,
        class_ids=members,
    )


def list_groups(session: Session, *, include_archived: bool = False) -> list[AssetGroupOut]:
    return [
        _group_out(session, g) for g in repo.list_groups(session, include_archived=include_archived)
    ]


def _resolve_group(session: Session, group_id: int) -> int:
    """Grupo que uma categoria pode receber: precisa existir e não estar arquivado."""
    group = repo.get_group(session, group_id)
    if group is None:
        raise InvalidInputError("Grupo não encontrado.")
    if group.archived:
        raise InvalidInputError(f"O grupo {group.name} está arquivado.")
    return group.id


def create_group(session: Session, data: AssetGroupCreate) -> AssetGroupOut:
    if repo.get_group_by_name(session, data.name):
        raise ConflictError("Já existe um grupo com esse nome.")
    if data.color:
        color = data.color
    else:
        used = {c.color.lower() for c in repo.list_classes(session, include_archived=True)}
        used |= {g.color.lower() for g in repo.list_groups(session, include_archived=True)}
        free = [c for c in PALETTE if c not in used]
        color = free[0] if free else PALETTE[len(used) % len(PALETTE)]
    group = AssetGroup(name=data.name, color=color)
    session.add(group)
    session.commit()
    return _group_out(session, group)


def update_group(session: Session, group_id: int, data: AssetGroupUpdate) -> AssetGroupOut:
    group = repo.get_group(session, group_id)
    if group is None:
        raise NotFoundError("Grupo não encontrado.")
    if data.name is not None:
        other = repo.get_group_by_name(session, data.name)
        if other and other.id != group.id:
            raise ConflictError("Já existe um grupo com esse nome.")
        group.name = data.name
    if data.color is not None:
        group.color = data.color
    if data.archived is not None:
        if data.archived and not group.archived:
            # Arquivar solta as categorias: elas seguem na carteira, só sem grupo.
            for asset_class in repo.list_classes_in_group(session, group.id):
                asset_class.group_id = None
        group.archived = data.archived
    session.commit()
    return _group_out(session, group)


def list_positions(session: Session) -> list[PositionOut]:
    return [
        PositionOut(
            asset_id=asset.id,
            class_id=asset.class_id,
            class_key=asset.asset_class.key,
            is_reserve=asset.purpose == "reserva",
            invested_cents=valuation.invested_cents,
            current_cents=valuation.current_cents,
        )
        for asset, valuation in repo.list_assets_with_latest(session, include_archived=False)
    ]


def get_value_history(session: Session) -> ValueHistory:
    """Valores, proventos e resgates de todos os ativos, arquivados inclusive (alimenta o
    rendimento)."""
    valuations = repo.list_valuation_history(session)
    observed: dict[int, list[date]] = {}
    for v in valuations:
        if v.observed:
            observed.setdefault(v.asset_id, []).append(v.date)
    redemptions = []
    for m in repo.list_movements(session, kind="resgate"):
        effective = redemption_effective_date(m.date, m.in_balance, observed.get(m.asset_id, []))
        if effective is not None:
            redemptions.append(
                RedemptionPoint(
                    asset_id=m.asset_id,
                    date=effective,
                    amount_cents=m.amount_cents,
                    cost_cents=m.cost_cents or 0,
                )
            )
    return ValueHistory(
        valuations=[
            ValuationPoint(
                asset_id=v.asset_id,
                date=v.date,
                invested_cents=v.invested_cents,
                current_cents=v.current_cents,
                observed=v.observed,
            )
            for v in valuations
        ],
        proventos=[
            ProventoPoint(date=day, amount_cents=amount, credited=credited)
            for day, amount, credited in repo.list_proventos(session)
        ],
        redemptions=redemptions,
    )


def get_timeline(session: Session) -> Timeline:
    """Saldos digitados e fluxos datados de todos os ativos, arquivados inclusive (alimenta o
    desempenho, a evolução e a meta do ano)."""
    return build_timeline(
        [
            AssetInfo(a.id, a.name, a.asset_class.key, a.purpose == "reserva", a.archived)
            for a in repo.list_assets(session)
        ],
        [
            ValuationRow(v.asset_id, v.date, v.invested_cents, v.current_cents, v.observed)
            for v in repo.list_valuation_history(session)
        ],
        [
            MovementRow(
                m.kind,
                m.date,
                m.asset_id,
                m.related_asset_id,
                m.amount_cents,
                m.initial,
                m.from_purchase,
                m.in_balance,
            )
            for m in repo.list_movements(session)
        ],
    )


@dataclass(frozen=True)
class ReceivingAsset:
    asset_id: int
    name: str


@dataclass(frozen=True)
class HeldAsset:
    asset_id: int
    name: str
    current_cents: int


@dataclass(frozen=True)
class ClassHold:
    """Como a categoria está quanto a "manter posição".

    "none": nenhum ativo mantido (ou categoria sem ativos). "partial": alguns. "all": ao menos um
    ativo e todos mantidos. Só ativos não arquivados e que não são da reserva contam, as mesmas
    posições que formam o valor da categoria.
    """

    status: str
    receiving_assets: list[ReceivingAsset]
    held_assets: list[HeldAsset]


def class_hold_status(session: Session) -> dict[int, ClassHold]:
    """Situação de "manter posição" de cada categoria ativa, por id (interface pública)."""
    receiving: dict[int, list[ReceivingAsset]] = {c.id: [] for c in repo.list_classes(session)}
    held: dict[int, list[HeldAsset]] = {class_id: [] for class_id in receiving}
    for asset, valuation in repo.list_assets_with_latest(session, include_archived=False):
        if asset.purpose == "reserva" or asset.class_id not in receiving:
            continue
        if asset.hold_only:
            held[asset.class_id].append(HeldAsset(asset.id, asset.name, valuation.current_cents))
        else:
            receiving[asset.class_id].append(ReceivingAsset(asset.id, asset.name))
    return {
        class_id: ClassHold(
            status=hold_status(len(receiving[class_id]) + len(held[class_id]), len(held[class_id])),
            receiving_assets=receiving[class_id],
            held_assets=held[class_id],
        )
        for class_id in receiving
    }


def class_current_values(session: Session) -> dict[int, int]:
    """Valor por categoria, só dos investimentos: a reserva de emergência fica de fora."""
    values = {c.id: 0 for c in repo.list_classes(session)}
    for position in list_positions(session):
        if not position.is_reserve and position.class_id in values:
            values[position.class_id] += position.current_cents
    return values


# ---- instituições ------------------------------------------------------------------------


def list_institutions(session: Session) -> list[Institution]:
    return repo.list_institutions(session)


def create_institution(session: Session, data: InstitutionIn) -> Institution:
    if repo.get_institution_by_name(session, data.name):
        raise ConflictError("Já existe uma instituição com esse nome.")
    institution = Institution(name=data.name)
    session.add(institution)
    session.flush()
    # Toda instituição nasce com uma conta de mesmo nome, onde os ativos dela ficam por padrão.
    cash.create_institution_account(session, institution.id, institution.name)
    session.commit()
    return institution


def rename_institution(session: Session, institution_id: int, data: InstitutionIn) -> Institution:
    institution = _get_institution(session, institution_id)
    other = repo.get_institution_by_name(session, data.name)
    if other and other.id != institution.id:
        raise ConflictError("Já existe uma instituição com esse nome.")
    cash.rename_institution_accounts(session, institution.id, institution.name, data.name)
    institution.name = data.name
    session.commit()
    return institution


def delete_institution(session: Session, institution_id: int) -> None:
    institution = _get_institution(session, institution_id)
    if repo.institution_has_assets(session, institution_id):
        raise ConflictError("A instituição tem ativos cadastrados e não pode ser excluída.")
    cash.drop_institution_accounts(session, institution_id)
    session.delete(institution)
    session.commit()


def _get_institution(session: Session, institution_id: int) -> Institution:
    institution = repo.get_institution(session, institution_id)
    if institution is None:
        raise NotFoundError("Instituição não encontrada.")
    return institution


# ---- ativos ------------------------------------------------------------------------------


def _asset_out(
    asset: Asset,
    valuation: AssetValuation,
    proventos_cents: int = 0,
    initial_movement: AssetMovement | None = None,
) -> AssetOut:
    return AssetOut(
        id=asset.id,
        name=asset.name,
        ticker=asset.ticker,
        class_key=asset.asset_class.key,
        class_name=asset.asset_class.name,
        institution_id=asset.institution_id,
        institution_name=asset.institution.name,
        indexer=asset.indexer,
        rate_bps=asset.rate_bps,
        maturity_date=asset.maturity_date,
        quantity=asset.quantity,
        archived=asset.archived,
        purpose=asset.purpose,
        asset_type=asset.asset_type,
        fii_segment=asset.fii_segment,
        account_id=asset.account_id,
        # A reserva fica fora das categorias e das metas: nunca aparece como mantida, mesmo que o
        # banco guarde uma marca antiga (a migração marcou todos os ativos da categoria mantida).
        hold_only=asset.hold_only and asset.purpose != "reserva",
        balance_is_net=asset.balance_is_net,
        is_new_investment=initial_movement is not None,
        initial_contribution_cents=initial_movement.amount_cents if initial_movement else None,
        initial_contribution_date=initial_movement.date if initial_movement else None,
        invested_cents=valuation.invested_cents,
        current_cents=valuation.current_cents,
        gain_cents=valuation.current_cents - valuation.invested_cents,
        return_bps=return_bps(valuation.invested_cents, valuation.current_cents),
        proventos_cents=proventos_cents,
        total_return_bps=return_bps(
            valuation.invested_cents, valuation.current_cents + proventos_cents
        ),
        valuation_date=valuation.date,
    )


def _resolve_class(session: Session, key: str, *, allow_archived: bool = False) -> AssetClass:
    asset_class = repo.get_class_by_key(session, key)
    if asset_class is None:
        raise InvalidInputError(f"Categoria desconhecida: {key}.")
    if asset_class.archived and not allow_archived:
        raise InvalidInputError(f"A categoria {asset_class.name} está arquivada.")
    return asset_class


def require_institution(session: Session, institution_id: int) -> Institution:
    institution = repo.get_institution(session, institution_id)
    if institution is None:
        raise InvalidInputError("Instituição não encontrada.")
    return institution


def account_has_active_assets(session: Session, account_id: int) -> bool:
    return repo.account_has_active_assets(session, account_id)


def _resolve_account(session: Session, institution: Institution, account_id: int | None) -> int:
    """Conta do ativo: a pedida (da mesma instituição e ativa) ou a conta padrão da instituição."""
    if account_id is None:
        return cash.default_account_id(session, institution.id, institution.name)
    try:
        account = cash.get_account(session, account_id)
    except NotFoundError as exc:
        raise InvalidInputError("Conta não encontrada.") from exc
    if account.institution_id != institution.id:
        raise InvalidInputError(f"A conta {account.name} é de outra instituição.")
    if account.archived:
        raise InvalidInputError(f"A conta {account.name} está arquivada.")
    return account.id


def list_assets(session: Session, *, include_archived: bool = False) -> list[AssetOut]:
    rows = repo.list_assets_with_latest(session, include_archived=include_archived)
    proventos = repo.proventos_by_asset(session)
    initials = repo.initial_movements_by_asset(session)
    return [
        _asset_out(asset, valuation, proventos.get(asset.id, 0), initials.get(asset.id))
        for asset, valuation in rows
    ]


def get_asset(session: Session, asset_id: int) -> AssetOut:
    row = repo.get_asset_with_latest(session, asset_id)
    if row is None:
        raise NotFoundError("Ativo não encontrado.")
    return _asset_out(
        *row,
        repo.proventos_by_asset(session).get(asset_id, 0),
        repo.get_initial_movement(session, asset_id),
    )


def _check_hold(data: AssetCreate | AssetUpdate) -> None:
    """A marca "manter posição" só existe para ativo ativo e de investimento."""
    if not data.hold_only:
        return
    if isinstance(data, AssetUpdate) and data.archived:
        # Arquivar apaga a marca: quem arquiva envia a marca desligada.
        raise InvalidInputError("Ativo arquivado não pode ser mantido.")
    if data.purpose == "reserva":
        raise InvalidInputError(
            "Ativo da reserva de emergência não pode ser mantido: ele já fica fora das metas."
        )


def create_asset(session: Session, data: AssetCreate) -> AssetOut:
    _check_hold(data)
    asset_class = _resolve_class(session, data.class_key)
    institution = require_institution(session, data.institution_id)
    asset = Asset(
        name=data.name.strip(),
        ticker=data.ticker,
        class_id=asset_class.id,
        institution_id=data.institution_id,
        indexer=data.indexer,
        rate_bps=data.rate_bps,
        maturity_date=data.maturity_date,
        quantity=data.quantity,
        archived=False,
        purpose=data.purpose,
        asset_type=data.asset_type,
        fii_segment=data.fii_segment,
        account_id=_resolve_account(session, institution, data.account_id),
        hold_only=data.hold_only,
        balance_is_net=data.balance_is_net,
    )
    try:
        session.add(asset)
        session.flush()
        session.add(
            AssetValuation(
                asset_id=asset.id,
                date=data.valuation_date or date.today(),
                invested_cents=(
                    data.current_cents if data.invested_cents is None else data.invested_cents
                ),
                current_cents=data.current_cents,
            )
        )
        if data.is_new_investment:
            initial.mark_as_new(session, asset)  # recusa (nada é salvo) se não há valor próprio
        session.commit()
    except Exception:
        session.rollback()
        raise
    return get_asset(session, asset.id)


def update_asset(session: Session, asset_id: int, data: AssetUpdate) -> AssetOut:
    asset = repo.get_asset(session, asset_id)
    if asset is None:
        raise NotFoundError("Ativo não encontrado.")
    _check_hold(data)
    asset_class = _resolve_class(
        session, data.class_key, allow_archived=data.class_key == asset.asset_class.key
    )
    institution = require_institution(session, data.institution_id)
    account_id = _account_for_update(session, asset, institution, data.account_id)
    asset.account_id = account_id
    asset.name = data.name.strip()
    asset.ticker = data.ticker
    asset.class_id = asset_class.id
    asset.institution_id = data.institution_id
    asset.indexer = data.indexer
    asset.rate_bps = data.rate_bps
    asset.maturity_date = data.maturity_date
    asset.quantity = data.quantity
    asset.archived = data.archived
    # Omitida, a marca atual fica, salvo se o ativo passa a arquivado ou a reserva: aí ela cai
    # (um `true` explícito nesses casos já foi recusado acima).
    if data.hold_only is None:
        asset.hold_only = asset.hold_only and not data.archived and data.purpose != "reserva"
    else:
        asset.hold_only = data.hold_only
    if data.balance_is_net is not None:
        asset.balance_is_net = data.balance_is_net
    asset.purpose = data.purpose
    asset.asset_type = data.asset_type
    asset.fii_segment = data.fii_segment
    try:
        if data.is_new_investment is True:
            initial.mark_as_new(session, asset)
        elif data.is_new_investment is False:
            initial.mark_as_old(session, asset)
        session.commit()
    except Exception:
        session.rollback()  # recusa na marca desfaz também o resto da edição
        raise
    session.refresh(asset)
    return get_asset(session, asset_id)


def _account_for_update(
    session: Session, asset: Asset, institution: Institution, requested: int | None
) -> int:
    """Conta do ativo editado. Sem pedido, fica onde está, a menos que a instituição mude.

    Um ativo que já movimentou o caixa de uma conta não troca de conta: os lançamentos antigos
    ficariam na conta errada.
    """
    if requested is None and asset.account_id is not None:
        if asset.institution_id == institution.id:
            return asset.account_id
    account_id = _resolve_account(session, institution, requested)
    if (
        asset.account_id is not None
        and account_id != asset.account_id
        and cash.asset_has_entries(session, asset.id)
    ):
        raise ConflictError(
            "Esse ativo já tem lançamentos no caixa da conta atual e não pode trocar de conta."
        )
    return account_id


def _commit_resyncing_initial(session: Session, asset: Asset) -> None:
    """Grava a mudança nas valorizações; o aporte inicial acompanha a 1ª delas (valor e data).

    Se a mudança deixaria o ativo sem valor próprio, tudo é desfeito e a edição é recusada.
    """
    try:
        initial.resync(session, asset)
        session.commit()
    except Exception:
        session.rollback()
        raise


def add_valuation(session: Session, asset_id: int, data: ValuationIn) -> AssetValuation:
    asset = repo.get_asset(session, asset_id)
    if asset is None:
        raise NotFoundError("Ativo não encontrado.")
    on_date = data.date or date.today()
    valuation = repo.get_valuation(session, asset_id, on_date)
    if valuation is None:
        valuation = AssetValuation(asset_id=asset_id, date=on_date)
        session.add(valuation)
    valuation.invested_cents = data.invested_cents
    valuation.current_cents = data.current_cents
    valuation.observed = True
    try:
        _commit_resyncing_initial(session, asset)
    except IntegrityError as exc:  # pragma: no cover - corrida improvável em uso local
        session.rollback()
        raise ConflictError("Não foi possível salvar a valorização.") from exc
    return valuation


def list_valuations(session: Session, asset_id: int) -> list[AssetValuation]:
    if repo.get_asset(session, asset_id) is None:
        raise NotFoundError("Ativo não encontrado.")
    return repo.list_valuations(session, asset_id)


def _get_valuation(session: Session, asset_id: int, valuation_id: int) -> AssetValuation:
    if repo.get_asset(session, asset_id) is None:
        raise NotFoundError("Ativo não encontrado.")
    valuation = repo.get_valuation_by_id(session, asset_id, valuation_id)
    if valuation is None:
        raise NotFoundError("Valor não encontrado para esse ativo.")
    return valuation


def update_valuation(
    session: Session, asset_id: int, valuation_id: int, data: ValuationUpdate
) -> AssetValuation:
    """Corrige um registro do histórico (data, investido e atual).

    A posição atual do ativo é sempre o registro de data mais recente, então corrigir o
    último registro corrige o valor que aparece na carteira.
    """
    valuation = _get_valuation(session, asset_id, valuation_id)
    clash = repo.get_valuation(session, asset_id, data.date)
    if clash is not None and clash.id != valuation.id:
        raise ConflictError("Já existe um valor registrado para esse ativo nessa data.")
    valuation.date = data.date
    valuation.invested_cents = data.invested_cents
    valuation.current_cents = data.current_cents
    valuation.observed = True  # quem corrige o valor está digitando o saldo
    _commit_resyncing_initial(session, repo.get_asset(session, asset_id))
    return valuation


def delete_valuation(session: Session, asset_id: int, valuation_id: int) -> None:
    valuation = _get_valuation(session, asset_id, valuation_id)
    if repo.count_valuations(session, asset_id) <= 1:
        raise ConflictError(
            "O ativo precisa de ao menos um valor registrado. Corrija o valor em vez de excluir."
        )
    session.delete(valuation)
    _commit_resyncing_initial(session, repo.get_asset(session, asset_id))


# ---- resumo ------------------------------------------------------------------------------


def get_summary(session: Session) -> PortfolioSummary:
    rows = repo.list_assets_with_latest(session, include_archived=False)
    classes = repo.list_classes(session)

    by_class: dict[int, list[int]] = {c.id: [0, 0] for c in classes}  # [atual, investido]
    groups = repo.list_groups(session)
    by_institution: dict[int, list] = {}
    total_current = total_invested = 0
    reserve_current = reserve_invested = 0
    proventos = repo.proventos_by_asset(session)
    by_type: dict[str, list[int]] = {}  # tipo -> [ativos, atual, investido]
    by_segment: dict[str, list[int]] = {}  # segmento -> [ativos, atual, investido, proventos]
    untyped_count = untyped_current = 0

    for asset, valuation in rows:
        total_current += valuation.current_cents
        total_invested += valuation.invested_cents
        entry = by_institution.setdefault(asset.institution_id, [asset.institution.name, 0, 0])
        entry[1] += valuation.current_cents
        entry[2] += valuation.invested_cents
        if asset.purpose == "reserva":
            reserve_current += valuation.current_cents
            reserve_invested += valuation.invested_cents
        else:
            if asset.class_id in by_class:
                by_class[asset.class_id][0] += valuation.current_cents
                by_class[asset.class_id][1] += valuation.invested_cents
            if asset.asset_type is not None:
                row = by_type.setdefault(asset.asset_type, [0, 0, 0])
                row[0] += 1
                row[1] += valuation.current_cents
                row[2] += valuation.invested_cents
            elif asset.asset_class.key not in FIXED_INCOME_AND_CRYPTO:
                untyped_count += 1
                untyped_current += valuation.current_cents
            if asset.asset_type == "fii":
                seg = by_segment.setdefault(asset.fii_segment or "sem_segmento", [0, 0, 0, 0])
                seg[0] += 1
                seg[1] += valuation.current_cents
                seg[2] += valuation.invested_cents
                seg[3] += proventos.get(asset.id, 0)

    investments_current = total_current - reserve_current
    cash_cents = cash.consolidated_cash_cents(session)
    typed_total = sum(row[1] for row in by_type.values())
    fii_total = sum(row[1] for row in by_segment.values())

    return PortfolioSummary(
        total_current_cents=total_current,
        total_invested_cents=total_invested,
        return_bps=return_bps(total_invested, total_current),
        assets_count=len(rows),
        investments_current_cents=investments_current,
        reserve_current_cents=reserve_current,
        reserve_invested_cents=reserve_invested,
        proventos_cents=sum(proventos.values()),
        cash_cents=cash_cents,
        total_with_cash_cents=total_current + cash_cents,
        by_type=[
            TypeBreakdown(
                asset_type=key,
                label=TYPE_LABELS[key],
                assets_count=by_type[key][0],
                current_cents=by_type[key][1],
                invested_cents=by_type[key][2],
                share_bps=share_bps(by_type[key][1], typed_total),
            )
            for key in TYPE_LABELS
            if key in by_type
        ],
        fii_segments=[
            FiiSegmentBreakdown(
                segment=key,
                label=SEGMENT_LABELS[key],
                assets_count=by_segment[key][0],
                current_cents=by_segment[key][1],
                invested_cents=by_segment[key][2],
                proventos_cents=by_segment[key][3],
                share_bps=share_bps(by_segment[key][1], fii_total),
            )
            for key in SEGMENT_LABELS
            if key in by_segment
        ],
        untyped_count=untyped_count,
        untyped_current_cents=untyped_current,
        by_class=[
            ClassBreakdown(
                class_id=c.id,
                class_key=c.key,
                class_name=c.name,
                color=c.color,
                current_cents=by_class[c.id][0],
                invested_cents=by_class[c.id][1],
                share_bps=share_bps(by_class[c.id][0], investments_current),
            )
            for c in classes
        ],
        by_group=_group_breakdown(groups, classes, by_class, investments_current),
        by_institution=sorted(
            (
                InstitutionBreakdown(
                    institution_id=inst_id,
                    institution_name=name,
                    current_cents=current,
                    invested_cents=invested,
                    share_bps=share_bps(current, total_current),
                )
                for inst_id, (name, current, invested) in by_institution.items()
            ),
            key=lambda item: -item.current_cents,
        ),
    )


def _group_breakdown(
    groups: list[AssetGroup],
    classes: list[AssetClass],
    by_class: dict[int, list[int]],
    investments_current: int,
) -> list[GroupBreakdown]:
    """Soma das categorias ativas de cada grupo. Grupo sem categoria ativa não aparece."""
    result = []
    for group in groups:
        members = [c.id for c in classes if c.group_id == group.id]
        if not members:
            continue
        current = sum(by_class[cid][0] for cid in members)
        result.append(
            GroupBreakdown(
                group_id=group.id,
                name=group.name,
                color=group.color,
                current_cents=current,
                invested_cents=sum(by_class[cid][1] for cid in members),
                share_bps=share_bps(current, investments_current),
            )
        )
    return result
