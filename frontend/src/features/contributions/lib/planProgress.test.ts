import { describe, expect, it } from "vitest";
import type { Contribution } from "../types";
import { executedFromSummary, planProgress } from "./planProgress";

const contribution: Contribution = {
  id: 1,
  month: "2026-11",
  salary_cents: 180_000,
  percent_bps: 500,
  calculated_cents: 9_000,
  final_cents: 9_000,
  overridden: false,
  reserve_cents: 2_000,
  mode: "rebalance",
  plan_name: "Plano padrão",
  plan: [
    { class_key: "renda_fixa", class_name: "Renda Fixa", color: "#5aa88a", amount_cents: 0 },
    { class_key: "renda_variavel", class_name: "Renda Variável", color: "#5b8fd9", amount_cents: 4_000 },
    { class_key: "cripto", class_name: "Cripto", color: "#e5a05a", amount_cents: 3_000 },
  ],
  created_at: null,
};

const executed = (byClass: Record<string, number>, reserveCents = 0) => ({
  byClass: Object.entries(byClass).map(([class_key, amount_cents]) => ({ class_key, amount_cents })),
  reserveCents,
});

describe("planProgress", () => {
  it("sem nenhum aporte, tudo o que foi planejado falta", () => {
    const p = planProgress(contribution, executed({}));
    expect(p.plannedCents).toBe(9_000);
    expect(p.doneCents).toBe(0);
    expect(p.remainingCents).toBe(9_000);
    expect(p.complete).toBe(false);
  });

  it("mostra quanto falta em cada categoria e o andamento", () => {
    const p = planProgress(contribution, executed({ renda_variavel: 1_000, cripto: 3_000 }, 500));
    expect(p.rows.find((r) => r.key === "renda_variavel")).toMatchObject({
      plannedCents: 4_000,
      doneCents: 1_000,
      remainingCents: 3_000,
      progressBps: 2_500,
    });
    expect(p.rows.find((r) => r.key === "cripto")).toMatchObject({ remainingCents: 0, progressBps: 10_000 });
    expect(p.rows.find((r) => r.key === "reserva")).toMatchObject({ plannedCents: 2_000, doneCents: 500, remainingCents: 1_500 });
    expect(p.remainingCents).toBe(3_000 + 1_500);
  });

  it("aporte acima do planejado não abate a falta de outra categoria", () => {
    const p = planProgress(contribution, executed({ renda_fixa: 700, renda_variavel: 1_000 }));
    expect(p.rows.find((r) => r.key === "renda_fixa")).toMatchObject({ plannedCents: 0, overCents: 700, progressBps: null });
    expect(p.remainingCents).toBe(3_000 + 3_000 + 2_000); // renda variável, cripto e reserva
  });

  it("fica completo quando tudo foi aportado", () => {
    const p = planProgress(contribution, executed({ renda_variavel: 4_000, cripto: 3_000 }, 2_000));
    expect(p.complete).toBe(true);
    expect(p.remainingCents).toBe(0);
  });

  it("não cria linha de reserva quando não há reserva planejada nem aportada", () => {
    const p = planProgress({ ...contribution, reserve_cents: 0 }, executed({}));
    expect(p.rows.some((r) => r.isReserve)).toBe(false);
  });

  it("marca como mantida a categoria que o back-end diz estar toda mantida, sem deduzir pelo valor planejado", () => {
    const p = planProgress(contribution, executed({}), { renda_fixa: "none", renda_variavel: "partial", cripto: "all" });
    // Renda fixa ficou sem aporte previsto, mas não está mantida: não vira mantida só por isso.
    expect(p.rows.find((r) => r.key === "renda_fixa")?.held).toBe(false);
    expect(p.rows.find((r) => r.key === "renda_variavel")?.held).toBe(false);
    expect(p.rows.find((r) => r.key === "cripto")?.held).toBe(true);
    // Cripto (R$ 30) está toda mantida hoje: não entra no que falta nem no planejado.
    expect(p.rows.find((r) => r.key === "cripto")).toMatchObject({ plannedCents: 3_000, remainingCents: 0 });
    expect(p.plannedCents).toBe(6_000);
    expect(p.remainingCents).toBe(6_000);
  });

  it("categoria toda mantida não impede o plano cumprido", () => {
    const p = planProgress(contribution, executed({ renda_variavel: 4_000 }, 2_000), { cripto: "all" });
    expect(p.remainingCents).toBe(0);
    expect(p.complete).toBe(true);
  });

  it("sem a situação do back-end, ninguém é mantido", () => {
    expect(planProgress(contribution, executed({})).rows.some((r) => r.held)).toBe(false);
  });

  describe("aporte fora da meta do mês", () => {
    // R$ 20 aportados na reserva, todos marcados como fora da meta: o resumo do mês traz o total, mas a parte da meta é zero.
    const summary = {
      by_class: [
        { class_key: "renda_variavel", class_name: "Renda Variável", color: "#000", amount_cents: 4_000, goal_cents: 4_000 },
        { class_key: "cripto", class_name: "Cripto", color: "#000", amount_cents: 3_000, goal_cents: 3_000 },
      ],
      reserve_goal_cents: 0,
      off_goal_cents: 2_000,
    };

    it("usa só a parte que conta na meta (goal_cents e reserve_goal_cents)", () => {
      const withOff = { ...summary, by_class: [{ ...summary.by_class[0], amount_cents: 5_000, goal_cents: 1_000 }] };
      expect(executedFromSummary(withOff)).toEqual({
        byClass: [{ class_key: "renda_variavel", amount_cents: 1_000, reserved_cents: 0, from_reserved_cents: 0 }],
        reserveCents: 0,
        offGoalCents: 2_000,
      });
    });

    it("a reserva aportada fora da meta não vira cumprida nem gera extra", () => {
      const p = planProgress(contribution, executedFromSummary(summary));
      expect(p.rows.find((r) => r.key === "reserva")).toMatchObject({ plannedCents: 2_000, doneCents: 0, remainingCents: 2_000, overCents: 0 });
      expect(p.complete).toBe(false);
      expect(p.remainingCents).toBe(2_000);
      expect(p.doneCents).toBe(7_000);
      expect(p.doneCents - p.plannedCents).toBeLessThanOrEqual(0); // nenhum "Extra do mês"
    });

    it("categoria aportada além do planejado só passa do plano com a parte que conta", () => {
      const p = planProgress(
        contribution,
        executedFromSummary({
          by_class: [{ class_key: "cripto", class_name: "Cripto", color: "#000", amount_cents: 8_000, goal_cents: 3_000 }],
          reserve_goal_cents: 2_000,
          off_goal_cents: 5_000,
        }),
      );
      expect(p.rows.find((r) => r.key === "cripto")).toMatchObject({ doneCents: 3_000, remainingCents: 0, overCents: 0 });
    });
  });
  describe("dinheiro separado para comprar", () => {
    // O exemplo do plano: em outubro R$ 40 ficaram separados para Renda Variável (meta R$ 40);
    // em novembro a compra de R$ 100 usou esse separado: R$ 60 saíram do caixa livre.
    const summary = (by_class: Record<string, unknown>[]) => ({
      by_class: by_class as never,
      reserve_goal_cents: 0,
      off_goal_cents: 0,
    });
    const base = { class_name: "Renda Variável", color: "#000" };

    it("o separado do mês conta como feito e aparece à parte do comprado", () => {
      const p = planProgress(
        { ...contribution, reserve_cents: 0, plan: [{ class_key: "renda_variavel", class_name: "Renda Variável", color: "#000", amount_cents: 4_000 }] },
        executedFromSummary(summary([{ ...base, class_key: "renda_variavel", amount_cents: 4_000, goal_cents: 4_000, reserved_cents: 4_000, from_reserved_cents: 0 }])),
      );
      expect(p.rows[0]).toMatchObject({
        doneCents: 4_000,
        boughtCents: 0,
        separatedCents: 4_000,
        fulfilled: true,
        remainingCents: 0,
        boughtBps: 0,
        separatedBps: 10_000,
      });
      expect(p.separatedCents).toBe(4_000);
      expect(p.complete).toBe(true);
    });

    it("no mês da compra, o separado de antes não soma ao feito: só informa", () => {
      const p = planProgress(
        { ...contribution, reserve_cents: 0, plan: [{ class_key: "renda_variavel", class_name: "Renda Variável", color: "#000", amount_cents: 6_000 }] },
        executedFromSummary(summary([{ ...base, class_key: "renda_variavel", amount_cents: 6_000, goal_cents: 6_000, reserved_cents: 0, from_reserved_cents: 4_000 }])),
      );
      expect(p.rows[0]).toMatchObject({ doneCents: 6_000, boughtCents: 6_000, separatedCents: 0, fromReservedCents: 4_000, fulfilled: true });
    });

    it("comprado + separado abaixo do planejado não é cumprido e os dois trechos cabem na barra", () => {
      const p = planProgress(
        { ...contribution, reserve_cents: 0, plan: [{ class_key: "renda_variavel", class_name: "Renda Variável", color: "#000", amount_cents: 10_000 }] },
        executedFromSummary(summary([{ ...base, class_key: "renda_variavel", amount_cents: 7_000, goal_cents: 7_000, reserved_cents: 4_000 }])),
      );
      expect(p.rows[0]).toMatchObject({ boughtCents: 3_000, separatedCents: 4_000, fulfilled: false, remainingCents: 3_000, boughtBps: 3_000, separatedBps: 4_000 });
    });

    it("passou do planejado: a barra reparte o feito entre comprado e separado, para o hachurado não sumir", () => {
      const p = planProgress(
        { ...contribution, reserve_cents: 0, plan: [{ class_key: "renda_variavel", class_name: "Renda Variável", color: "#000", amount_cents: 1_000 }] },
        executedFromSummary(summary([{ ...base, class_key: "renda_variavel", amount_cents: 4_000, goal_cents: 4_000, reserved_cents: 1_000 }])),
      );
      expect(p.rows[0]).toMatchObject({ progressBps: 10_000, overCents: 3_000, boughtBps: 7_500, separatedBps: 2_500 });
    });

    it("sem as chaves novas (API antiga), tudo é comprado", () => {
      const p = planProgress(contribution, executed({ renda_variavel: 1_000 }));
      expect(p.rows.find((r) => r.key === "renda_variavel")).toMatchObject({ boughtCents: 1_000, separatedCents: 0, fromReservedCents: 0 });
    });
  });
});
