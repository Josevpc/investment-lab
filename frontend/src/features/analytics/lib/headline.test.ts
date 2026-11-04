import { describe, expect, it } from "vitest";
import type { Trajectory } from "../types";
import { formatDuration, formatGap, monthAfter, trajectoryHeadline } from "./headline";

const base: Trajectory = {
  plan_id: 1,
  plan_name: "Plano",
  mode: "rebalance",
  months: 24,
  monthly_contribution_cents: 100_000,
  contribution_source: "informed",
  tolerance_bps: 100,
  months_to_target: null,
  start_gap_bps: 4000,
  end_gap_bps: 1500,
  all_held: false,
  classes: [],
  points: [],
};

const now = new Date(2026, 9, 15); // out/2026

describe("monthAfter", () => {
  it("avança meses atravessando o ano", () => {
    expect(monthAfter(0, now)).toBe("2026-10");
    expect(monthAfter(3, now)).toBe("2027-01");
    expect(monthAfter(14, now)).toBe("2027-12");
  });
});

describe("formatDuration", () => {
  it("fala em meses e anos", () => {
    expect(formatDuration(1)).toBe("1 mês");
    expect(formatDuration(8)).toBe("8 meses");
    expect(formatDuration(12)).toBe("1 ano");
    expect(formatDuration(30)).toBe("2 anos e 6 meses");
  });
});

describe("trajectoryHeadline", () => {
  it("avisa quando já está na meta", () => {
    expect(trajectoryHeadline({ ...base, months_to_target: 0 }, now)).toContain("já está dentro de 1 p.p.");
  });

  it("informa em quanto tempo chega à meta", () => {
    const text = trajectoryHeadline({ ...base, months_to_target: 9 }, now);
    expect(text).toContain("9 meses");
    expect(text).toContain("jul/2027");
  });

  it("com categoria mantida, fala só das que recebem aportes", () => {
    const classes: Trajectory["classes"] = [
      { key: "rf", name: "Renda fixa", color: "#000", target_bps: 7_000, effective_target_bps: 10_000, hold_status: "none" },
      { key: "cripto", name: "Cripto", color: "#111", target_bps: 3_000, effective_target_bps: 0, hold_status: "all" },
    ];
    expect(trajectoryHeadline({ ...base, classes, months_to_target: 9 }, now)).toContain(
      "toda categoria que recebe aportes fica a até 1 p.p. da meta ajustada",
    );
  });

  it("com categoria toda mantida, fala da meta ajustada também quando não chega", () => {
    const classes: Trajectory["classes"] = [
      { key: "rf", name: "Renda fixa", color: "#000", target_bps: 7_000, effective_target_bps: 10_000, hold_status: "none" },
      { key: "rv", name: "Renda variável", color: "#111", target_bps: 3_000, effective_target_bps: 0, hold_status: "all" },
    ];
    expect(trajectoryHeadline({ ...base, classes }, now)).toContain("ainda não chega à meta ajustada");
    expect(trajectoryHeadline({ ...base, classes, months_to_target: 0 }, now)).toContain("de cada meta ajustada");
  });

  it("com tudo mantido, diz que a simulação não tem aportes", () => {
    expect(trajectoryHeadline({ ...base, all_held: true, monthly_contribution_cents: 0 }, now)).toBe(
      'Todos os ativos estão em "Manter posição": a simulação fica sem aportes e a carteira não muda de composição.',
    );
  });

  it("o desvio na frase usa uma casa, como os cartões", () => {
    expect(trajectoryHeadline({ ...base, start_gap_bps: 4156, end_gap_bps: 3620 }, now)).toContain("de 41,6 p.p. para 36,2 p.p.");
    expect(formatGap(4156)).toBe("41,6 p.p.");
  });

  it("explica quando não chega e quando não há aporte", () => {
    expect(trajectoryHeadline(base, now)).toContain("ainda não chega");
    expect(trajectoryHeadline({ ...base, monthly_contribution_cents: 0 }, now)).toContain("Sem aportes");
  });
});
