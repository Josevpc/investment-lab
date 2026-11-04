import { describe, expect, it } from "vitest";
import type { Streak } from "../types";
import { addMonths, milestoneStatus, monthsLeftInYear, streakRange, yearFraction } from "./progress";

const streak = (patch: Partial<Streak>): Streak => ({ current: 0, best: 0, current_month_met: false, months: [], ...patch });

describe("addMonths", () => {
  it("anda para frente e para trás, atravessando anos", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-05", -5)).toBe("2025-12");
  });
});

describe("streakRange", () => {
  it("com o mês em dia, a sequência termina nele", () => {
    expect(streakRange(streak({ current: 3, current_month_met: true }), "2026-11")).toEqual({ start: "2026-09", end: "2026-11" });
  });

  it("com o mês ainda aberto, termina no mês anterior", () => {
    expect(streakRange(streak({ current: 6 }), "2026-11")).toEqual({ start: "2026-05", end: "2026-10" });
  });

  it("não há faixa sem sequência", () => {
    expect(streakRange(streak({ current: 0 }), "2026-11")).toBeNull();
  });
});

describe("milestoneStatus", () => {
  it("lista os marcos alcançados e quanto falta para o próximo, arredondando para cima", () => {
    // Meta de R$ 300.000,00; patrimônio de R$ 202.260,13 = 67,42%.
    const s = milestoneStatus(6_742, 20_226_013, 30_000_000);
    expect(s.reached).toEqual([25, 50]);
    expect(s.next).toEqual({ percent: 75, remainingCents: 22_500_000 - 20_226_013 });
  });

  it("antes do primeiro marco, nenhum alcançado", () => {
    const s = milestoneStatus(1_000, 100, 1_001);
    expect(s.reached).toEqual([]);
    expect(s.next).toEqual({ percent: 25, remainingCents: 151 }); // 250,25 centavos sobe para 251
  });

  it("com a meta cumprida, não há próximo marco", () => {
    const s = milestoneStatus(10_000, 30_000_000, 30_000_000);
    expect(s.reached).toEqual([25, 50, 75, 100]);
    expect(s.next).toBeNull();
  });

  it("sem meta, não há marcos", () => {
    expect(milestoneStatus(0, 500, 0)).toEqual({ reached: [], next: null });
  });
});

describe("monthsLeftInYear", () => {
  it("conta o mês atual, que ainda pode receber aporte", () => {
    expect(monthsLeftInYear("2026-11")).toBe(2);
    expect(monthsLeftInYear("2026-12")).toBe(1);
    expect(monthsLeftInYear("2026-01")).toBe(12);
  });
});

describe("yearFraction", () => {
  it("põe o mês no eixo do tempo como ano com fração", () => {
    expect(yearFraction("2026-01")).toBe(2026);
    expect(yearFraction("2026-07")).toBeCloseTo(2026.5, 5);
  });
});
