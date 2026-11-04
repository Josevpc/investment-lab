import { describe, expect, it } from "vitest";
import { defaultReserveCents } from "./defaultAmount";

const base = { monthly_mode: "fixed", percent_bps: 0, monthly_cents: 20_000, goal_cents: 5_400_000, reached: false, remaining_cents: 1_000_000 } as const;

describe("defaultReserveCents", () => {
  it("modo fixo sugere o valor mensal configurado", () => {
    expect(defaultReserveCents(base, 90_000)).toBe(20_000);
  });

  it("modo percentual usa a parte do aporte do mês", () => {
    expect(defaultReserveCents({ ...base, monthly_mode: "percent", percent_bps: 2_000 }, 90_000)).toBe(18_000); // 20% de R$ 900,00
  });

  it("arredonda meio para cima ao calcular o percentual", () => {
    expect(defaultReserveCents({ ...base, monthly_mode: "percent", percent_bps: 750 }, 1_001)).toBe(75); // 75,075
    expect(defaultReserveCents({ ...base, monthly_mode: "percent", percent_bps: 1_000 }, 1_005)).toBe(101); // 100,5
  });

  it("nunca passa do que falta para a meta", () => {
    expect(defaultReserveCents({ ...base, monthly_mode: "percent", percent_bps: 5_000, remaining_cents: 3_000 }, 90_000)).toBe(3_000);
  });

  it("meta atingida sugere zero; sem meta vale o desejado", () => {
    expect(defaultReserveCents({ ...base, reached: true, remaining_cents: 0 }, 90_000)).toBe(0);
    expect(defaultReserveCents({ ...base, goal_cents: 0, remaining_cents: 0 }, 90_000)).toBe(20_000);
  });
});
