from app.core.money import percent_of


def calculate_contribution(salary_cents: int, percent_bps: int) -> int:
    """Aporte do mês: salário x percentual (A = S . p)."""
    return percent_of(salary_cents, percent_bps)
