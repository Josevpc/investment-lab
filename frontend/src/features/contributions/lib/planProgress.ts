import type { HoldStatus } from "@/features/allocation";
import type { MonthSummary } from "@/features/portfolio";
import { RESERVE_COLOR } from "@/shared/lib/chart";
import type { Contribution } from "../types";

export interface PlanRow {
  key: string;
  name: string;
  color: string;
  isReserve: boolean;
  /** Categoria com todos os ativos mantidos hoje (marca no cadastro do ativo). */
  held: boolean;
  plannedCents: number;
  doneCents: number;
  /** O que ainda falta aportar (nunca negativo; 0 na toda mantida). */
  remainingCents: number;
  /** O quanto já passou do planejado (nunca negativo). */
  overCents: number;
  /** 0 a 10.000, ou null quando nada estava planejado. */
  progressBps: number | null;
}

export interface PlanProgress {
  rows: PlanRow[];
  plannedCents: number;
  doneCents: number;
  /** Soma do que falta em cada linha; excesso numa categoria não abate a falta de outra. */
  remainingCents: number;
  complete: boolean;
}

/** O que já foi aportado e conta na meta do mês. O que está "fora da meta" não entra aqui: vem à parte, só para ser mostrado. */
export interface Executed {
  byClass: { class_key: string; amount_cents: number }[];
  reserveCents: number;
  /** Total marcado como fora da meta (reserva e categorias): continua investido, mas não conta no plano. */
  offGoalCents?: number;
}

/** "Feito x planejado" usa só a parte que conta na meta (`goal_cents`), não o total aportado. */
export function executedFromSummary(summary: Pick<MonthSummary, "by_class" | "reserve_goal_cents" | "off_goal_cents">): Executed {
  return {
    byClass: summary.by_class.map((c) => ({ class_key: c.class_key, amount_cents: c.goal_cents })),
    reserveCents: summary.reserve_goal_cents,
    offGoalCents: summary.off_goal_cents,
  };
}

/**
 * Compara o plano gravado do mês com o que já foi aportado (diário de movimentos).
 * `holdStatus` vem do back-end (situação de hoje); o plano gravado não guarda quem estava mantido.
 * Categoria toda mantida hoje não vai receber aporte: o que o plano previa para ela fica na linha
 * (para mostrar), mas sai do planejado e do que falta, e não impede o "plano cumprido".
 */
export function planProgress(
  contribution: Contribution,
  executed: Executed,
  holdStatus: Readonly<Record<string, HoldStatus>> = {},
): PlanProgress {
  const done = new Map(executed.byClass.map((c) => [c.class_key, c.amount_cents]));
  const row = (
    key: string,
    name: string,
    color: string,
    isReserve: boolean,
    planned: number,
    doneCents: number,
    held = false,
  ): PlanRow => ({
    key,
    name,
    color,
    isReserve,
    held,
    plannedCents: planned,
    doneCents,
    remainingCents: held ? 0 : Math.max(0, planned - doneCents),
    overCents: Math.max(0, doneCents - planned),
    progressBps: planned > 0 ? Math.min(10_000, Math.floor((doneCents * 10_000) / planned)) : null,
  });

  const rows = contribution.plan.map((item) =>
    row(
      item.class_key,
      item.class_name,
      item.color,
      false,
      item.amount_cents,
      done.get(item.class_key) ?? 0,
      holdStatus[item.class_key] === "all",
    ),
  );
  if (contribution.reserve_cents > 0 || executed.reserveCents > 0) {
    rows.push(row("reserva", "Reserva de emergência", RESERVE_COLOR, true, contribution.reserve_cents, executed.reserveCents));
  }

  const remainingCents = rows.reduce((sum, r) => sum + r.remainingCents, 0);
  return {
    rows,
    plannedCents: rows.reduce((sum, r) => (r.held ? sum : sum + r.plannedCents), 0),
    doneCents: rows.reduce((sum, r) => sum + r.doneCents, 0),
    remainingCents,
    complete: remainingCents === 0,
  };
}
