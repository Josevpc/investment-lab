from bisect import bisect_right
from collections.abc import Callable, Collection
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.features.allocation.service import (
    effective_targets,
    fully_held_ids,
    list_plans,
    split_amounts,
)
from app.features.analytics import domain
from app.features.analytics.cdi_equivalent import Flow, growth, solve_pct_of_cdi
from app.features.analytics.cdi_equivalent import to_bps as to_decimal_bps
from app.features.analytics.performance import (
    Observation,
    ScopeFlow,
    cdi_returns,
    chained_returns,
    first_index_with_balance,
    index_return,
    index_returns,
    to_bps,
)
from app.features.analytics.schemas import (
    AssetFlowOut,
    AssetPerformanceOut,
    AssetStepOut,
    PerformanceOut,
    PerformancePoint,
    PerformanceSummary,
    StaleAsset,
    TrajectoryClass,
    TrajectoryIn,
    TrajectoryOut,
    TrajectoryPoint,
)
from app.features.benchmarks.service import INDEX_SOURCE, index_level_on_or_before, index_levels
from app.features.benchmarks.service import daily_rates as benchmark_daily_rates
from app.features.benchmarks.service import get_status as benchmark_status
from app.features.contributions.service import list_contributions
from app.features.portfolio.movements import list_movements
from app.features.portfolio.service import (
    class_current_values,
    class_hold_status,
    get_asset,
    get_timeline,
    list_asset_classes,
    list_asset_groups,
    list_assets,
    list_valuations,
)
from app.features.portfolio.timeline import Timeline


def get_trajectory(session: Session, data: TrajectoryIn) -> TrajectoryOut:
    """Para onde a carteira vai se os próximos aportes seguirem o plano ativo."""
    plan = next((p for p in list_plans(session) if p.is_active), None)
    if plan is None:
        raise NotFoundError("Nenhum plano de alocação ativo.")

    targets = {t.class_id: t.percent_bps for t in plan.targets}
    hold = class_hold_status(session)
    held = fully_held_ids(hold)
    # As distâncias medem contra a meta que vale na conta, não contra a gravada no plano.
    effective = effective_targets(targets, held)
    current = class_current_values(session)
    group_of = {c.id: c.group_id for c in list_asset_classes(session)}

    if data.monthly_contribution_cents is not None:
        amount, source = data.monthly_contribution_cents, "informed"
    else:
        history = list_contributions(session)
        amount, source = (history[0].final_cents, "last_contribution") if history else (0, "none")

    # Com todas as categorias totalmente mantidas nenhuma pode receber: a simulação segue com
    # aporte 0 (carteira parada) e o `all_held` avisa a tela, em vez de falhar com 422.
    all_held = bool(targets) and all(cid in held for cid in targets)
    if all_held:
        amount = 0

    def split(amount_cents, target_map, value_map):
        return split_amounts(amount_cents, target_map, value_map, data.mode, held)

    states = domain.simulate_contributions(current, targets, amount, data.months, split)
    key_of = {t.class_id: t.class_key for t in plan.targets}

    return TrajectoryOut(
        plan_id=plan.id,
        plan_name=plan.name,
        mode=data.mode,
        months=data.months,
        monthly_contribution_cents=amount,
        all_held=all_held,
        contribution_source=source,
        tolerance_bps=data.tolerance_bps,
        months_to_target=domain.months_to_target(states, effective, data.tolerance_bps, held),
        start_gap_bps=domain.max_gap_bps(states[0], effective, held),
        end_gap_bps=domain.max_gap_bps(states[-1], effective, held),
        classes=[
            TrajectoryClass(
                key=t.class_key,
                name=t.class_name,
                color=t.color,
                group_id=group_of.get(t.class_id),
                target_bps=t.percent_bps,
                effective_target_bps=effective[t.class_id],
                hold_status=hold[t.class_id].status,
            )
            for t in plan.targets
        ],
        points=[
            TrajectoryPoint(
                month=month,
                total_cents=sum(values.values()),
                values_cents={key_of[cid]: value for cid, value in values.items()},
                shares_bps={key_of[cid]: bps for cid, bps in domain.shares_bps(values).items()},
                base_shares_bps={
                    key_of[cid]: bps for cid, bps in domain.base_shares_bps(values, held).items()
                },
            )
            for month, values in enumerate(states)
        ],
    )


