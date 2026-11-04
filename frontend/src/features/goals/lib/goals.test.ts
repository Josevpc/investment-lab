import { describe, expect, it } from "vitest";
import type { GoalsProgress, Projection, Streak } from "../types";
import { closingCelebration, goalSentence, monthsBetween, projectionRows, streakHeadline, timeUntil } from "./goals";

const streak = (patch: Partial<Streak>): Streak => ({ current: 0, best: 0, current_month_met: false, months: [], ...patch });

describe("tempo até a meta", () => {
  it("conta meses entre dois AAAA-MM, atravessando anos", () => {
    expect(monthsBetween("2026-10", "2027-05")).toBe(7);
    expect(monthsBetween("2026-10", "2026-10")).toBe(0);
    expect(monthsBetween("2026-10", "2026-08")).toBe(-2);
  });

  it("escreve anos e meses no singular e no plural", () => {
    expect(timeUntil(0)).toBe("este mês");
    expect(timeUntil(1)).toBe("daqui a 1 mês");
    expect(timeUntil(12)).toBe("daqui a 1 ano");
    expect(timeUntil(79)).toBe("daqui a 6 anos e 7 meses");
  });

  it("diz quando chega à meta ou que não chega no horizonte", () => {
    expect(goalSentence("2027-05", "2026-10", 20)).toBe("Chega à meta em mai/2027 (daqui a 7 meses), em valores de hoje");
    expect(goalSentence(null, "2026-10", 20)).toBe("Não chega à meta em 20 anos, em valores de hoje");
  });

  it("numa API antiga, sem a base da meta, a frase diz que a conta é nominal", () => {
    expect(goalSentence("2027-05", "2026-10", 20, "nominal")).toBe("Chega à meta em mai/2027 (daqui a 7 meses), em valor nominal");
  });
});

describe("sequência", () => {
  it("convida a começar quando não há sequência", () => {
    const h = streakHeadline(streak({}), "2026-10");
    expect(h.title).toBe("Comece sua sequência");
    expect(h.text).toContain("outubro");
  });

  it("mostra o mês cumprido e o recorde", () => {
    const h = streakHeadline(streak({ current: 3, best: 5, current_month_met: true }), "2026-10");
    expect(h.title).toBe("3 meses seguidos");
    expect(h.text).toContain("Outubro cumprido");
    expect(h.text).toContain("recorde é de 5 meses");
  });

  it("diz que o recorde é o atual quando coincidem", () => {
    const h = streakHeadline(streak({ current: 1, best: 1, current_month_met: true }), "2026-10");
    expect(h.title).toBe("1 mês seguido");
    expect(h.text).toContain("É o seu recorde");
  });

  it("com o mês corrente em aberto, diz o que falta para a sequência crescer", () => {
    const h = streakHeadline(streak({ current: 3, best: 3 }), "2026-10");
    expect(h.title).toBe("3 meses seguidos");
    expect(h.text).toContain("chegar a 4 meses");
  });
});

describe("comemoração do fechamento", () => {
  const progress = (s: Streak) => ({ streak: s }) as GoalsProgress;

  it("celebra o mês cumprido com a sequência", () => {
    const c = closingCelebration(progress(streak({ current: 4, best: 4, current_month_met: true })));
    expect(c.highlight).toBe("Sequência de 4 meses (recorde!)");
  });

  it("não chama de recorde a primeira vez", () => {
    const c = closingCelebration(progress(streak({ current: 1, best: 1, current_month_met: true })));
    expect(c.highlight).toBe("Sequência de 1 mês");
  });

  it("avisa, sem punir, quando o aporte do mês ficou incompleto", () => {
    const c = closingCelebration(progress(streak({ current: 2, best: 2, current_month_met: false })));
    expect(c.text).toContain("segue aberta");
    expect(c.highlight).toBe("Sequência atual: 2 meses");
  });
});

describe("projeção", () => {
  const scenario = (key: "conservador" | "base" | "otimista", factor: number) => ({
    key,
    name: key,
    annual_bps: 0,
    final_nominal_cents: 0,
    final_today_cents: 0,
    goal_month: null,
    points: [
      { month: "2026-10", nominal_cents: 100, today_cents: 100 },
      { month: "2027-10", nominal_cents: 200 * factor, today_cents: 190 * factor },
    ],
  });
  const projection = {
    scenarios: [scenario("conservador", 1), scenario("base", 2), scenario("otimista", 3)],
  } as unknown as Projection;

  it("monta uma linha por ano com os três cenários", () => {
    expect(projectionRows(projection, "nominal")[1]).toEqual({ month: "2027-10", conservador: 200, base: 400, otimista: 600 });
  });

  it("troca para valores de hoje sem mudar as datas", () => {
    expect(projectionRows(projection, "today")[1]).toEqual({ month: "2027-10", conservador: 190, base: 380, otimista: 570 });
  });
});
