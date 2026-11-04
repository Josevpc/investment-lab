"""Dados de exemplo do modo demonstração (`demonstracao.bat`).

Só roda num banco separado (`data/demo/`) e com `INVESTMENT_DEMO=1`; a tela mostra o selo
"Modo demonstração". Tudo aqui é fictício: instituições, ativos, valores, aportes e até o CDI, que
é sintético (taxa fixa por dia útil) para o app funcionar sem internet. O mesmo vale para os
fechamentos do "Ibovespa" usados na comparação.
"""

import datetime as dt
import re
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import REAL_DATABASE_PATH
from app.features.analytics.cdi_equivalent import Flow, simulate
from app.features.benchmarks.models import BenchmarkDaily, BenchmarkIndexLevel, BenchmarkRate
from app.features.contributions.schemas import ContributionUpsert
from app.features.contributions.service import upsert_contribution
from app.features.goals.schemas import GoalSettingsIn
from app.features.goals.service import save_settings as save_goals
from app.features.history.schemas import SnapshotCreate, SnapshotItemIn
from app.features.history.service import create_snapshot
from app.features.portfolio.movements import create_provento, create_redemption, record_balance
from app.features.portfolio.schemas import (
    AssetClassUpdate,
    AssetCreate,
    AssetGroupCreate,
    BalanceIn,
    InstitutionIn,
    ProventoIn,
    RedemptionIn,
)
from app.features.portfolio.service import (
    create_asset,
    create_group,
    create_institution,
    list_asset_classes,
    list_assets,
    update_class,
)
from app.features.reserve.schemas import ReserveIn
from app.features.reserve.service import save_reserve

MONTHS = 6
SALARY_CENTS = 650_000
FII_PROVENTOS = {"FII Tijolo Exemplo": 10_500, "FII Papel Exemplo": 12_000}  # por mês
# Ativos cadastrados no mês corrente como novos: (nome, categoria, instituição, valor, extras).
NEW_ASSETS = [
    (
        "CDB Novo Exemplo",
        "renda_fixa",
        "Banco Exemplo",
        15_000,
        {"indexer": "CDI", "rate_bps": 10_500},
    ),
    (
        "Ação Nova Exemplo",
        "acoes_etfs",
        "Corretora Exemplo",
        20_000,
        {"asset_type": "acao", "ticker": "ACAO3", "quantity": "40"},
    ),
]
# Grupo fictício de categorias: reúne as duas de bolsa. Não se chama "Renda variável" para não
# repetir o nome da categoria inicial dos FIIs na tela.
DEMO_GROUP_NAME = "Bolsa e FIIs"
DEMO_GROUP_CLASS_KEYS = ("renda_variavel", "acoes_etfs")
# Resgate fictício da reserva no mês corrente (valor e motivo de exemplo).
REDEMPTION_CENTS = 50_000
REDEMPTION_NOTE = "Conserto do carro (exemplo)"
DAILY_CDI = Decimal("0.00043")  # ~0,043% ao dia útil
DAILY_SELIC = Decimal("0.000425")
# Ibovespa fictício: sobe e desce em ciclos de oito pregões (variações em pontos-base), com saldo
# levemente positivo, para a comparação da demonstração ter altas e baixas.
IBOVESPA_START_POINTS = 128_000
IBOVESPA_DAILY_MOVES_BPS = [35, -20, 50, -45, 10, 25, -30, 15]


def _month_end(year: int, month: int) -> dt.date:
    nxt = dt.date(year + (month == 12), month % 12 + 1, 1)
    return nxt - dt.timedelta(days=1)