# ---- desempenho: carteira x CDI e Ibovespa -------------------------------------------------

METHOD = (
    "O desempenho sai dos saldos que você digitou em cada data, e não dos fechamentos. Entre duas "
    "datas seguidas com saldo, o retorno é o ganho (saldo final menos saldo inicial menos os "
    "fluxos) dividido pelo saldo inicial mais cada fluxo ponderado pelo tempo em que ficou "
    "aplicado (método de Dietz modificado), e os intervalos são encadeados. Fluxos são os aportes "
    "(sem o aporte inicial de um ativo novo), os resgates, os ativos que entram na carteira e as "
    "transferências que cruzam o escopo, como da reserva para os investimentos: cadastrar um ativo "
    "ou transferir entre ativos do mesmo escopo não é retorno. Ativo sem saldo novo mantém o "
    "último valor e é avisado quando passa de 10 dias; o arquivado conta até o último valor "
    "registrado e sai sem afetar o retorno. O CDI é composto dia útil a dia útil entre "
    "a data do primeiro saldo e cada data seguinte. O Ibovespa é comparado ponto a ponto entre as "
    "datas: do fechamento da data-base ao de cada data (último pregão em ou antes da data). Os "
    "pontos do Ibovespa já trazem os proventos das ações do índice reinvestidos, enquanto os "
    "dividendos que você recebe ficam fora do saldo: quando eles são relevantes, a comparação "
    "favorece um pouco o índice."
)
INSUFFICIENT = (
    "Ainda faltam saldos em duas datas diferentes neste intervalo para comparar o desempenho."
)
# Fim de semana mais feriado emendado: o Carnaval deixa 5 dias corridos entre dois dias de CDI.
GAP_TOLERANCE = timedelta(days=5)
STALE_AFTER_DAYS = 10  # saldo mais velho que isso na data final vira aviso
GROUP_SCOPE_PREFIX = "group:"  # escopo de um grupo de categorias: "group:<id>"
FIXED_INCOME_KEY = "renda_fixa"  # chave da categoria inicial; o Ibovespa não se aplica a ela
NO_IBOVESPA = "Ainda não há dados do Ibovespa. Atualize em Configurações → Dados e proteção."
NO_CDI = (
    "Ainda não há CDI diário baixado para este período. Atualize em Configurações → "
    "Dados e proteção."
)


def _br(day: date) -> str:
    return day.strftime("%d/%m/%Y")


def _recent_close(session: Session, day: date) -> tuple[date, int] | None:
    """Fechamento do Ibovespa em ou antes de `day`, se tiver no máximo 5 dias de defasagem.

    Fim de semana e feriado usam o pregão anterior; um fechamento mais velho que isso significa
    buracos nos dados, e usá-lo compararia períodos diferentes.
    """
    found = index_level_on_or_before(session, day)
    if found is None or day - found[0] > GAP_TOLERANCE:
        return None
    return found


def _scope_members(
    timeline: Timeline, scope: str, include_reserve: bool, group_class_keys: Collection[str] = ()
) -> Callable[[int], bool]:
    """Quais ativos formam o escopo. Categoria e grupo nunca incluem a reserva (como nos
    fechamentos). Em `group:<id>`, `group_class_keys` são as categorias do grupo."""
    if scope == "total":
        return lambda asset_id: include_reserve or not timeline.assets[asset_id].is_reserve
    keys = set(group_class_keys) if scope.startswith(GROUP_SCOPE_PREFIX) else {scope}
    return lambda asset_id: (
        timeline.assets[asset_id].class_key in keys and not timeline.assets[asset_id].is_reserve
    )


