import type { Reserve } from "../types";

/**
 * Quanto do aporte do mês sugerir para a reserva.
 *
 * No modo "% do aporte" é essa parte do valor final; no modo fixo, o valor mensal configurado.
 * Com meta definida, nunca passa do que falta; meta atingida sugere zero.
 */
export function defaultReserveCents(
  reserve: Pick<Reserve, "monthly_mode" | "percent_bps" | "monthly_cents" | "goal_cents" | "reached" | "remaining_cents">,
  contributionCents: number,
): number {
  const wanted =
    reserve.monthly_mode === "percent"
      ? Math.round((contributionCents * reserve.percent_bps) / 10_000)
      : reserve.monthly_cents;
  if (reserve.goal_cents === 0) return wanted;
  return reserve.reached ? 0 : Math.min(wanted, reserve.remaining_cents);
}
