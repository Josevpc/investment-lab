"""Regras puras de alocação: nenhuma função aqui acessa o banco.

"Manter posição" é marca do ativo. Para as contas daqui só importa a categoria cujos ativos estão
TODOS mantidos (`fully_held`): ela sai do valor da base e do peso das metas. Numa categoria só
parcialmente mantida o ativo mantido conta no valor dela, e a meta continua sendo da categoria.
"""

from collections.abc import Collection, Hashable, Mapping, Sequence
from dataclasses import dataclass

from app.core.errors import InvalidInputError
from app.core.money import BPS, percent_of, split_by_weights


def validate_targets[K: Hashable](targets: Mapping[K, int]) -> None:
    """RN-01: cada meta entre 0% e 100% e soma exatamente 100,00% em todas as categorias ativas.

    Vale também para a categoria com todos os ativos mantidos: a meta dela fica gravada (suspensa)
    e só é redistribuída na hora de calcular (`effective_targets`).
    """
    if any(value < 0 or value > BPS for value in targets.values()):
        raise InvalidInputError("Cada meta deve estar entre 0% e 100%.")
    total = sum(targets.values())
    if total != BPS:
        shown = f"{total / 100:.2f}".replace(".", ",")
        raise InvalidInputError(f"As metas devem somar 100%, mas somam {shown}%.")