def _resolve_scope(session: Session, scope: str) -> tuple[str, set[str]]:
    """Rótulo do escopo e, se for um grupo, as chaves das categorias dele (arquivadas inclusive:
    o histórico delas continua sendo do grupo)."""
    classes = {c.key: c for c in list_asset_classes(session, include_archived=True)}
    if scope == "total":
        return "", set()
    if scope.startswith(GROUP_SCOPE_PREFIX):
        raw = scope.removeprefix(GROUP_SCOPE_PREFIX)
        group = next(
            (g for g in list_asset_groups(session, include_archived=True) if str(g.id) == raw),
            None,
        )
        if group is None:
            raise NotFoundError("Grupo desconhecido.")
        return group.name, {c.key for c in classes.values() if c.group_id == group.id}
    if scope not in classes:
        raise NotFoundError("Categoria desconhecida.")
    return classes[scope].name, set()


def _scope_dates(
    timeline: Timeline, member: Callable[[int], bool], start: date | None, end: date | None
) -> list[date]:
    """Datas do período em que algum ativo do escopo teve saldo digitado.

    Uma data em que só a reserva foi atualizada não é ponto da carteira sem a reserva.
    """
    return [
        day
        for day in timeline.dates
        if (start is None or day >= start)
        and (end is None or day <= end)
        and any(
            member(asset_id) and state.last_observed == day
            for asset_id, state in timeline.states[day].items()
        )
    ]


def _stale_assets(timeline: Timeline, member: Callable[[int], bool], end: date) -> list[StaleAsset]:
    """Ativos do escopo com saldo digitado há mais de 10 dias na data final."""
    stale = []
    for asset_id, state in timeline.states[end].items():
        info = timeline.assets[asset_id]
        days = (end - state.last_observed).days
        if member(asset_id) and not info.archived and state.current_cents > 0:
            if days > STALE_AFTER_DAYS:
                stale.append(
                    StaleAsset(
                        asset_id=asset_id,
                        asset_name=info.name,
                        last_observed_date=state.last_observed,
                        days=days,
                    )
                )
    return sorted(stale, key=lambda item: (-item.days, item.asset_name))


def _recent_closes(levels: list[tuple[date, int]], days: list[date]) -> list[int | None]:
    """O fechamento do Ibovespa em ou antes de cada data, com a mesma tolerância de `_recent_close`.

    `levels` são os fechamentos guardados, em ordem de data, lidos de uma vez.
    """
    level_days = [day for day, _ in levels]
    closes: list[int | None] = []
    for day in days:
        i = bisect_right(level_days, day) - 1
        closes.append(levels[i][1] if i >= 0 and day - level_days[i] <= GAP_TOLERANCE else None)
    return closes


def _cdi_warnings(
    shown: list[Decimal | None], days, start: date, through: date | None
) -> list[str]:
    """Avisos do CDI, só quando algum ponto do gráfico ficou sem a comparação."""
    if through is None:
        return [NO_CDI]
    if all(value is not None for value in shown):
        return []
    if days and days[0][0] - start > GAP_TOLERANCE:
        return ["Faltam dias de CDI no começo deste período."]
    return [
        f"O CDI guardado vai até {_br(through)} e não cobre todo o período: os pontos "
        "depois dessa data ficam sem a comparação. Atualize os índices em Configurações."
    ]


