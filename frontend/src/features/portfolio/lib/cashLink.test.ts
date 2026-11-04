import { describe, expect, it } from "vitest";
import { cashLink, cashUseProblem } from "./cashLink";

const xp = { id: 5, name: "XP", archived: false, cash_enabled: true, opening_date: "2026-10-01", balance_cents: 50_000 };

describe("aporte e caixa da conta", () => {
  it("só entra no caixa com o caixa ativado, conta ativa e dia a partir do saldo inicial", () => {
    expect(cashLink(5, [xp], "2026-10-20").kind).toBe("ledger");
    expect(cashLink(5, [xp], "2026-09-30").kind).toBe("before");
    expect(cashLink(5, [{ ...xp, cash_enabled: false, opening_date: null }], "2026-10-20").kind).toBe("none");
    expect(cashLink(5, [{ ...xp, archived: true }], "2026-10-20").kind).toBe("none");
    expect(cashLink(null, [xp], "2026-10-20").kind).toBe("none");
    expect(cashLink(9, [xp], "2026-10-20").kind).toBe("none");
  });

  it("usar o caixa precisa caber no caixa de hoje", () => {
    expect(cashUseProblem("XP", 50_000, 50_000)).toBeNull();
    expect(cashUseProblem("XP", 50_001, 50_000)).toContain("não cobre o aporte");
  });
});
