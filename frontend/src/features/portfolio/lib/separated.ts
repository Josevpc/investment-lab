import type { ClassBreakdown, PortfolioSummary } from "../types";

type Totals = Pick<PortfolioSummary, "total_current_cents" | "cash_cents" | "reserved_cents" | "free_cash_cents" | "net_worth_cents">;

/** Dinheiro separado para comprar, ainda não investido. 0 numa API anterior ao separado. */
export const separatedCents = (s: Pick<PortfolioSummary, "reserved_cents">): number => s.reserved_cents ?? 0;

/** Patrimônio total: o investido mais o separado. */
export const netWorthCents = (s: Totals): number => s.net_worth_cents ?? s.total_current_cents + separatedCents(s);

/** Caixa que ficou fora do patrimônio: só o que não tem destino (sem a API do separado, o caixa todo). */
export const outsideCashCents = (s: Totals): number => s.free_cash_cents ?? s.cash_cents;

export interface CategoryBar {
  key: string;
  name: string;
  color: string;
  /** Valor investido hoje na categoria. */
  currentCents: number;
  separatedCents: number;
  /** Participação da categoria, já com o separado, no total investido + separado. */
  shareBps: number;
}

/**
 * Barras por categoria com o separado ao lado do investido. A participação soma os dois: o dinheiro separado para
 * uma categoria já é "dela" na decisão. Categoria só com separado (nenhum ativo ainda) entra com o nome vindo do
 * cadastro (`names`); sem nome, pela chave. Vazio quando não há nada separado: a tela não desenha nada extra.
 */
export function categoryBars(
  summary: Pick<PortfolioSummary, "by_class" | "reserved_by_class">,
  names: ReadonlyMap<string, { name: string; color: string }>,
): CategoryBar[] {
  const reserved = new Map((summary.reserved_by_class ?? []).filter((r) => r.reserved_cents > 0).map((r) => [r.class_key, r.reserved_cents]));
  if (reserved.size === 0) return [];

  const known: ClassBreakdown[] = summary.by_class;
  const rows = known.map((c) => ({ key: c.class_key, name: c.class_name, color: c.color, currentCents: c.current_cents, separatedCents: reserved.get(c.class_key) ?? 0 }));
  for (const [key, cents] of reserved) {
    if (known.some((c) => c.class_key === key)) continue;
    const info = names.get(key);
    rows.push({ key, name: info?.name ?? key, color: info?.color ?? "var(--chart-cat-6)", currentCents: 0, separatedCents: cents });
  }

  const total = rows.reduce((sum, r) => sum + r.currentCents + r.separatedCents, 0);
  return rows
    .filter((r) => r.currentCents + r.separatedCents > 0)
    .map((r) => ({ ...r, shareBps: total > 0 ? Math.round(((r.currentCents + r.separatedCents) * 10_000) / total) : 0 }));
}
