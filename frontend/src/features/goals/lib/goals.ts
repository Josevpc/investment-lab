import { formatMonth, monthName } from "@/shared/lib/format";
import type { GoalBasis, GoalsProgress, Projection, Streak } from "../types";

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Quantos meses de AAAA-MM `from` até `to` (negativo se `to` for antes). */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** "daqui a 6 anos e 7 meses", "daqui a 5 meses" ou "este mês". */
export function timeUntil(months: number): string {
  if (months <= 0) return "este mês";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [years > 0 && plural(years, "ano", "anos"), rest > 0 && plural(rest, "mês", "meses")].filter(Boolean);
  return `daqui a ${parts.join(" e ")}`;
}

/** Título e explicação da sequência: o que ela vale hoje e o que falta para crescer. */
export function streakHeadline(streak: Streak, month: string): { title: string; text: string } {
  const name = monthName(month);
  if (streak.current === 0) {
    return {
      title: "Comece sua sequência",
      text: `Lance todo o aporte planejado de ${name} para acender a primeira.`,
    };
  }
  const title = plural(streak.current, "mês seguido", "meses seguidos");
  if (streak.current_month_met) {
    const record = streak.best > streak.current ? ` Seu recorde é de ${plural(streak.best, "mês", "meses")}.` : " É o seu recorde.";
    return { title, text: `${name[0].toUpperCase()}${name.slice(1)} cumprido.${record}` };
  }
  return {
    title,
    text: `Falta cumprir ${name} para chegar a ${plural(streak.current + 1, "mês", "meses")}: lance todo o aporte planejado.`,
  };
}

/** Linha de destaque ao aportar: avisa quando o aporte acabou de deixar o mês em dia. */
export function aporteHighlight(progress: GoalsProgress): string | undefined {
  const { streak } = progress;
  if (!streak.current_month_met) return undefined;
  return `🔥 Mês em dia! Sequência de ${plural(streak.current, "mês", "meses")}`;
}

/** Texto da comemoração ao fechar o mês, com o estado da sequência depois do fechamento. */
export function closingCelebration(progress: GoalsProgress): { text: string; highlight?: string } {
  const { streak } = progress;
  if (streak.current_month_met) {
    return {
      text: "Mês cumprido: aporte feito e fechamento registrado.",
      highlight: `Sequência de ${plural(streak.current, "mês", "meses")}${streak.current === streak.best && streak.current > 1 ? " (recorde!)" : ""}`,
    };
  }
  return {
    text: "Fechamento registrado. O aporte planejado do mês ainda não foi todo lançado, então a sequência segue aberta.",
    highlight: streak.current > 0 ? `Sequência atual: ${plural(streak.current, "mês", "meses")}` : undefined,
  };
}

export type ProjectionView = "nominal" | "today";

export interface ProjectionRow {
  month: string;
  conservador: number;
  base: number;
  otimista: number;
}

/** Uma linha por ano, com o valor de cada cenário no modo escolhido (nominal ou em valores de hoje). */
export function projectionRows(projection: Projection, view: ProjectionView): ProjectionRow[] {
  const byKey = Object.fromEntries(projection.scenarios.map((s) => [s.key, s]));
  const reference = projection.scenarios[0];
  const pick = (key: "conservador" | "base" | "otimista", index: number) => {
    const point = byKey[key].points[index];
    return view === "nominal" ? point.nominal_cents : point.today_cents;
  };
  return reference.points.map((point, index) => ({
    month: point.month,
    conservador: pick("conservador", index),
    base: pick("base", index),
    otimista: pick("otimista", index),
  }));
}

/**
 * Frase do cenário sobre a meta de patrimônio: quando chega, ou que não chega no horizonte.
 * Diz em que valores a conta foi feita, para a data não ser lida como nominal.
 */
export function goalSentence(
  goalMonth: string | null,
  startMonth: string,
  horizonYears: number,
  basis: GoalBasis = "today",
): string {
  const suffix = basis === "today" ? "em valores de hoje" : "em valor nominal";
  if (goalMonth === null) return `Não chega à meta em ${plural(horizonYears, "ano", "anos")}, ${suffix}`;
  return `Chega à meta em ${formatMonth(goalMonth)} (${timeUntil(monthsBetween(startMonth, goalMonth))}), ${suffix}`;
}
