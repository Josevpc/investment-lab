import { formatMonthList } from "./format";

/**
 * De onde vieram os aportes de um período: lançados nos ativos ("diario"), parte pelo aporte planejado ("misto")
 * ou todos pelo planejado ("planejado"). Fica em shared porque Histórico e Metas mostram o mesmo aviso, e
 * history já depende de goals (goals importar de history criaria um ciclo).
 */
export type ContributionsSource = "diario" | "misto" | "planejado";

export interface ContributionsEstimate {
  /** Opcional: versões antigas da API não mandam; tratamos como "diario". */
  contributions_source?: ContributionsSource;
  estimated_months?: readonly string[];
}

export function isEstimated(e: ContributionsEstimate): boolean {
  return e.contributions_source === "misto" || e.contributions_source === "planejado";
}

/** Dica curta sob o valor de "aportes". */
export function contributionsHint(e: ContributionsEstimate): string {
  switch (e.contributions_source) {
    case "diario":
      return "Lançados nos ativos";
    case "misto":
      return "Parte estimada pelo aporte planejado";
    case "planejado":
      return "Estimado pelo aporte planejado";
    default:
      return "Entradas de dinheiro no período";
  }
}

/** Diz quais meses entraram pelo aporte planejado, para a pessoa saber o que lançar se quiser o número exato. */
export function estimatedContributionsText(e: ContributionsEstimate): string {
  const months = e.estimated_months ?? [];
  const count = months.length === 1 ? "1 mês" : `${months.length} meses`;
  const list = months.length > 0 ? ` (${formatMonthList(months)})` : "";
  if (e.contributions_source === "planejado") {
    return `Nenhum aporte foi lançado nos ativos no período${list}, então usamos o aporte planejado de cada mês. A valorização também é estimada.`;
  }
  return `Em ${count} sem aportes lançados nos ativos${list}, usamos o aporte planejado. Nos demais, os aportes lançados.`;
}
