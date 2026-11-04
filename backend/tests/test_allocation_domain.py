import random

import pytest

from app.core.errors import InvalidInputError
from app.features.allocation.domain import (
    base_cents,
    compare_groups,
    compare_with_targets,
    effective_targets,
    group_hold_status,
    split_proportional,
    split_rebalance,
    validate_targets,
)
from app.features.allocation.service import split_amounts

TARGETS = {"rf": 5_000, "acoes": 2_500, "etfs": 1_500, "cripto": 1_000}


def test_validate_targets_requires_100_percent():
    validate_targets(TARGETS)
    with pytest.raises(InvalidInputError, match="somam 99,00%"):
        validate_targets({"rf": 5_000, "acoes": 4_900})
    with pytest.raises(InvalidInputError):
        validate_targets({"rf": 11_000, "acoes": -1_000})


def test_validate_targets_counts_every_category_even_with_a_zero_target():
    # Uma categoria com todos os ativos mantidos continua no plano e a soma é sempre de todas.
    validate_targets({"rf": 5_000, "acoes": 5_000, "cripto": 0})
    with pytest.raises(InvalidInputError, match="somam 90,00%"):
        validate_targets({"rf": 5_000, "acoes": 4_000, "cripto": 0})


def test_split_proportional():
    parts = split_proportional(50_000, TARGETS)
    assert parts == {"rf": 25_000, "acoes": 12_500, "etfs": 7_500, "cripto": 5_000}


def test_rebalance_sends_everything_to_underweight_classes():
    # Carteira de R$ 10.000 toda em renda fixa; aporte de R$ 1.000 vai só para as demais classes.
    current = {"rf": 1_000_000, "acoes": 0, "etfs": 0, "cripto": 0}
    parts = split_rebalance(100_000, TARGETS, current)
    assert parts["rf"] == 0
    assert sum(parts.values()) == 100_000
    assert parts["acoes"] > parts["etfs"] > parts["cripto"]


def test_rebalance_when_portfolio_already_matches_target_equals_proportional():
    current = {"rf": 500_000, "acoes": 250_000, "etfs": 150_000, "cripto": 100_000}
    assert split_rebalance(100_000, TARGETS, current) == split_proportional(100_000, TARGETS)


def test_rebalance_gap_smaller_than_contribution_spreads_leftover_by_targets():
    # Só "cripto" está abaixo da meta, e por pouco: recebe a deficiência e o resto vai por metas.
    current = {"rf": 500_000, "acoes": 250_000, "etfs": 150_000, "cripto": 99_000}
    parts = split_rebalance(100_000, TARGETS, current)
    assert sum(parts.values()) == 100_000
    assert parts["cripto"] >= 1_000


def test_rebalance_with_zero_contribution_returns_zeros_even_when_balanced():
    balanced = {"rf": 500_000, "acoes": 250_000, "etfs": 150_000, "cripto": 100_000}
    empty = {"rf": 0, "acoes": 0, "etfs": 0, "cripto": 0}
    for current in (balanced, empty):
        assert split_rebalance(0, TARGETS, current) == {k: 0 for k in TARGETS}


def test_rebalance_into_an_empty_portfolio_follows_the_targets():
    empty = {"rf": 0, "acoes": 0, "etfs": 0, "cripto": 0}
    assert split_rebalance(100_000, TARGETS, empty) == split_proportional(100_000, TARGETS)


def test_rebalance_always_sums_to_contribution():
    rng = random.Random(7)
    keys = list(TARGETS)
    for _ in range(500):
        current = {k: rng.randint(0, 5_000_000) for k in keys}
        amount = rng.randint(0, 2_000_000)
        parts = split_rebalance(amount, TARGETS, current)
        assert sum(parts.values()) == amount
        assert all(v >= 0 for v in parts.values())


def test_compare_with_targets():
    current = {"rf": 800_000, "acoes": 100_000, "etfs": 100_000, "cripto": 0}
    result = compare_with_targets(current, TARGETS)
    assert result["rf"].current_bps == 8_000
    assert result["rf"].diff_cents == 300_000  # R$ 3.000 acima da meta
    assert result["cripto"].diff_cents == -100_000


def test_compare_with_empty_portfolio():
    result = compare_with_targets({"rf": 0, "acoes": 0, "etfs": 0, "cripto": 0}, TARGETS)
    assert all(row.current_bps == 0 and row.diff_cents == 0 for row in result.values())


# ---- manter posição: categoria com todos os ativos mantidos ("all") ----------------------

# Metas do cenário 50/30/20 com a categoria "rv" toda mantida.
SCENARIO = {"rf": 5_000, "rv": 3_000, "cripto": 2_000}


def test_effective_targets_without_a_fully_held_category_are_the_targets():
    assert effective_targets(TARGETS) == TARGETS
    assert effective_targets(TARGETS, fully_held=()) == TARGETS


def test_effective_targets_rescale_to_10000_without_losing_bps():
    result = effective_targets(SCENARIO, {"rv"})
    assert result == {"rf": 7_143, "rv": 0, "cripto": 2_857}
    assert sum(result.values()) == 10_000