def get_performance(
    session: Session,
    scope: str = "total",
    include_reserve: bool = False,
    start: date | None = None,
    end: date | None = None,
) -> PerformanceOut:
    label, group_keys = _resolve_scope(session, scope)
    if scope == "total":
        label = "Carteira total" + (" (com reserva)" if include_reserve else " (sem a reserva)")

    timeline = get_timeline(session)
    member = _scope_members(timeline, scope, include_reserve and scope == "total", group_keys)
    dates = _scope_dates(timeline, member, start, end)
    observations = [Observation(day, timeline.totals(day, member)[0]) for day in dates]
    flows = [
        ScopeFlow(f.date, f.effective, cents)
        for f in timeline.flows
        if (cents := f.in_scope(member)) != 0
    ]
    chained = chained_returns(observations, flows)
    base = first_index_with_balance(observations)
    indexes = range(base, len(observations)) if base is not None else range(0)

    status = benchmark_status(session)
    cdi_through = date.fromisoformat(status.daily_through) if status.daily_through else None
    measurable = len(indexes) >= 2
    cdi_days = benchmark_daily_rates(session, "cdi", dates[base], dates[-1]) if measurable else []
    cdi = cdi_returns(dates, base, cdi_days, GAP_TOLERANCE, cdi_through)

    closes: list[int | None] = [None] * len(dates)
    if base is not None:
        levels = index_levels(session, dates[base] - GAP_TOLERANCE, dates[-1])
        closes[base:] = _recent_closes(levels, dates[base:])
    ibovespa = index_returns(closes, base)

    points = [
        PerformancePoint(
            date=dates[i],
            value_cents=observations[i].value_cents,
            flows_cents=chained.flows_cents[i],
            portfolio_bps=to_bps(chained.returns[i]),
            cdi_bps=to_bps(cdi[i]),
            ibovespa_bps=to_bps(ibovespa[i]),
        )
        for i in indexes
    ]

    warnings: list[str] = []
    stale: list[StaleAsset] = []
    if not measurable:
        warnings.append(INSUFFICIENT)
    else:
        shown = [cdi[i] for i in indexes]
        warnings.extend(_cdi_warnings(shown, cdi_days, points[0].date, cdi_through))
        if chained.gaps:
            warnings.append(
                f"Em {chained.gaps} intervalo(s) não havia saldo no início, e o retorno não pôde "
                "ser medido."
            )
    if points:
        stale = _stale_assets(timeline, member, points[-1].date)
        if status.index_days == 0:
            warnings.append(NO_IBOVESPA)
        elif any(p.ibovespa_bps is None for p in points):
            warnings.append(
                f"O Ibovespa guardado vai até {_br(date.fromisoformat(status.index_through))} "
                "e não cobre todo o período: a comparação com ele fica incompleta."
            )

    last = points[-1] if points else None
    vs_cdi = (
        last.portfolio_bps - last.cdi_bps
        if last and None not in (last.portfolio_bps, last.cdi_bps)
        else None
    )
    vs_ibovespa = (
        last.portfolio_bps - last.ibovespa_bps
        if last and None not in (last.portfolio_bps, last.ibovespa_bps)
        else None
    )

    return PerformanceOut(
        scope=scope,
        scope_label=label,
        include_reserve=include_reserve and scope == "total",
        observations_count=len(points),
        points=points,
        summary=PerformanceSummary(
            start_date=points[0].date if points else None,
            end_date=last.date if last else None,
            portfolio_bps=last.portfolio_bps if last else None,
            cdi_bps=last.cdi_bps if last else None,
            vs_cdi_bps=vs_cdi,
            ibovespa_bps=last.ibovespa_bps if last else None,
            vs_ibovespa_bps=vs_ibovespa,
            flows_cents=sum(p.flows_cents for p in points),
        ),
        method=METHOD,
        warnings=warnings,
        stale_assets=stale,
        benchmark_source=status.source,
        benchmark_updated_at=status.updated_at,
        cdi_covered_through=cdi_through,
        ibovespa_covered_through=status.index_through,
        ibovespa_source=INDEX_SOURCE if status.index_days else None,
    )


# ---- ativo contra o CDI ------------------------------------------------------------------

CDI_METHOD = (
    "Procuramos o % do CDI que, aplicado dia a dia, leva o saldo inicial mais os aportes (cada um "
    "a partir da sua data) ao saldo final. Usa os saldos que você digitou, como estão na conta "
    "(brutos ou já sem o IR, conforme marcado em cada ativo), e o CDI diário do Banco Central. O "
    "app não calcula imposto: o % do CDI de um ativo líquido não é comparável ao de um bruto. "
    "O período conta de depois do dia inicial até o dia final; mudar o "
    "dia de um aporte em um dia útil muda o resultado em um período curto. Para renda variável, "
    "o Ibovespa é comparado ponto a ponto entre as datas inicial e final (último pregão em ou "
    "antes de cada uma): os pontos já trazem os proventos das ações do índice reinvestidos, "
    "enquanto os dividendos que você recebe ficam fora do saldo, então, quando eles são "
    "relevantes, a comparação favorece um pouco o índice."
)


