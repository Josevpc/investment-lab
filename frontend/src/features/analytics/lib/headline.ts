import { currentMonth, formatMonth, formatPointsDiff } from "@/shared/lib/format";
import type { Trajectory } from "../types";

/** Mês (AAAA-MM) que fica `months` meses depois de `now`. */
export function monthAfter(months: number, now = new Date()): string {
  return currentMonth(new Date(now.getFullYear(), now.getMonth() + months, 1));
}

export function formatDuration(months: number): string {
  if (months < 12) return `${months} ${months === 1 ? "mês" : "meses"}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = `${years} ${years === 1 ? "ano" : "anos"}`;
  return rest === 0 ? y : `${y} e ${rest} ${rest === 1 ? "mês" : "meses"}`;
}

/** Desvio em pontos percentuais com uma casa ("37,1 p.p."), igual na frase e nos cartões. */
export function formatGap(bps: number): string {
  return `${(Math.abs(bps) / 100).toFixed(1).replace(".", ",")} p.p.`;
}

/** Frase-resumo do resultado da simulação. */
export function trajectoryHeadline(t: Trajectory, now = new Date()): string {
  const tolerance = formatPointsDiff(t.tolerance_bps).replace("+", "");
  // As todas mantidas estão com a meta suspensa: o back-end mede só as que recebem aportes, contra a
  // meta ajustada, e a frase diz isso.
  if (t.all_held) {
    return "Todos os ativos estão em \"Manter posição\": a simulação fica sem aportes e a carteira não muda de composição.";
  }
  const anyHeld = t.classes.some((c) => c.hold_status === "all");
  const which = anyHeld ? "categoria que recebe aportes" : "categoria";
  const target = anyHeld ? "da meta ajustada" : "da meta";
  if (t.months_to_target === 0) {
    return `Sua carteira já está dentro de ${tolerance} de cada meta${anyHeld ? " ajustada" : ""}.`;
  }
  if (t.months_to_target !== null) {
    const when = formatMonth(monthAfter(t.months_to_target, now));
    return `Em ${formatDuration(t.months_to_target)} (${when}) toda ${which} fica a até ${tolerance} ${target}.`;
  }
  if (t.monthly_contribution_cents === 0) {
    return "Sem aportes a carteira não muda de composição. Informe um valor mensal para simular.";
  }
  return (
    `Em ${formatDuration(t.months)} a carteira ainda não chega à meta${anyHeld ? " ajustada" : ""}: o maior desvio vai de ` +
    `${formatGap(t.start_gap_bps)} para ${formatGap(t.end_gap_bps)}`
  );
}
