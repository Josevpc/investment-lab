import type { Streak } from "../types";

/** AAAA-MM `n` meses depois (ou antes, se negativo). */
export function addMonths(month: string, n: number): string {
  const [year, m] = month.split("-").map(Number);
  const index = year * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/**
 * De que mês a que mês vai a sequência atual. Com o mês em andamento cumprido ela termina nele;
 * senão, no anterior (o aberto ainda não conta). Calculada pela contagem, que pode passar da janela de 12 meses.
 */
export function streakRange(streak: Streak, month: string): { start: string; end: string } | null {
  if (streak.current <= 0) return null;
  const end = streak.current_month_met ? month : addMonths(month, -1);
  return { start: addMonths(end, -(streak.current - 1)), end };
}

const MARKS = [25, 50, 75, 100] as const;

/**
 * Marcos de 25/50/75/100% de uma meta: os alcançados e quanto falta, em centavos, para o próximo.
 * O valor do marco arredonda para cima (só vale ao alcançar o centavo inteiro).
 */
export function milestoneStatus(
  progressBps: number,
  currentCents: number,
  goalCents: number,
): { reached: number[]; next: { percent: number; remainingCents: number } | null } {
  if (goalCents <= 0) return { reached: [], next: null };
  const reached = MARKS.filter((mark) => progressBps >= mark * 100);
  const nextMark = MARKS.find((mark) => progressBps < mark * 100);
  if (nextMark === undefined) return { reached: [...reached], next: null };
  const markCents = Number((BigInt(goalCents) * BigInt(nextMark) + 99n) / 100n);
  return { reached: [...reached], next: { percent: nextMark, remainingCents: Math.max(0, markCents - currentCents) } };
}

/** Meses que ainda restam no ano, contando o atual (ele ainda pode receber aporte). */
export function monthsLeftInYear(month: string): number {
  return 12 - Number(month.split("-")[1]) + 1;
}

/** Posição de um AAAA-MM num eixo numérico de anos (2026,5 = julho), para marcar datas entre os pontos anuais. */
export function yearFraction(month: string): number {
  const [year, m] = month.split("-").map(Number);
  return year + (m - 1) / 12;
}