def _asset_flows(asset_id: int, movements) -> list[tuple[Flow, str]]:
    flows: list[tuple[Flow, str]] = []
    for m in movements:
        if m.initial:  # aporte inicial: o dinheiro já está no 1º saldo, não é fluxo do período
            continue
        if m.kind == "aporte" and m.asset_id == asset_id:
            flows.append((Flow(m.date, m.amount_cents), "aporte"))
        elif m.kind == "transferencia":
            if m.asset_id == asset_id:
                flows.append((Flow(m.date, m.amount_cents), "transferencia_entrada"))
            elif m.related_asset_id == asset_id:
                flows.append((Flow(m.date, -m.amount_cents), "transferencia_saida"))
        elif m.kind == "provento" and m.related_asset_id == asset_id:
            flows.append((Flow(m.date, m.amount_cents), "provento_creditado"))
        elif m.kind == "resgate" and m.asset_id == asset_id:
            # Saiu do ativo na data do resgate, esteja ou não já descontado do saldo digitado.
            flows.append((Flow(m.date, -m.amount_cents), "resgate"))
    return sorted(flows, key=lambda item: item[0].date)


def _nearest(dates: list[date], target: date) -> date:
    return min(dates, key=lambda d: (abs((d - target).days), d))


def _measure(session: Session, start, end, flows: list[tuple[Flow, str]]):
    """Mede um intervalo (início, fim] com os fluxos dentro dele."""
    inside = [(f, kind) for f, kind in flows if start.date < f.date <= end.date]
    days = benchmark_daily_rates(session, "cdi", start.date, end.date)
    flows_cents = sum(f.cents for f, _ in inside)
    pct = solve_pct_of_cdi(start.current_cents, [f for f, _ in inside], days, end.current_cents)
    return {
        "inside": inside,
        "days": days,
        "flows_cents": flows_cents,
        "yield_cents": end.current_cents - start.current_cents - flows_cents,
        "pct": pct,
        "return_bps": to_decimal_bps(growth(days, pct) - 1) if pct is not None else None,
        "cdi_bps": to_decimal_bps(growth(days, Decimal(1)) - 1) if days else None,
    }


def _asset_ibovespa(
    session: Session, start: date, end: date, return_bps: int | None, warnings: list[str]
) -> tuple[int | None, int | None, date | None]:
    """Ibovespa ponto a ponto entre as duas datas, e a diferença para o retorno do ativo."""
    through = index_level_on_or_before(session, end)
    covered = through[0] if through else None
    opening, closing = _recent_close(session, start), _recent_close(session, end)
    if opening is None or closing is None:
        if through is None and index_level_on_or_before(session, date.max) is None:
            warnings.append(NO_IBOVESPA)
        elif opening is None:
            warnings.append("Faltam fechamentos do Ibovespa no começo deste período.")
        else:
            warnings.append(
                f"O Ibovespa só vai até {_br(covered)}: o fim do período fica de fora da "
                "comparação."
            )
        return None, None, covered
    ibovespa = to_bps(index_return(opening[1], closing[1]))
    vs = return_bps - ibovespa if return_bps is not None and ibovespa is not None else None
    return ibovespa, vs, covered