def effective_targets[K: Hashable](
    targets_bps: Mapping[K, int], fully_held: Collection[K] = ()
) -> dict[K, int]:
    """Metas que valem na conta: as das categorias totalmente mantidas saem e as outras são
    reescaladas para somar 10.000 bps, na proporção das metas gravadas.

    Sem perder bps: cada meta ganha a parte inteira da sua fatia e os bps que sobram vão, um a um,
    para os maiores restos (empate: a meta maior, depois a ordem do plano), então o resultado é
    sempre o mesmo. A categoria totalmente mantida fica com 0. Se as que sobram têm todas meta 0,
    dividem por igual. Sem nenhuma categoria para receber, tudo 0.
    """
    receiving = [key for key in targets_bps if key not in fully_held]
    result = dict.fromkeys(targets_bps, 0)
    if not receiving:
        return result
    weights = {key: targets_bps[key] for key in receiving}
    if sum(weights.values()) == 0:
        weights = dict.fromkeys(receiving, 1)
    total = sum(weights.values())

    result.update({key: BPS * weight // total for key, weight in weights.items()})
    leftover = BPS - sum(result[key] for key in receiving)
    order = sorted(
        range(len(receiving)),
        key=lambda i: (-(BPS * weights[receiving[i]] % total), -weights[receiving[i]], i),
    )
    for i in order[:leftover]:
        result[receiving[i]] += 1
    return result


def split_proportional[K: Hashable](
    amount_cents: int, targets_bps: Mapping[K, int]
) -> dict[K, int]:
    """A_i = A x w_i."""
    return split_by_weights(amount_cents, targets_bps)


def split_rebalance[K: Hashable](
    amount_cents: int, targets_bps: Mapping[K, int], current_cents: Mapping[K, int]
) -> dict[K, int]:
    """Direciona o aporte para as classes abaixo da meta (seção 5 do PRD).

    A deficiência de cada classe é D_i = max(0, w_i (V + A) - V_i). Se as deficiências somam
    pelo menos o aporte, ele é dividido na proporção delas; senão, cada classe recebe a sua
    deficiência e a sobra é dividida pelas metas.
    """
    if amount_cents == 0:
        return {key: 0 for key in targets_bps}

    total_current = sum(current_cents.values())
    grand_total = total_current + amount_cents
    # Deficiências em "centavos x 10.000" para manter a aritmética inteira.
    scaled = {
        key: max(0, grand_total * weight - current_cents.get(key, 0) * BPS)
        for key, weight in targets_bps.items()
    }
    if sum(scaled.values()) >= amount_cents * BPS:
        return split_by_weights(amount_cents, scaled)

    base = {key: value // BPS for key, value in scaled.items()}
    leftover = amount_cents - sum(base.values())
    extra = split_by_weights(leftover, targets_bps)
    return {key: base[key] + extra[key] for key in targets_bps}


def _share_bps(value: int, total: int) -> int:
    """Participação em pontos-base, meio para cima; 0 quando não há total."""
    return 0 if total <= 0 else (2 * value * BPS + total) // (2 * total)


def base_cents[K: Hashable](current_cents: Mapping[K, int], fully_held: Collection[K] = ()) -> int:
    """Total da carteira sem as categorias totalmente mantidas: a base das metas."""
    return sum(value for key, value in current_cents.items() if key not in fully_held)


@dataclass(frozen=True)
class ClassComparison:
    current_cents: int
    current_bps: int  # participação na carteira inteira, sempre
    target_bps: int  # a meta gravada no plano
    effective_target_bps: int  # a que vale na conta (reescalada se há categoria toda mantida)
    diff_cents: int | None = None  # positivo = acima da meta; None na categoria toda mantida


def compare_with_targets[K: Hashable](
    current_cents: Mapping[K, int],
    targets_bps: Mapping[K, int],
    fully_held: Collection[K] = (),
) -> dict[K, ClassComparison]:
    """Carteira real vs. meta, por classe (RF-13). Diferença positiva = acima da meta.

    O ativo mantido de uma categoria parcial conta no valor dela. A categoria com todos os ativos
    mantidos não tem meta que valha: só informa quanto vale e quanto pesa na carteira inteira. A
    diferença em centavos mede contra a meta efetiva sobre a base sem essas categorias.
    """
    total = sum(current_cents.values())
    base = base_cents(current_cents, fully_held)
    effective = effective_targets(targets_bps, fully_held)
    result: dict[K, ClassComparison] = {}
    for key, target in targets_bps.items():
        current = current_cents.get(key, 0)
        result[key] = ClassComparison(
            current_cents=current,
            current_bps=_share_bps(current, total),
            target_bps=target,
            effective_target_bps=effective[key],
            diff_cents=None if key in fully_held else current - percent_of(base, effective[key]),
        )
    return result


@dataclass(frozen=True)
class GroupComparison:
    current_cents: int
    current_bps: int  # recalculado do valor somado, na carteira inteira
    target_bps: int  # soma das metas gravadas das categorias do grupo
    effective_target_bps: int  # soma das metas efetivas
    diff_cents: int | None  # soma das diferenças que existem; None se todas as filhas são "all"
    hold_status: str  # "none" | "partial" | "all", derivado das filhas


def group_hold_status(statuses: Collection[str]) -> str:
    """Situação de "manter posição" do grupo: "all" só se todas as filhas são "all", "none" só se
    nenhuma tem ativo mantido; qualquer mistura é "partial"."""
    if all(status == "all" for status in statuses):
        return "all"
    if all(status == "none" for status in statuses):
        return "none"
    return "partial"


def compare_groups[K: Hashable, G: Hashable](
    members: Mapping[G, Sequence[K]],
    comparison: Mapping[K, ClassComparison],
    hold_statuses: Mapping[K, str],
) -> dict[G, GroupComparison]:
    """Soma, por grupo, a comparação das categorias dele. Só apresentação: nada daqui volta para a
    divisão do aporte nem para as metas.

    A participação do grupo (`current_bps`) é recalculada do valor somado, e não somada dos bps das
    filhas, que já vêm arredondados (três categorias de 33,33% dariam 99,99%). Grupo sem
    categorias fica de fora.
    """
    total = sum(row.current_cents for row in comparison.values())
    result: dict[G, GroupComparison] = {}
    for group, keys in members.items():
        if not keys:
            continue
        rows = [comparison[key] for key in keys]
        current = sum(row.current_cents for row in rows)
        diffs = [row.diff_cents for row in rows if row.diff_cents is not None]
        result[group] = GroupComparison(
            current_cents=current,
            current_bps=_share_bps(current, total),
            target_bps=sum(row.target_bps for row in rows),
            effective_target_bps=sum(row.effective_target_bps for row in rows),
            diff_cents=sum(diffs) if diffs else None,
            hold_status=group_hold_status([hold_statuses[key] for key in keys]),
        )
    return result