def test_effective_targets_give_the_leftover_bps_to_the_largest_remainders():
    # 10.000/3 = 3.333,33 para cada uma: sobra 1 bp, que vai para a primeira no empate.
    result = effective_targets({"a": 1, "b": 1, "c": 1, "x": 9_997}, {"x"})
    assert result == {"a": 3_334, "b": 3_333, "c": 3_333, "x": 0}
    # Resto maior vence: 7/9 = 7.777,77 e 2/9 = 2.222,22 -> o 1 bp vai para o 7.
    assert effective_targets({"a": 7, "b": 2, "x": 9_991}, {"x"}) == {
        "a": 7_778,
        "b": 2_222,
        "x": 0,
    }


def test_effective_targets_always_sum_to_10000_and_are_deterministic():
    rng = random.Random(3)
    keys = ["a", "b", "c", "d", "e"]
    for _ in range(300):
        cuts = sorted(rng.randint(0, 10_000) for _ in range(len(keys) - 1))
        edges = [0, *cuts, 10_000]
        targets = {key: edges[i + 1] - edges[i] for i, key in enumerate(keys)}
        held = {k for k in keys if rng.random() < 0.4}
        if len(held) == len(keys):
            continue
        result = effective_targets(targets, held)
        assert sum(result.values()) == 10_000
        assert all(result[k] == 0 for k in held)
        assert result == effective_targets(targets, held)


def test_effective_targets_with_only_zero_targets_left_split_equally():
    assert effective_targets({"a": 0, "b": 0, "x": 10_000}, {"x"}) == {
        "a": 5_000,
        "b": 5_000,
        "x": 0,
    }


def test_effective_targets_with_everything_held_are_all_zero():
    assert effective_targets(SCENARIO, set(SCENARIO)) == dict.fromkeys(SCENARIO, 0)


def test_proportional_split_with_a_fully_held_category():
    parts = split_amounts(4_000, SCENARIO, {}, "proportional", fully_held={"rv"})
    # 4.000 x 71,43% = 2.857,2 e x 28,57% = 1.142,8: a sobra de 1 centavo vai para a maior fatia
    # (RN-02), então renda fixa fica com 2.858.
    assert parts == {"rf": 2_858, "rv": 0, "cripto": 1_142}
    assert sum(parts.values()) == 4_000


def test_rebalance_with_a_fully_held_category_leaves_it_out_of_the_base():
    # A categoria toda mantida (rv, 5.000) não entra na base: 15.000 = 10.000 + 1.000 + 4.000.
    current = {"rf": 10_000, "rv": 5_000, "cripto": 1_000}
    parts = split_amounts(4_000, SCENARIO, current, "rebalance", fully_held={"rv"})
    # Metas efetivas 7.143/2.857 sobre 15.000: déficits de 714,5 e 3.285,5; a sobra de 1 centavo
    # vai para a maior fatia.
    assert parts == {"rf": 714, "rv": 0, "cripto": 3_286}


def test_rebalance_still_counts_the_held_asset_of_a_partial_category():
    # Sem categoria toda mantida o ativo mantido já está no valor da categoria (R1): quem
    # chama passa o valor da categoria inteira e o resultado é o rebalanceamento comum.
    current = {"rf": 10_000, "rv": 5_000, "cripto": 1_000}
    assert split_amounts(4_000, SCENARIO, current, "rebalance") == {
        "rf": 0,
        "rv": 1_000,
        "cripto": 3_000,
    }


def test_split_with_a_fully_held_category_always_sums_to_contribution():
    rng = random.Random(11)
    for _ in range(300):
        current = {k: rng.randint(0, 5_000_000) for k in SCENARIO}
        amount = rng.randint(0, 2_000_000)
        held = rng.choice([{"rv"}, {"rf"}, {"rf", "cripto"}, set()])
        for mode in ("proportional", "rebalance"):
            parts = split_amounts(amount, SCENARIO, current, mode, fully_held=held)
            assert sum(parts.values()) == amount
            assert all(parts[k] == 0 for k in held)
            assert all(v >= 0 for v in parts.values())


def test_split_without_fully_held_is_unchanged():
    current = {"rf": 500_000, "acoes": 250_000, "etfs": 150_000, "cripto": 99_000}
    assert split_amounts(100_000, TARGETS, current, "rebalance") == split_rebalance(
        100_000, TARGETS, current
    )
    assert split_amounts(100_000, TARGETS, current, "proportional") == split_proportional(
        100_000, TARGETS
    )


def test_split_with_every_category_fully_held_refuses_a_contribution():
    with pytest.raises(InvalidInputError, match="Desmarque algum ativo"):
        split_amounts(1_000, SCENARIO, {}, "proportional", fully_held=set(SCENARIO))
    # Aporte zero não tem o que dividir e não é erro.
    assert split_amounts(0, SCENARIO, {}, "rebalance", fully_held=set(SCENARIO)) == {
        "rf": 0,
        "rv": 0,
        "cripto": 0,
    }


