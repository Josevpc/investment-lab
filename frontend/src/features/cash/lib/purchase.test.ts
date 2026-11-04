import { describe, expect, it } from "vitest";
import { purchaseProblem, purchaseShortfall } from "./purchase";

const asset = { name: "HGLG11", valuation_date: "2026-10-05" };
const base = { asset, cents: 1_000, date: "2026-10-20", today: "2026-10-20", openingDate: "2026-10-01", balanceCents: 5_000, depositShortfall: false };

describe("compra com o caixa", () => {
  it("calcula quanto falta no caixa", () => {
    expect(purchaseShortfall(7_000, 5_000)).toBe(2_000);
    expect(purchaseShortfall(5_000, 5_000)).toBe(0);
    expect(purchaseShortfall(null, 5_000)).toBe(0);
  });

  it("aceita uma compra que cabe no caixa", () => {
    expect(purchaseProblem(base)).toBeNull();
  });

  it("pede o ativo, o valor e uma data válida", () => {
    expect(purchaseProblem({ ...base, asset: undefined })).toBe("Escolha o ativo comprado.");
    expect(purchaseProblem({ ...base, cents: null })).toBe("Informe um valor maior que zero.");
    expect(purchaseProblem({ ...base, date: "2026-10-21" })).toBe("A data não pode ser no futuro.");
    expect(purchaseProblem({ ...base, date: "2026-09-30" })).toContain("quando o caixa foi ativado");
    expect(purchaseProblem({ ...base, date: "2026-10-04" })).toContain("último saldo registrado de HGLG11");
  });

  it("caixa insuficiente só passa com o depósito da diferença marcado", () => {
    expect(purchaseProblem({ ...base, cents: 7_000 })).toContain("não cobre a compra");
    expect(purchaseProblem({ ...base, cents: 7_000, depositShortfall: true })).toBeNull();
  });
});
