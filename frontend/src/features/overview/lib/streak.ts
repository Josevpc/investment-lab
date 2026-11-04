import type { GoalsProgress } from "@/features/goals";
import { formatMonth } from "@/shared/lib/format";

type StreakMonth = GoalsProgress["streak"]["months"][number];

export const STREAK_DOTS = 12;

export interface StreakDot {
  month: string;
  state: StreakMonth["state"];
  /** "out/2026: aporte cumprido" */
  label: string;
}

const STATE_TEXT: Record<StreakMonth["state"], string> = {
  met: "aporte cumprido",
  open: "mês em andamento",
  missed: "sem aporte",
};

/** Os últimos 12 meses da sequência, do mais antigo ao mais novo, cada um com o estado por extenso. */
export function streakDots(months: readonly StreakMonth[]): StreakDot[] {
  return months.slice(-STREAK_DOTS).map(({ month, state }) => ({ month, state, label: `${formatMonth(month)}: ${STATE_TEXT[state]}` }));
}

/** Resumo para leitores de tela: a cor dos pontos não pode ser o único sinal. */
export function streakSummary(dots: readonly StreakDot[]): string {
  const count = (state: StreakMonth["state"]) => dots.filter((d) => d.state === state).length;
  const met = count("met");
  const open = count("open");
  const missed = count("missed");
  const parts = [
    `${met} ${met === 1 ? "mês cumprido" : "meses cumpridos"}`,
    ...(open > 0 ? [`${open} em andamento`] : []),
    `${missed} sem aporte`,
  ];
  return `Últimos ${dots.length} meses: ${parts.join(", ")}.`;
}