def test_compare_measures_against_the_effective_target_over_the_base():
    current = {"rf": 10_000, "rv": 5_000, "cripto": 1_000}
    assert base_cents(current, {"rv"}) == 11_000
    result = compare_with_targets(current, SCENARIO, fully_held={"rv"})

    rv = result["rv"]
    assert (rv.target_bps, rv.effective_target_bps, rv.diff_cents) == (3_000, 0, None)
    assert rv.current_bps == 3_125  # 5.000 de 16.000: sempre da carteira toda

    rf = result["rf"]
    assert rf.current_bps == 6_250
    assert (rf.target_bps, rf.effective_target_bps) == (5_000, 7_143)
    assert rf.diff_cents == 10_000 - 7_857  # 71,43% de 11.000 = 7.857,3
    assert result["cripto"].diff_cents == 1_000 - 3_143


def test_compare_without_fully_held_has_base_equal_to_the_portfolio():
    current = {"rf": 800_000, "acoes": 100_000, "etfs": 100_000, "cripto": 0}
    assert base_cents(current) == sum(current.values())
    for key, row in compare_with_targets(current, TARGETS).items():
        assert row.effective_target_bps == TARGETS[key]


def test_compare_with_an_empty_base_does_not_divide_by_zero():
    current = {"rf": 0, "rv": 100_000, "cripto": 0}  # só a categoria toda mantida tem valor
    result = compare_with_targets(current, SCENARIO, fully_held={"rv"})
    assert result["rf"].diff_cents == 0
    assert result["rf"].current_bps == 0


# ---- grupos de categorias: soma das filhas, só apresentação ----------------------------------


def test_group_current_bps_comes_from_the_summed_value_not_from_the_children_bps():
    # Três categorias de 33,33% cada: somar os bps arredondados daria 99,99%.
    current = {"a": 100, "b": 100, "c": 100}
    targets = {"a": 3_334, "b": 3_333, "c": 3_333}
    comparison = compare_with_targets(current, targets)
    assert [comparison[k].current_bps for k in "abc"] == [3_333, 3_333, 3_333]

    group = compare_groups({"g": ["a", "b", "c"]}, comparison, dict.fromkeys("abc", "none"))["g"]

    assert group.current_bps == 10_000
    assert (group.current_cents, group.target_bps, group.effective_target_bps) == (
        300,
        10_000,
        10_000,
    )


def test_group_with_every_child_kept_sums_current_targets_and_differences():
    current = {"rf": 6_000, "fii": 1_500, "acoes": 2_500}
    targets = {"rf": 5_000, "fii": 2_000, "acoes": 3_000}
    comparison = compare_with_targets(current, targets)

    group = compare_groups({"rv": ["fii", "acoes"]}, comparison, {"fii": "none", "acoes": "none"})[
        "rv"
    ]

    assert group.current_cents == 4_000 and group.current_bps == 4_000
    assert (group.target_bps, group.effective_target_bps) == (5_000, 5_000)
    # Diferenças das filhas: 1.500 - 2.000 e 2.500 - 3.000.
    assert group.diff_cents == -1_000
    assert group.diff_cents == sum(comparison[k].diff_cents for k in ("fii", "acoes"))
    assert group.hold_status == "none"


def test_group_with_a_fully_held_child_ignores_it_in_the_difference_but_counts_its_value():
    current = {"rf": 10_000, "fii": 5_000, "acoes": 1_000}
    targets = {"rf": 5_000, "fii": 3_000, "acoes": 2_000}
    comparison = compare_with_targets(current, targets, fully_held={"fii"})

    group = compare_groups({"rv": ["fii", "acoes"]}, comparison, {"fii": "all", "acoes": "none"})[
        "rv"
    ]

    assert group.current_cents == 6_000  # o valor da filha mantida conta
    assert group.target_bps == 5_000  # soma das gravadas
    assert group.effective_target_bps == 2_857  # a filha mantida entra com 0
    assert group.diff_cents == comparison["acoes"].diff_cents  # só a filha que tem diferença
    assert group.hold_status == "partial"


def test_group_whose_children_are_all_fully_held_has_no_difference():
    current = {"rf": 10_000, "fii": 5_000, "acoes": 1_000}
    targets = {"rf": 5_000, "fii": 3_000, "acoes": 2_000}
    comparison = compare_with_targets(current, targets, fully_held={"fii", "acoes"})

    group = compare_groups({"rv": ["fii", "acoes"]}, comparison, {"fii": "all", "acoes": "all"})[
        "rv"
    ]

    assert group.diff_cents is None
    assert group.hold_status == "all"
    assert group.effective_target_bps == 0


def test_group_hold_status_is_derived_from_the_children():
    assert group_hold_status(["none", "none"]) == "none"
    assert group_hold_status(["all", "all"]) == "all"
    assert group_hold_status(["none", "all"]) == "partial"
    assert group_hold_status(["partial", "none"]) == "partial"
    assert group_hold_status(["partial", "partial"]) == "partial"


def test_group_without_categories_is_left_out_and_comparing_groups_changes_nothing():
    current = {"a": 700, "b": 300}
    comparison = compare_with_targets(current, {"a": 6_000, "b": 4_000})
    before = dict(comparison)

    assert compare_groups({"vazio": []}, comparison, {"a": "none", "b": "none"}) == {}
    assert comparison == before
