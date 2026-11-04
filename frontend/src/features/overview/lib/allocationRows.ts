import { targetShareOfPortfolio, type Comparison, type ComparisonItem } from "@/features/allocation";
import { formatPercent } from "@/shared/lib/format";

export interface Gap {
  /** Participação real menos a meta, em pontos-base de ponto percentual (positivo = acima da meta). */
  bps: number;
  /** "3,5 pontos acima da meta", "na meta"; null quando a meta está suspensa. */
  text: string | null;
}

/** Abaixo disso (0,05 ponto) a diferença some no arredondamento e a tela diz "na meta". */
const ON_TARGET_BPS = 5;

/** Quantos pontos percentuais a categoria (ou grupo) está acima ou abaixo da meta, na base da carteira toda. */
export function gapFromTarget(
  item: Pick<ComparisonItem, "hold_status" | "effective_target_bps"> & { current_bps: number },
  totals: Pick<Comparison, "base_cents" | "total_cents">,
): Gap {
  const target = targetShareOfPortfolio(item, totals);
  if (target === null) return { bps: 0, text: null };
  const bps = item.current_bps - target;
  if (Math.abs(bps) < ON_TARGET_BPS) return { bps: 0, text: "na meta" };
  const points = formatPercent(Math.abs(bps)).replace("%", "");
  const unit = points === "1" ? "ponto" : "pontos";
  return { bps, text: `${points} ${unit} ${bps > 0 ? "acima" : "abaixo"} da meta` };
}

/** Chave da categoria que mais está abaixo da meta (a única que leva o selo de atenção); null se nenhuma está. */
export function biggestShortfall(
  items: readonly (Pick<ComparisonItem, "class_key" | "hold_status" | "effective_target_bps" | "current_bps">)[],
  totals: Pick<Comparison, "base_cents" | "total_cents">,
): string | null {
  let worst: { key: string; bps: number } | null = null;
  for (const item of items) {
    const { bps, text } = gapFromTarget(item, totals);
    if (text === null || bps >= 0) continue;
    if (worst === null || bps < worst.bps) worst = { key: item.class_key, bps };
  }
  return worst?.key ?? null;
}