def _shift_month(day: dt.date, delta: int) -> dt.date:
    index = day.year * 12 + day.month - 1 + delta
    return dt.date(index // 12, index % 12 + 1, 1)


def _business_days(start: dt.date, end: dt.date) -> list[dt.date]:
    out, day = [], start + dt.timedelta(days=1)
    while day <= end:
        if day.weekday() < 5:
            out.append(day)
        day += dt.timedelta(days=1)
    return out


def _round(value: Decimal) -> int:
    return int(value.to_integral_value(rounding=ROUND_HALF_UP))


def _seed_benchmarks(
    session: Session, start: dt.date, end: dt.date
) -> list[tuple[dt.date, Decimal]]:
    days = _business_days(start, end)
    now = dt.datetime.now()
    for day in days:
        session.add(BenchmarkDaily(series="cdi", date=day, rate_e9=_round(DAILY_CDI * 10**9)))
    months: dict[str, list[dt.date]] = {}
    for day in days:
        months.setdefault(day.strftime("%Y-%m"), []).append(day)
    for series, daily in (("cdi", DAILY_CDI), ("selic", DAILY_SELIC)):
        for month, month_days in months.items():
            accumulated = (1 + daily) ** len(month_days) - 1
            ppm = _round(accumulated * 1_000_000)
            session.add(BenchmarkRate(series=series, month=month, rate_ppm=ppm, fetched_at=now))
    _seed_ibovespa(session, days, now)
    session.commit()
    return [(day, DAILY_CDI) for day in days]


def _seed_ibovespa(session: Session, days: list[dt.date], now: dt.datetime) -> None:
    """Fechamentos fictícios do "Ibovespa": um passeio determinístico, sem relação com o real."""
    close = Decimal(IBOVESPA_START_POINTS)
    for i, day in enumerate(days):
        close = close * (
            1 + Decimal(IBOVESPA_DAILY_MOVES_BPS[i % len(IBOVESPA_DAILY_MOVES_BPS)]) / 10_000
        )
        session.add(
            BenchmarkIndexLevel(
                series="ibovespa", date=day, close_e2=_round(close * 100), fetched_at=now
            )
        )


def _points_to_real_database(database: str) -> bool:
    # `sqlite:////C:/...` (quatro barras) entrega "/C:/...", que o SQLite aceita no Windows.
    if re.match(r"^/[A-Za-z]:", database):
        database = database[1:]
    # URI do SQLite (`file:...`): não dá para provar que é outro arquivo, então recusa.
    if database.startswith("file:"):
        return True
    path = Path(database)
    if path.resolve() == REAL_DATABASE_PATH.resolve():
        return True
    # Atalho rígido (hardlink) tem outro caminho e o mesmo arquivo.
    return REAL_DATABASE_PATH.exists() and path.exists() and path.samefile(REAL_DATABASE_PATH)


def ensure_not_real_database(database: str | None) -> None:
    """Trava extra do modo demonstração: nunca abrir o banco real do usuário.

    Só a variável `INVESTMENT_DEMO` não basta: com ela e sem `INVESTMENT_DATABASE_URL`, o app
    cairia no banco padrão, que é o real. `database` é o caminho do arquivo (None, em memória).
    """
    if database and _points_to_real_database(database):
        raise RuntimeError(
            "Modo demonstração recusado: o banco apontado é o banco real (data/investment.db). "
            "Defina INVESTMENT_DATABASE_URL para um banco de demonstração (veja demonstracao.bat)."
        )


def seed_demo(session: Session, today: dt.date | None = None) -> bool:
    """Popula um banco vazio com a carteira de exemplo. Devolve False se já havia ativos."""
    ensure_not_real_database(session.get_bind().url.database)
    if list_assets(session, include_archived=True):
        return False
    today = today or dt.date.today()
    first_of_this_month = today.replace(day=1)
    ends = [
        _month_end(*(_shift_month(first_of_this_month, -i).timetuple()[:2]))
        for i in range(MONTHS, 0, -1)
    ]
    start = _month_end(*(_shift_month(first_of_this_month, -(MONTHS + 1)).timetuple()[:2]))
    rates = _seed_benchmarks(session, start - dt.timedelta(days=10), today)

    banks = {
        name: create_institution(session, InstitutionIn(name=name)).id
        for name in ("Banco Exemplo", "Corretora Exemplo", "Fintech Exemplo")
    }

    _seed_group(session)

    # (nome, categoria, instituição, saldo inicial, % do CDI ou crescimento mensal, aporte, extras)
    cdi_assets = [
        (
            "CDB Exemplo 110% do CDI",
            "renda_fixa",
            "Banco Exemplo",
            8_000_000,
            "1.10",
            19_750,  # com os demais, soma o aporte planejado (sequência na demonstração)
            {"indexer": "CDI", "rate_bps": 11_000},
        ),
        (
            "Conta Exemplo 120% do CDI",
            "renda_fixa",
            "Fintech Exemplo",
            2_500_000,
            "1.18",
            8_000,
            # Saldo já sem o IR (como a Caixinha do Mercado Pago): a tabela avisa que não compara.
            {"indexer": "CDI", "rate_bps": 12_000, "balance_is_net": True},
        ),
        (
            "Reserva Exemplo",
            "renda_fixa",
            "Fintech Exemplo",
            1_800_000,
            "1.00",
            6_000,
            {"indexer": "CDI", "rate_bps": 10_000, "purpose": "reserva"},
        ),
    ]
    # Renda variável: variação mensal em %. Em maio o ETF e a cripto caem forte (valores fictícios)
    # para a demonstração mostrar também um mês em que o dinheiro rendeu menos que zero.
    growth_assets = [
        (
            "FII Tijolo Exemplo",
            "renda_variavel",
            "Corretora Exemplo",
            1_500_000,
            [0.9, 1.1, -0.4, 0.8, 1.0, 0.7],
            4_000,
            {"asset_type": "fii", "fii_segment": "tijolo", "ticker": "TIJO11", "quantity": "150"},
        ),
        (
            "FII Papel Exemplo",
            "renda_variavel",
            "Corretora Exemplo",
            1_200_000,
            [1.0, 0.9, 1.1, 0.8, 1.0, 0.9],
            3_000,
            # Em "manter posição": a categoria fica parcial (o outro FII ainda recebe aportes).
            {
                "asset_type": "fii",
                "fii_segment": "papel",
                "ticker": "PAPE11",
                "quantity": "120",
                "hold_only": True,
            },
        ),
        (
            "ETF Exemplo",
            "acoes_etfs",
            "Corretora Exemplo",
            3_000_000,
            [2.1, -4.5, 3.2, 0.4, -0.8, 2.6],
            6_000,
            {"asset_type": "etf", "ticker": "ETFX11", "quantity": "90"},
        ),
        (
            "Cripto Exemplo",
            "cripto",
            "Banco Exemplo",
            900_000,
            [6.0, -20.0, 12.0, -4.0, 7.0, 3.0],
            2_000,
            {},
        ),
    ]

    # Estado mês a mês: {ativo: (investido, saldo)}.
    state: dict[str, tuple[int, int]] = {}
    meta: dict[str, tuple[str, int, dict]] = {}
    created: dict[str, int] = {}

    def make(name, class_key, bank, initial, extra):
        asset = create_asset(
            session,
            AssetCreate(
                name=name,
                class_key=class_key,
                institution_id=banks[bank],
                invested_cents=initial,
                current_cents=initial,
                valuation_date=start,
                **extra,
            ),
        )
        created[name] = asset.id
        state[name] = (initial, initial)
        meta[name] = (class_key, initial, extra)

    for name, class_key, bank, initial, _k, _a, extra in cdi_assets:
        make(name, class_key, bank, initial, extra)
    for name, class_key, bank, initial, _g, _a, extra in growth_assets:
        make(name, class_key, bank, initial, extra)

    previous = start
    for step, end in enumerate(ends):
        aporte_day = min(previous + dt.timedelta(days=10), end)
        days = [(d, r) for d, r in rates if previous < d <= end]
        for name, _class, _bank, _initial, k, aporte, _extra in cdi_assets:
            invested, balance = state[name]
            final = _round(simulate(balance, [Flow(aporte_day, aporte)], days, Decimal(k)))
            record_balance(
                session,
                created[name],
                BalanceIn(
                    date=end,
                    balance_cents=final,
                    contribution_cents=aporte,
                    contribution_date=aporte_day,
                ),
            )
            state[name] = (invested + aporte, final)
        for name, _class, _bank, _initial, monthly, aporte, _extra in growth_assets:
            invested, balance = state[name]
            final = _round(Decimal(balance + aporte) * (1 + Decimal(str(monthly[step])) / 100))
            record_balance(
                session,
                created[name],
                BalanceIn(
                    date=end,
                    balance_cents=final,
                    contribution_cents=aporte,
                    contribution_date=aporte_day,
                ),
            )
            state[name] = (invested + aporte, final)

        # Proventos dos FIIs, recebidos no meio do mês e não creditados em nenhum ativo.
        provento_day = min(previous + dt.timedelta(days=14), end)
        for name, amount in FII_PROVENTOS.items():
            create_provento(
                session, ProventoIn(asset_id=created[name], amount_cents=amount, date=provento_day)
            )

        # Snapshot digitado do mês, com a reserva à parte.
        by_class: dict[str, list[int]] = {}
        reserve = 0
        for name, (invested, balance) in state.items():
            class_key, _initial, extra = meta[name]
            if extra.get("purpose") == "reserva":
                reserve += balance
                continue
            totals = by_class.setdefault(class_key, [0, 0])
            totals[0] += invested
            totals[1] += balance
        create_snapshot(
            session,
            SnapshotCreate(
                date=end,
                items=[
                    SnapshotItemIn(class_key=key, invested_cents=inv, current_cents=cur)
                    for key, (inv, cur) in by_class.items()
                ],
                reserve_cents=reserve,
            ),
        )
        month = end.strftime("%Y-%m")
        upsert_contribution(
            session,
            month,
            ContributionUpsert(
                salary_cents=SALARY_CENTS, percent_bps=750, reserve_cents=0, mode="rebalance"
            ),
        )
        previous = end

    save_reserve(
        session,
        ReserveIn(goal_cents=6 * SALARY_CENTS, months=6, monthly_mode="percent", percent_bps=2_000),
    )
    save_goals(session, GoalSettingsIn(net_worth_goal_cents=30_000_000, year_goal_cents=1_500_000))
    # Mês atual: aporte planejado salvo e uma parte já executada.
    this_month = today.strftime("%Y-%m")
    upsert_contribution(
        session,
        this_month,
        ContributionUpsert(
            salary_cents=SALARY_CENTS, percent_bps=750, reserve_cents=9_750, mode="rebalance"
        ),
    )
    cripto_id, cripto_balance = created["Cripto Exemplo"], state["Cripto Exemplo"][1]
    if today > ends[-1]:
        for name, amount in FII_PROVENTOS.items():
            create_provento(
                session,
                ProventoIn(
                    asset_id=created[name],
                    amount_cents=amount,
                    date=min(today, first_of_this_month + dt.timedelta(days=4)),
                ),
            )
        record_balance(
            session,
            cripto_id,
            BalanceIn(date=today, balance_cents=cripto_balance + 12_000, contribution_cents=12_000),
        )
        # Um resgate da reserva, com motivo: aparece no diário e mostra que ele não vira prejuízo.
        create_redemption(
            session,
            RedemptionIn(
                asset_id=created["Reserva Exemplo"],
                amount_cents=REDEMPTION_CENTS,
                date=min(today, first_of_this_month + dt.timedelta(days=4)),
                note=REDEMPTION_NOTE,
            ),
        )
        # Dois ativos cadastrados este mês como NOVOS: o investido deles vira aporte (inicial) e
        # aparece nas somas do mês, ao lado do aporte lançado na cripto.
        registered_on = min(today, first_of_this_month + dt.timedelta(days=2))
        for name, class_key, bank, cents, extra in NEW_ASSETS:
            create_asset(
                session,
                AssetCreate(
                    name=name,
                    class_key=class_key,
                    institution_id=banks[bank],
                    invested_cents=cents,
                    current_cents=cents,
                    valuation_date=registered_on,
                    is_new_investment=True,
                    **extra,
                ),
            )
        _update_balances_today(
            session, today, rates, {row[0]: Decimal(row[4]) for row in cdi_assets}
        )
    return True


def _seed_group(session: Session) -> None:
    """Um grupo com duas categorias, para a demonstração mostrar o agrupamento nas telas."""
    group = create_group(session, AssetGroupCreate(name=DEMO_GROUP_NAME))
    for asset_class in list_asset_classes(session):
        if asset_class.key in DEMO_GROUP_CLASS_KEYS:
            update_class(
                session,
                asset_class.id,
                AssetClassUpdate(name=asset_class.name, color=asset_class.color, group_id=group.id),
            )


def _update_balances_today(
    session: Session,
    today: dt.date,
    rates: list[tuple[dt.date, Decimal]],
    percent_of_cdi: dict[str, Decimal],
) -> None:
    """Atualização de saldos de hoje (a rotina semanal): sem ela, o desempenho mostraria todos os
    ativos como desatualizados. A cripto já tem saldo de hoje, com o aporte."""
    percent_of_cdi = percent_of_cdi | {"CDB Novo Exemplo": Decimal("1.05")}
    for asset in list_assets(session, include_archived=True):
        if asset.name == "Cripto Exemplo" or asset.valuation_date >= today:
            continue
        k = percent_of_cdi.get(asset.name)
        if k is not None:
            days = [(day, rate) for day, rate in rates if asset.valuation_date < day <= today]
            final = _round(simulate(asset.current_cents, [], days, k))
        else:
            final = _round(Decimal(asset.current_cents) * Decimal("1.003"))
        record_balance(session, asset.id, BalanceIn(date=today, balance_cents=final))
