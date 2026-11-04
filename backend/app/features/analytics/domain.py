"""Simulações puras sobre a carteira. Nenhuma função aqui acessa o banco."""

from collections.abc import Callable, Collection, Mapping

from app.core.money import BPS

# split(aporte, metas, valores_atuais) -> aporte por categoria
SplitFn = Callable[[int, dict[int, int], dict[int, int]], dict[int, int]]


def shares_bps(values: Mapping[int, int]) -> dict[int, int]:
    """Participação de cada categoria no total, em pontos-base (meio para cima)."""
    total = sum(values.values())
    if total <= 0:
        return {key: 0 for key in values}
    return {key: (2 * value * BPS + total) // (2 * total) for key, value in values.items()}


def simulate_contributions(
    current: Mapping[int, int],
    targets: Mapping[int, int],
    amount_cents: int,
    months: int,
    split: SplitFn,
) -> list[dict[int, int]]:
    """Valor de cada categoria hoje (índice 0) e após cada mês de aporte.

    Sem rentabilidade: mostra só o efeito dos aportes sobre a composição da carteira.
    """
    state = {key: current.get(key, 0) for key in targets}
    states = [dict(state)]
    for _ in range(months):
        parts = split(amount_cents, dict(targets), dict(state))
        state = {key: state[key] + parts[key] for key in state}
        states.append(dict(state))
    return states


def base_shares_bps(values: Mapping[int, int], fully_held: Collection[int] = ()) -> dict[int, int]:
    """Participação de cada categoria dentro da base, sem as que têm todos os ativos mantidos."""
    return shares_bps({key: value for key, value in values.items() if key not in fully_held})


def max_gap_bps(
    values: Mapping[int, int], targets: Mapping[int, int], fully_held: Collection[int] = ()
) -> int:
    """Maior distância, em pontos-base, entre a participação real e a meta.

    `targets` são as metas efetivas (já reescaladas). Mede só as categorias que não estão
    totalmente mantidas, sobre a base delas: a categoria toda mantida não tem meta que valha. O
    ativo mantido de uma categoria parcial conta no valor dela.
    """
    shares = base_shares_bps(values, fully_held)
    return max(
        (abs(shares[key] - target) for key, target in targets.items() if key not in fully_held),
        default=0,
    )


def months_to_target(
    states: list[dict[int, int]],
    targets: Mapping[int, int],
    tolerance_bps: int,
    fully_held: Collection[int] = (),
) -> int | None:
    """Primeiro mês em que toda categoria está a até `tolerance_bps` da meta (None se não chega).

    Sem nada na base (carteira vazia, ou só categorias totalmente mantidas) não há o que comparar.
    """
    for month, values in enumerate(states):
        base = sum(value for key, value in values.items() if key not in fully_held)
        if base > 0 and max_gap_bps(values, targets, fully_held) <= tolerance_bps:
            return month
    return None
