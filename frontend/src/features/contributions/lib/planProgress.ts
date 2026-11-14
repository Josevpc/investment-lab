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
  /** Comprado + separado: tudo o que conta na meta da categoria no mês. */
  doneCents: number;
  /** A parte de `doneCents` que foi comprada (já investida). */
  boughtCents: number;
  /** A parte de `doneCents` separada neste mês para comprar (ainda não investida). */
  separatedCents: number;
  /** Compras do mês pagas com separado de meses anteriores. Só informa: já contou no mês em que foi separado. */
  fromReservedCents: number;
  /** Comprado + separado já cobre o planejado (só vale com algo planejado). */
  fulfilled: boolean;
  /** 0 a 10.000: o trecho comprado, e o trecho separado logo depois dele, para a barra (sobre o maior entre planejado e feito). */
  boughtBps: number;
  separatedBps: number;
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
  /** Quanto de `doneCents` está separado (ainda não investido). */
  separatedCents: number;
  /** Soma do que falta em cada linha; excesso numa categoria não abate a falta de outra. */
  remainingCents: number;
  complete: boolean;
}

/** O que já foi aportado e conta na meta do mês. O que está "fora da meta" não entra aqui: vem à parte, só para ser mostrado. */
export interface Executed {
  /**
   * `amount_cents` é o que conta na meta e já inclui `reserved_cents` (o separado do mês); `from_reserved_cents`
   * é só informativo (já está fora de `amount_cents`).
   */
  byClass: { class_key: string; amount_cents: number; reserved_cents?: number; from_reserved_cents?: number }[];
  reserveCents: number;
  /** Total marcado como fora da meta (reserva e categorias): continua investido, mas não conta no plano. */
  offGoalCents?: number;
}

/** "Feito x planejado" usa só a parte que conta na meta (`goal_cents`), não o total aportado. */
export function executedFromSummary(summary: Pick<MonthSummary, "by_class" | "reserve_goal_cents" | "off_goal_cents">): Executed {
  return {
    byClass: summary.by_class.map((c) => ({
      class_key: c.class_key,
      amount_cents: c.goal_cents,
      reserved_cents: c.reserved_cents ?? 0,
      from_reserved_cents: c.from_reserved_cents ?? 0,
    })),
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
  const done = new Map(executed.byClass.map((c) => [c.class_key, c]));
  const row = (
    key: string,
    name: string,
    color: string,
    isReserve: boolean,
    planned: number,
    doneCents: number,
    held = false,
    reserved = 0,
    fromReservedCents = 0,
  ): PlanRow => {
    const separatedCents = Math.min(Math.max(reserved, 0), doneCents);
    const bps = (cents: number) => (planned > 0 ? Math.min(10_000, Math.floor((cents * 10_000) / planned)) : 0);
    // Passou do planejado: a barra reparte o total entre comprado e separado, para o hachurado não sumir.
    const share = (cents: number) => Math.floor((cents * 10_000) / Math.max(planned, doneCents, 1));
    const boughtBps = share(doneCents - separatedCents);
    return {
      key,
      name,
      color,
      isReserve,
      held,
      plannedCents: planned,
      doneCents,
      boughtCents: doneCents - separatedCents,
      separatedCents,
      fromReservedCents,
      fulfilled: planned > 0 && doneCents >= planned,
      boughtBps,
      separatedBps: Math.min(share(separatedCents), 10_000 - boughtBps),
      remainingCents: held ? 0 : Math.max(0, planned - doneCents),
      overCents: Math.max(0, doneCents - planned),
      progressBps: planned > 0 ? bps(doneCents) : null,
    };
  };

  const rows = contribution.plan.map((item) => {
    const executedClass = done.get(item.class_key);
    return row(
      item.class_key,
      item.class_name,
      item.color,
      false,
      item.amount_cents,
      executedClass?.amount_cents ?? 0,
      holdStatus[item.class_key] === "all",
      executedClass?.reserved_cents ?? 0,
      executedClass?.from_reserved_cents ?? 0,
    );
  });
  if (contribution.reserve_cents > 0 || executed.reserveCents > 0) {
    rows.push(row("reserva", "Reserva de emergência", RESERVE_COLOR, true, contribution.reserve_cents, executed.reserveCents));
  }

  const remainingCents = rows.reduce((sum, r) => sum + r.remainingCents, 0);
  return {
    rows,
    plannedCents: rows.reduce((sum, r) => (r.held ? sum : sum + r.plannedCents), 0),
    doneCents: rows.reduce((sum, r) => sum + r.doneCents, 0),
    separatedCents: rows.reduce((sum, r) => sum + r.separatedCents, 0),
    remainingCents,
    complete: remainingCents === 0,
  };
}
