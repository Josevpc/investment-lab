import random

import pytest

from app.core.money import percent_of, split_by_weights


def test_percent_of_rounds_half_up():
    assert percent_of(500_000, 1_000) == 50_000  # 10% de R$ 5.000,00
    assert percent_of(500_000, 750) == 37_500  # 7,5%
    assert percent_of(1, 5_000) == 1  # 0,5 centavo sobe para 1
    assert percent_of(0, 1_000) == 0


def test_split_by_weights_exact_total_and_remainder_to_largest():
    parts = split_by_weights(100, {"a": 3333, "b": 3333, "c": 3334})
    assert sum(parts.values()) == 100
    assert parts == {"a": 33, "b": 33, "c": 34}


def test_split_by_weights_always_sums_to_total():
    rng = random.Random(42)
    for _ in range(500):
        total = rng.randint(0, 5_000_000)
        keys = range(rng.randint(1, 8))
        weights = {k: rng.randint(0, 10_000) for k in keys}
        if sum(weights.values()) == 0:
            weights[0] = 1
        assert sum(split_by_weights(total, weights).values()) == total


def test_split_by_weights_rejects_invalid_input():
    with pytest.raises(ValueError):
        split_by_weights(-1, {"a": 1})
    with pytest.raises(ValueError):
        split_by_weights(10, {"a": 0})
    with pytest.raises(ValueError):
        split_by_weights(10, {"a": -1, "b": 2})
