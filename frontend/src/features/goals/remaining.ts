import { useComparison, type HoldStatus } from "@/features/allocation";
import { planProgress, useContributions } from "@/features/contributions";
import { useMonthSummary } from "@/features/portfolio";

/**
 * Quanto falta aportar no mês para o plano gravado ficar completo (o que faz o mês contar na sequência).
 * Mesma conta do acompanhamento do plano na tela de Aporte. null enquanto carrega, sem plano gravado ou se
 * não deu para saber quais categorias estão mantidas (o valor poderia estar errado, então não é mostrado).
 *
 * Fica fora do `hooks.ts` e do `index.ts` da feature de propósito: a carteira importa as metas, e este
 * arquivo importa a carteira.
 */
export function useMonthRemaining(month: string): number | null {
  const contributions = useContributions();
  const summary = useMonthSummary(month);
  const comparison = useComparison();

  const contribution = (contributions.data ?? []).find((c) => c.month === month);
  if (!contribution || contribution.plan.length === 0 || !summary.data || !comparison.data) return null;

  const holdStatus: Record<string, HoldStatus> = Object.fromEntries(comparison.data.items.map((i) => [i.class_key, i.hold_status]));
  return planProgress(contribution, { byClass: summary.data.by_class, reserveCents: summary.data.reserve_cents }, holdStatus)
    .remainingCents;
}
