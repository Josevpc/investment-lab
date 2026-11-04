import { describe, expect, it } from "vitest";
import { closingSteps } from "./monthClosing";

const base = {
  month: "2026-10",
  hasContribution: false,
  assets: [{ valuation_date: "2026-09-30" }, { valuation_date: "2026-09-30" }],
  reviewed: false,
  hasSnapshot: false,
};

const states = (input: Parameters<typeof closingSteps>[0]) => closingSteps(input).map((s) => s.state);

describe("closingSteps", () => {
  it("começa pelo aporte e deixa o resto pendente", () => {
    expect(states(base)).toEqual(["current", "pending", "pending", "pending", "pending"]);
  });

  it("avança para os saldos depois do aporte", () => {
    expect(states({ ...base, hasContribution: true })).toEqual(["done", "current", "pending", "pending", "pending"]);
  });

  it("só considera os saldos atualizados quando todos os ativos têm posição do mês", () => {
    const partial = { ...base, hasContribution: true, assets: [{ valuation_date: "2026-10-05" }, { valuation_date: "2026-09-30" }] };
    expect(states(partial)[1]).toBe("current");
    const complete = { ...partial, assets: [{ valuation_date: "2026-10-05" }, { valuation_date: "2026-10-20" }] };
    expect(states(complete)).toEqual(["done", "done", "current", "pending", "pending"]);
  });

  it("aceita a confirmação de que os saldos sem mudança continuam corretos", () => {
    const input = { ...base, hasContribution: true, balancesConfirmed: true };
    expect(states(input)).toEqual(["done", "done", "current", "pending", "pending"]);
  });

  it("sem ativos os saldos não estão concluídos", () => {
    expect(states({ ...base, hasContribution: true, assets: [] })[1]).toBe("current");
  });

  it("depois da conferência, o registro é a etapa atual", () => {
    const input = { ...base, hasContribution: true, assets: [{ valuation_date: "2026-10-31" }], reviewed: true };
    expect(states(input)).toEqual(["done", "done", "done", "current", "pending"]);
  });

  it("com o snapshot registrado, tudo está concluído", () => {
    const input = { ...base, hasContribution: true, assets: [{ valuation_date: "2026-10-31" }], hasSnapshot: true };
    expect(states(input)).toEqual(["done", "done", "done", "done", "done"]);
  });
});
