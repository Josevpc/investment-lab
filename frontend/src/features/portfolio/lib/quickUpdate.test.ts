import { describe, expect, it } from "vitest";
import type { Asset } from "../types";
import {
  daysSince,
  evaluateRow,
  groupByInstitution,
  isStale,
  periodResult,
  totalResult,
  updatedLabel,
  type Draft,
} from "./quickUpdate";

const asset = (extra: Partial<Asset> = {}) =>
  ({
    id: 1,
    name: "CDB",
    institution_id: 1,
    institution_name: "Banco",
    class_name: "Renda Fixa",
    quantity: null,
    invested_cents: 100_000,
    current_cents: 110_000,
    valuation_date: "2026-10-17",
    ...extra,
  }) as Asset;

const draft = (extra: Partial<Draft> = {}): Draft => ({ balance: "", quote: "", contribution: "", contributionDate: "", ...extra });

describe("groupByInstitution", () => {
  it("junta os ativos de cada instituição, com as instituições e os ativos em ordem alfabética", () => {
    const groups = groupByInstitution([
      asset({ id: 1, name: "Cripto", institution_id: 2, institution_name: "Zeta" }),
      asset({ id: 2, name: "Tesouro", institution_id: 1, institution_name: "Alfa" }),
      asset({ id: 3, name: "CDB", institution_id: 2, institution_name: "Zeta" }),
    ]);
    expect(groups.map((g) => [g.name, g.assets.map((a) => a.name)])).toEqual([
      ["Alfa", ["Tesouro"]],
      ["Zeta", ["CDB", "Cripto"]],
    ]);
  });

  it("sem ativos, não há grupos", () => {
    expect(groupByInstitution([])).toEqual([]);
  });
});

describe("daysSince e updatedLabel", () => {
  it("conta dias de calendário, inclusive na virada de mês e de ano", () => {
    expect(daysSince("2026-10-17", "2026-10-24")).toBe(7);
    expect(daysSince("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysSince("2026-02-27", "2026-03-01")).toBe(2);
  });

  it("nunca dá negativo (saldo com data de hoje ou futura)", () => {
    expect(daysSince("2026-10-24", "2026-10-24")).toBe(0);
    expect(daysSince("2026-10-30", "2026-10-24")).toBe(0);
  });

  it("escreve a idade do saldo em português", () => {
    expect(updatedLabel(0)).toBe("atualizado hoje");
    expect(updatedLabel(1)).toBe("atualizado ontem");
    expect(updatedLabel(9)).toBe("atualizado há 9 dias");
  });

  it("só passa a ser considerado velho depois de uma semana", () => {
    expect(isStale(7)).toBe(false);
    expect(isStale(8)).toBe(true);
  });
});

describe("periodResult", () => {
  it("o rendimento desconta o aporte e a variação é sobre o saldo anterior", () => {
    // R$ 1.000,00 viram R$ 1.512,00 com R$ 500,00 de aporte: rendeu R$ 12,00 (1,2%).
    expect(periodResult(100_000, 151_200, 50_000)).toEqual({ gainCents: 1_200, returnBps: 120 });
  });

  it("arredonda meio para cima e aceita queda", () => {
    expect(periodResult(30_000, 30_005, 0).returnBps).toBe(2); // 1,67 pb -> 2
    expect(periodResult(10_000, 9_995, 0)).toEqual({ gainCents: -5, returnBps: -5 }); // -5 pb exato
    expect(periodResult(20_000, 19_999, 0).returnBps).toBe(0); // -0,5 pb: meio para cima -> 0
  });

  it("sem saldo anterior não há variação a medir", () => {
    expect(periodResult(0, 5_000, 0)).toEqual({ gainCents: 5_000, returnBps: null });
  });
});

describe("evaluateRow", () => {
  const date = "2026-10-24";

  it("campo em branco e sem aporte: o ativo fica como está", () => {
    expect(evaluateRow(asset(), draft(), date)).toEqual({ kind: "skip" });
  });

  it("o mesmo saldo de antes também não conta como mudança", () => {
    expect(evaluateRow(asset(), draft({ balance: "1.100,00" }), date)).toEqual({ kind: "skip" });
  });

  it("saldo novo: pronto, com o resultado desde a última atualização", () => {
    const row = evaluateRow(asset(), draft({ balance: "1.111,00" }), date);
    expect(row.kind).toBe("ready");
    if (row.kind !== "ready") return;
    expect(row.preview.balanceCents).toBe(111_100);
    expect(row.result).toEqual({ gainCents: 1_100, returnBps: 100 });
  });

  it("com aporte: o saldo é o do extrato, já com o aporte, e o aporte sai do rendimento", () => {
    const row = evaluateRow(asset(), draft({ balance: "1.612,00", contribution: "500" }), date);
    expect(row.kind).toBe("ready");
    if (row.kind !== "ready") return;
    expect(row.preview.contributionCents).toBe(50_000);
    expect(row.result.gainCents).toBe(1_200);
  });

  it("aporte sem saldo: pede o saldo em vez de adivinhar", () => {
    expect(evaluateRow(asset(), draft({ contribution: "500" }), date)).toEqual({
      kind: "invalid",
      message: "Informe o saldo atual, já com o aporte.",
    });
  });

  it("valor que não é número é inválido", () => {
    expect(evaluateRow(asset(), draft({ balance: "abc" }), date)).toEqual({ kind: "invalid", message: "Valor inválido." });
    expect(evaluateRow(asset(), draft({ balance: "1.200", contribution: "x" }), date)).toEqual({
      kind: "invalid",
      message: "Valor inválido.",
    });
  });

  it("o aporte não pode ser depois do dia do saldo", () => {
    expect(evaluateRow(asset(), draft({ balance: "1.612", contribution: "500", contributionDate: "2026-10-25" }), date)).toEqual({
      kind: "invalid",
      message: "O dia do aporte não pode ser depois do dia do saldo.",
    });
  });

  it("com quantidade, a cotação preenche o saldo (mesmo que o campo de saldo esteja vazio)", () => {
    const fii = asset({ quantity: "45", current_cents: 27_675, invested_cents: 27_000 });
    const row = evaluateRow(fii, draft({ quote: "6,40" }), date);
    expect(row.kind).toBe("ready");
    if (row.kind !== "ready") return;
    expect(row.preview.balanceCents).toBe(28_800); // 45 x R$ 6,40
    expect(row.result.gainCents).toBe(1_125);
  });

  it("cotação inválida é inválida, não é ignorada", () => {
    const fii = asset({ quantity: "45" });
    expect(evaluateRow(fii, draft({ quote: "abc" }), date)).toEqual({ kind: "invalid", message: "Cotação inválida." });
  });
});

describe("totalResult", () => {
  it("soma o rendimento e mede sobre a soma dos saldos anteriores", () => {
    const total = totalResult([
      { previousCents: 100_000, gainCents: 1_200 },
      { previousCents: 300_000, gainCents: -600 },
    ]);
    expect(total).toEqual({ gainCents: 600, returnBps: 15, previousCents: 400_000 }); // 0,15%
  });

  it("ativo sem saldo anterior entra no rendimento, mas não na base da variação", () => {
    const total = totalResult([
      { previousCents: 0, gainCents: 5_000 },
      { previousCents: 100_000, gainCents: 1_000 },
    ]);
    expect(total).toEqual({ gainCents: 6_000, returnBps: 100, previousCents: 100_000 });
  });

  it("sem nenhum item, não há total", () => {
    expect(totalResult([])).toBeNull();
  });
});
