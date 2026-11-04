import { describe, expect, it } from "vitest";
import { streakDots, streakSummary } from "./streak";

const months = Array.from({ length: 14 }, (_, i) => ({
  month: `2026-${String((i % 12) + 1).padStart(2, "0")}`,
  state: (i === 13 ? "open" : i % 2 === 0 ? "met" : "missed") as "met" | "missed" | "open",
}));

describe("streakDots", () => {
  it("guarda só os últimos 12 meses, na ordem", () => {
    const dots = streakDots(months);
    expect(dots).toHaveLength(12);
    expect(dots[0].month).toBe(months[2].month);
    expect(dots[11].state).toBe("open");
  });

  it("cada ponto diz o mês e o estado por extenso", () => {
    expect(streakDots([{ month: "2026-10", state: "met" }])[0].label).toBe("out/2026: aporte cumprido");
    expect(streakDots([{ month: "2026-11", state: "open" }])[0].label).toBe("nov/2026: mês em andamento");
    expect(streakDots([{ month: "2026-09", state: "missed" }])[0].label).toBe("set/2026: sem aporte");
  });
});

describe("streakSummary", () => {
  it("conta cumpridos, em andamento e sem aporte", () => {
    expect(streakSummary(streakDots(months))).toBe("Últimos 12 meses: 6 meses cumpridos, 1 em andamento, 5 sem aporte.");
  });

  it("concorda no singular e omite 'em andamento' quando não há", () => {
    expect(streakSummary(streakDots([{ month: "2026-09", state: "missed" }, { month: "2026-10", state: "met" }]))).toBe("Últimos 2 meses: 1 mês cumprido, 1 sem aporte.");
  });
});
