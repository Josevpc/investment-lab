import { describe, expect, it } from "vitest";
import type { ContributionsMonth } from "../types";
import { hasNoContributions, planDifference, summarizeContributions, tickMonths, valueAxis } from "./contributions";

function month(m: string, contributed: number, overrides: Partial<ContributionsMonth> = {}): ContributionsMonth {
  return {
    month: m,
    contributed_cents: contributed,
    goal_cents: contributed,
    off_goal_cents: 0,
    carried_in_cents: 0,
    planned_cents: null,
    in_progress: false,
    ...overrides,
  };
}

describe("summarizeContributions", () => {
  it("a média só considera meses fechados: o mês em andamento fica de fora e vira 'até agora'", () => {
    const s = summarizeContributions([
      month("2026-09", 80_000),
      month("2026-10", 100_000),
      month("2026-11", 10_000, { in_progress: true, planned_cents: 90_000 }),
    ]);
    expect(s.averageCents).toBe(90_000);
    expect(s.averageMonths).toBe(2);
    expect(s.current).toEqual({ contributedCents: 10_000, plannedCents: 90_000 });
  });

  it("meses antes do primeiro aporte não entram, mas mês sem aporte depois dele conta como zero", () => {
    const s = summarizeContributions([
      month("2026-06", 0),
      month("2026-07", 0),
      month("2026-08", 90_000),
      month("2026-09", 0),
      month("2026-10", 90_000),
    ]);
    expect(s.averageMonths).toBe(3);
    expect(s.averageSince).toBe("2026-08");
    expect(s.averageCents).toBe(60_000);
  });

  it("arredonda meio para cima, em inteiros", () => {
    // 100 + 101 = 201 centavos em 2 meses: 100,5 vira 101.
    expect(summarizeContributions([month("2026-09", 100), month("2026-10", 101)]).averageCents).toBe(101);
    // 100 + 100 + 101 = 301 em 3 meses: 100,33 vira 100.
    expect(summarizeContributions([month("2026-08", 100), month("2026-09", 100), month("2026-10", 101)]).averageCents).toBe(100);
  });

  it("o saldo trazido de ativo antigo não entra na média", () => {
    const s = summarizeContributions([month("2026-09", 50_000, { carried_in_cents: 900_000 })]);
    expect(s.averageCents).toBe(50_000);
  });

  it("sem mês fechado com aporte, não há média; sem mês em andamento, não há 'até agora'", () => {
    const s = summarizeContributions([month("2026-10", 0), month("2026-11", 0, { in_progress: true })]);
    expect(s.averageCents).toBeNull();
    expect(s.current).toEqual({ contributedCents: 0, plannedCents: null });
    expect(summarizeContributions([]).current).toBeNull();
  });
});

describe("planDifference", () => {
  it("é aporte menos planejado; sem plano não há diferença", () => {
    expect(planDifference(month("2026-10", 120_000, { planned_cents: 100_000 }))).toBe(20_000);
    expect(planDifference(month("2026-10", 60_000, { planned_cents: 100_000 }))).toBe(-40_000);
    expect(planDifference(month("2026-10", 60_000, { planned_cents: 0 }))).toBe(60_000);
    expect(planDifference(month("2026-10", 60_000))).toBeNull();
  });
});

describe("hasNoContributions", () => {
  it("vazio, ou só zeros, é sem aporte; saldo trazido já é dado", () => {
    expect(hasNoContributions([])).toBe(true);
    expect(hasNoContributions([month("2026-10", 0, { planned_cents: 10_000 })])).toBe(true);
    expect(hasNoContributions([month("2026-10", 0, { carried_in_cents: 5_000 })])).toBe(false);
    expect(hasNoContributions([month("2026-10", 5_000)])).toBe(false);
  });
});

describe("tickMonths", () => {
  const range = (n: number) => Array.from({ length: n }, (_, i) => month(`2026-${String(i + 1).padStart(2, "0")}`, 0));

  it("mostra todos os meses quando são poucos", () => {
    expect(tickMonths(range(4))).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });

  it("com muitos meses pula de forma regular, contando do último (o mês atual sempre aparece)", () => {
    expect(tickMonths(range(12))).toEqual(["2026-03", "2026-06", "2026-09", "2026-12"]);
    expect(tickMonths(range(12)).at(-1)).toBe("2026-12");
  });
});

describe("valueAxis", () => {
  it("fecha o eixo em 4 faixas redondas acima do maior aporte ou plano", () => {
    const axis = valueAxis([month("2026-10", 55_000, { planned_cents: 48_750 })]);
    expect(axis).toEqual({ ceiling: 80_000, ticks: [0, 20_000, 40_000, 60_000, 80_000] });
  });

  it("o plano maior que o aporte também conta para o teto", () => {
    expect(valueAxis([month("2026-10", 10_000, { planned_cents: 100_000 })])?.ceiling).toBeGreaterThanOrEqual(100_000);
  });

  it("o saldo trazido não estica o eixo", () => {
    const axis = valueAxis([month("2026-10", 50_000, { carried_in_cents: 19_900_000 })]);
    expect(axis?.ceiling).toBeLessThan(100_000);
  });

  it("sem aporte nem plano, o eixo é automático", () => {
    expect(valueAxis([month("2026-10", 0, { carried_in_cents: 500_000 })])).toBeUndefined();
  });
});
