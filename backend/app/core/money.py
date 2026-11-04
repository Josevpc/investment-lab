"""Aritmética monetária exata: dinheiro em centavos (int) e percentuais em pontos-base.

Um ponto-base é 0,01%, então 1% = 100 e 100% = 10.000.
"""

from collections.abc import Hashable, Mapping

BPS = 10_000  # 100,00% em pontos-base


def percent_of(amount_cents: int, percent_bps: int) -> int:
    """Percentual de um valor, arredondado para o centavo mais próximo (meio para cima)."""
    return (amount_cents * percent_bps + BPS // 2) // BPS


def split_by_weights[K: Hashable](total_cents: int, weights: Mapping[K, int]) -> dict[K, int]:
    """Divide `total_cents` proporcionalmente aos pesos, sem perder nem criar centavos.

    Cada parte é arredondada para baixo e a sobra vai inteira para a maior fatia (RN-02).
    """
    if total_cents < 0:
        raise ValueError("O valor a dividir não pode ser negativo.")
    if any(w < 0 for w in weights.values()):
        raise ValueError("Os pesos não podem ser negativos.")
    total_weight = sum(weights.values())
    if total_weight <= 0:
        raise ValueError("A soma dos pesos deve ser maior que zero.")

    parts = {key: total_cents * weight // total_weight for key, weight in weights.items()}
    remainder = total_cents - sum(parts.values())
    if remainder:
        largest = max(weights, key=lambda key: weights[key])
        parts[largest] += remainder
    return parts


# Teto de um lançamento (R$ 100 bilhões): evita estouro de inteiro e erro de digitação absurdo.
MAX_CENTS = 10**13


def format_brl(cents: int) -> str:
    """`R$ 1.234,56` (com sinal de menos para negativos), para as mensagens de erro."""
    whole, frac = divmod(abs(cents), 100)
    sign = "-" if cents < 0 else ""
    return f"{sign}R$ {whole:,}".replace(",", ".") + f",{frac:02d}"


def format_date(value) -> str:
    """`31/10/2026`, sem passar por fuso."""
    return value.strftime("%d/%m/%Y")
