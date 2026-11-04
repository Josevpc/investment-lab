import type { MoneyTextPart } from "@/shared/lib/moneyText";
import type { MonthSummary } from "../types";

const names = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });

/**
 * "R$ A em aportes + R$ B em ativos novos (CDB X e Tesouro)": de onde veio o investido no mês.
 * Sem ativo novo no mês, não há o que separar (null).
 */
export function investedDetail(summary: Pick<MonthSummary, "registered_cents" | "new_assets_cents" | "new_assets">): MoneyTextPart[] | null {
  if (summary.new_assets_cents <= 0) return null;
  const list = summary.new_assets.map((a) => a.asset_name);
  return [
    { cents: summary.registered_cents },
    " em aportes + ",
    { cents: summary.new_assets_cents },
    ` em ${summary.new_assets.length === 1 ? "ativo novo" : "ativos novos"}${list.length > 0 ? ` (${names.format(list)})` : ""}`,
  ];
}