def get_asset_performance(
    session: Session, asset_id: int, start: date | None = None, end: date | None = None
) -> AssetPerformanceOut:
    """Quanto % do CDI o ativo rendeu no período. Sem datas, vale do primeiro ao último saldo."""
    asset = get_asset(session, asset_id)
    observed = sorted(
        (v for v in list_valuations(session, asset_id) if v.observed), key=lambda v: v.date
    )
    by_date = {v.date: v for v in observed}
    dates = list(by_date)
    contracted = asset.rate_bps if asset.indexer == "CDI" else None
    warnings: list[str] = []

    def empty(message: str) -> AssetPerformanceOut:
        return AssetPerformanceOut(
            asset_id=asset.id,
            asset_name=asset.name,
            class_key=asset.class_key,
            asset_type=asset.asset_type,
            indexer=asset.indexer,
            contracted_pct_bps=contracted,
            balance_is_net=asset.balance_is_net,
            dates=dates,
            start_date=None,
            end_date=None,
            start_cents=None,
            end_cents=None,
            flows=[],
            flows_cents=0,
            proventos_cents=0,
            yield_cents=None,
            return_bps=None,
            cdi_bps=None,
            pct_of_cdi_bps=None,
            vs_contracted_bps=None,
            steps=[],
            warnings=[message],
            method=CDI_METHOD,
            cdi_covered_through=None,
        )

    if len(dates) < 2:
        return empty("Registre ao menos dois saldos deste ativo para medir o rendimento.")

    start_date = _nearest(dates, start) if start else dates[0]
    end_date = _nearest(dates, end) if end else dates[-1]
    if start_date >= end_date:
        return empty("O saldo inicial precisa ser de uma data anterior ao saldo final.")

    movements = list_movements(session, asset_id=asset_id)
    flows = _asset_flows(asset_id, movements)
    proventos = sum(
        m.amount_cents
        for m in movements
        if m.kind == "provento" and m.asset_id == asset_id and start_date < m.date <= end_date
    )
    first, last = by_date[start_date], by_date[end_date]
    total = _measure(session, first, last, flows)

    through = total["days"][-1][0] if total["days"] else None
    if not total["days"]:
        warnings.append(
            "Ainda não há CDI diário baixado para este período. Atualize em Configurações → "
            "Dados e proteção."
        )
    else:
        if through is not None and through < end_date - GAP_TOLERANCE:
            warnings.append(
                f"O CDI diário só vai até {through.strftime('%d/%m/%Y')}: o rendimento do fim do "
                "período fica de fora da comparação."
            )
        if total["days"][0][0] > start_date + GAP_TOLERANCE:
            warnings.append("Faltam dias de CDI no começo deste período.")
        if total["pct"] is None:
            warnings.append("Não foi possível medir: confira os saldos e aportes digitados.")

    # Renda fixa não se compara com bolsa: nem calcula.
    ibovespa_bps = vs_ibovespa_bps = ibovespa_through = None
    if asset.class_key != FIXED_INCOME_KEY:
        ibovespa_bps, vs_ibovespa_bps, ibovespa_through = _asset_ibovespa(
            session, start_date, end_date, total["return_bps"], warnings
        )

    steps = []
    window = [v for v in observed if start_date <= v.date <= end_date]
    for a, b in zip(window, window[1:], strict=False):
        part = _measure(session, a, b, flows)
        steps.append(
            AssetStepOut(
                start_date=a.date,
                end_date=b.date,
                start_cents=a.current_cents,
                end_cents=b.current_cents,
                flows_cents=part["flows_cents"],
                yield_cents=part["yield_cents"],
                return_bps=part["return_bps"],
                cdi_bps=part["cdi_bps"],
                pct_of_cdi_bps=to_decimal_bps(part["pct"]) if part["pct"] is not None else None,
            )
        )

    pct_bps = to_decimal_bps(total["pct"]) if total["pct"] is not None else None
    return AssetPerformanceOut(
        asset_id=asset.id,
        asset_name=asset.name,
        class_key=asset.class_key,
        asset_type=asset.asset_type,
        indexer=asset.indexer,
        contracted_pct_bps=contracted,
        balance_is_net=asset.balance_is_net,
        dates=dates,
        start_date=start_date,
        end_date=end_date,
        start_cents=first.current_cents,
        end_cents=last.current_cents,
        flows=[AssetFlowOut(date=f.date, kind=kind, cents=f.cents) for f, kind in total["inside"]],
        flows_cents=total["flows_cents"],
        proventos_cents=proventos,
        yield_cents=total["yield_cents"],
        return_bps=total["return_bps"],
        cdi_bps=total["cdi_bps"],
        pct_of_cdi_bps=pct_bps,
        vs_contracted_bps=(pct_bps - contracted) if pct_bps is not None and contracted else None,
        steps=steps,
        warnings=warnings,
        method=CDI_METHOD,
        cdi_covered_through=through,
        ibovespa_bps=ibovespa_bps,
        vs_ibovespa_bps=vs_ibovespa_bps,
        ibovespa_covered_through=ibovespa_through,
    )


def list_assets_vs_cdi(
    session: Session, start: date | None = None, end: date | None = None
) -> list[AssetPerformanceOut]:
    """O mesmo cálculo para cada ativo não arquivado, no mesmo período."""
    return [
        get_asset_performance(session, a.id, start, end)
        for a in list_assets(session)
        if not a.archived
    ]
