import { describe, expect, it } from "vitest";
import type { PortfolioSummary } from "../types";
import { categoryBars, netWorthCents, outsideCashCents, separatedCents } from "./separated";

const base = { total_current_cents: 1_000_000, cash_cents: 50_000 };

describe("totais com o separado", () => {
  it("numa API anterior ao separado, tudo é como antes", () => {
    expect(separatedCents({})).toBe(0);
    expect(netWorthCents(base)).toBe(1_000_000);
    expect(outsideCashCents(base)).toBe(50_000);
  });

  it("patrimônio total soma o separado e o caixa de fora é só o livre", () => {
    const s = { ...base, reserved_cents: 30_000, free_cash_cents: 20_000 };
    expect(netWorthCents(s)).toBe(1_030_000);
    expect(outsideCashCents(s)).toBe(20_000);
  });

  it("prefere o patrimônio total que a API manda", () => {
    expect(netWorthCents({ ...base, reserved_cents: 30_000, net_worth_cents: 1_030_001 })).toBe(1_030_001);
  });
});

describe("categoryBars", () => {
  const by_class = [
    { class_id: 1, class_key: "renda_fixa", class_name: "Renda fixa", color: "#111", current_cents: 600_000, invested_cents: 0, share_bps: 6000 },
    { class_id: 2, class_key: "fii", class_name: "FII", color: "#222", current_cents: 400_000, invested_cents: 0, share_bps: 4000 },
  ] as PortfolioSummary["by_class"];

  it("sem separado, não desenha nada", () => {
    expect(categoryBars({ by_class }, new Map())).toEqual([]);
    expect(categoryBars({ by_class, reserved_by_class: [{ class_key: "fii", reserved_cents: 0 }] }, new Map())).toEqual([]);
  });

  it("o percentual inclui o separado", () => {
    const bars = categoryBars({ by_class, reserved_by_class: [{ class_key: "fii", reserved_cents: 100_000 }] }, new Map());
    // Total 1.100.000: renda fixa 600 (54,55%), FII 400 + 100 separados (45,45%).
    expect(bars.map((b) => [b.key, b.currentCents, b.separatedCents, b.shareBps])).toEqual([
      ["renda_fixa", 600_000, 0, 5455],
      ["fii", 400_000, 100_000, 4545],
    ]);
  });

  it("categoria só com separado entra com o nome do cadastro", () => {
    const names = new Map([["cripto", { name: "Cripto", color: "#333" }]]);
    const bars = categoryBars({ by_class, reserved_by_class: [{ class_key: "cripto", reserved_cents: 100_000 }] }, names);
    expect(bars.at(-1)).toMatchObject({ key: "cripto", name: "Cripto", currentCents: 0, separatedCents: 100_000 });
  });
});
