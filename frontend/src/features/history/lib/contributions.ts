import type { ContributionsMonth } from "../types";

/** Sem nenhum aporte nem saldo trazido no período (um plano sozinho não faz o mês "ter dados"). */
export function hasNoContributions(months: readonly ContributionsMonth[]): boolean {
  return months.every((m) => m.contributed_cents === 0 && m.carried_in_cents === 0);
}

/** Aporte menos planejado, ou null no mês sem plano ("sem plano" não é zero planejado). */
export function planDifference(month: ContributionsMonth): number | null {
  return month.planned_cents === null ? null : month.contributed_cents - month.planned_cents;
}

export interface ContributionsSummary {
  /** Média do aporte dos meses fechados, arredondada meio para cima; null se ainda não há mês fechado com aporte. */
  averageCents: number | null;
  /** Quantos meses entraram na média. */
  averageMonths: number;
  /** Primeiro mês que entrou na média ("YYYY-MM"). */
  averageSince: string | null;
  /** Aporte e plano do mês em andamento; null se o período não o inclui. */
  current: { contributedCents: number; plannedCents: number | null } | null;
}

/**
 * Média dos meses completos: exclui o mês em andamento (ainda incompleto) e os meses anteriores ao primeiro aporte
 * (o app ainda não era usado, e zeros ali puxariam a média para baixo sem significar nada). Depois do primeiro
 * aporte, mês sem aporte conta como zero: foi um mês em que não se investiu. O saldo trazido não entra.
 */
export function summarizeContributions(months: readonly ContributionsMonth[]): ContributionsSummary {
  const closed = months.filter((m) => !m.in_progress);
  const first = closed.findIndex((m) => m.contributed_cents > 0);
  const counted = first === -1 ? [] : closed.slice(first);
  const total = counted.reduce((sum, m) => sum + m.contributed_cents, 0);
  const n = counted.length;
  const inProgress = months.find((m) => m.in_progress);
  return {
    // Meio para cima em inteiros: (2·total + n) / 2n, sem float.
    averageCents: n === 0 ? null : Math.floor((2 * total + n) / (2 * n)),
    averageMonths: n,
    averageSince: n === 0 ? null : counted[0].month,
    current: inProgress ? { contributedCents: inProgress.contributed_cents, plannedCents: inProgress.planned_cents } : null,
  };
}

/**
 * Meses com rótulo no eixo: no máximo 5 rótulos, contando a partir do último (o mês atual sempre aparece).
 * Fixar pela quantidade, e não pela largura, mantém o eixo previsível; o resto está na dica e na tabela.
 */
export function tickMonths(months: readonly ContributionsMonth[]): string[] {
  const step = Math.max(1, Math.ceil(months.length / 5));
  return months.filter((_, i) => (months.length - 1 - i) % step === 0).map((m) => m.month);
}

/**
 * Eixo de valores em 4 faixas iguais e redondas, com teto acima do maior aporte ou plano. O saldo trazido de um ativo
 * antigo pode ser dezenas de vezes o aporte mensal e achataria todas as colunas; por isso é cortado no teto (e o aviso
 * sob o gráfico diz quais). Sem aporte nem plano (só saldo trazido), o eixo é automático.
 */
export function valueAxis(months: readonly ContributionsMonth[]): { ceiling: number; ticks: number[] } | undefined {
  const top = Math.max(0, ...months.map((m) => Math.max(m.contributed_cents, m.planned_cents ?? 0)));
  if (top === 0) return undefined;
  const rawStep = Math.ceil((top * 1.1) / 4);
  const unit = 10 ** (String(rawStep).length - 1);
  const step = [1, 2, 2.5, 5, 10].map((m) => m * unit).find((candidate) => candidate >= rawStep) as number;
  return { ceiling: step * 4, ticks: [0, 1, 2, 3, 4].map((i) => Math.round(step * i)) };
}
