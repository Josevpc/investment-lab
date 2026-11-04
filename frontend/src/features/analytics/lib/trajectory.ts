import type { TrajectoryClass, TrajectoryPoint } from "../types";

/**
 * Meta efetiva de cada categoria em % da carteira toda num mês da simulação. A meta efetiva vale
 * sobre a carteira sem as categorias todas mantidas; como elas não recebem aporte, essa fatia cresce
 * com o tempo e a meta em % da carteira toda sobe junto. null na toda mantida (meta suspensa).
 */
export function targetsOfPortfolio(point: TrajectoryPoint, classes: readonly TrajectoryClass[]): Record<string, number | null> {
  const heldCents = classes
    .filter((c) => c.hold_status === "all")
    .reduce((sum, c) => sum + (point.values_cents[c.key] ?? 0), 0);
  const baseCents = point.total_cents - heldCents;
  return Object.fromEntries(
    classes.map((c) => [
      c.key,
      c.hold_status === "all"
        ? null
        : point.total_cents > 0
          ? Math.round((c.effective_target_bps * baseCents) / point.total_cents)
          : c.effective_target_bps,
    ]),
  );
}
