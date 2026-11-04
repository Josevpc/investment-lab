export type RangeKey = "6m" | "12m" | "5y" | "all";

export const RANGES: { key: RangeKey; label: string; long: string }[] = [
  { key: "6m", label: "6M", long: "Últimos 6 meses" },
  { key: "12m", label: "1A", long: "Últimos 12 meses" },
  { key: "5y", label: "5A", long: "Últimos 5 anos" },
  { key: "all", label: "Todo o período", long: "Todo o período" },
];

const MONTHS_BACK: Record<Exclude<RangeKey, "all">, number> = { "6m": 6, "12m": 12, "5y": 60 };

export function rangeLabel(range: RangeKey): string {
  return RANGES.find((r) => r.key === range)?.long ?? "";
}

/** Data inicial (AAAA-MM-DD) do filtro de período, ou undefined para "tudo". */
export function rangeStart(range: RangeKey, now = new Date()): string | undefined {
  if (range === "all") return undefined;
  const start = new Date(now.getFullYear(), now.getMonth() - MONTHS_BACK[range], now.getDate());
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}
