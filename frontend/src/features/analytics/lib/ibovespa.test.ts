import { describe, expect, it } from "vitest";
import { ibovespaByDefault, ibovespaGap, ibovespaGapMessage } from "./ibovespa";

describe("ibovespaGap", () => {
  it("não acusa nada quando todas as linhas têm Ibovespa", () => {
    expect(ibovespaGap([{ ibovespa_bps: 120, ibovespa_covered_through: "2026-10-16" }])).toBeNull();
    expect(ibovespaGap([])).toBeNull();
  });

  it("nunca baixado: nenhuma linha tem data de cobertura", () => {
    const gap = ibovespaGap([{ ibovespa_bps: null, ibovespa_covered_through: null }]);
    expect(gap).toEqual({ kind: "missing" });
    expect(ibovespaGapMessage(gap!)).toBe(
      "Ainda não há dados do Ibovespa. Atualize os índices em Configurações → Dados e proteção.",
    );
  });

  it("parcial: diz até que dia o índice vai (a data mais recente entre as linhas)", () => {
    const gap = ibovespaGap([
      { ibovespa_bps: 300, ibovespa_covered_through: "2026-09-30" },
      { ibovespa_bps: null, ibovespa_covered_through: "2026-09-30" },
      { ibovespa_bps: null, ibovespa_covered_through: null },
    ]);
    expect(gap).toEqual({ kind: "partial", through: "2026-09-30" });
    expect(ibovespaGapMessage(gap!)).toBe("O Ibovespa só vai até 30/09/2026; atualize os índices.");
  });
});

describe("ibovespaByDefault", () => {
  it("liga para categorias de bolsa e desliga para carteira total e renda fixa", () => {
    expect(ibovespaByDefault("total")).toBe(false);
    expect(ibovespaByDefault("renda_fixa")).toBe(false);
    expect(ibovespaByDefault("renda_variavel")).toBe(true);
    expect(ibovespaByDefault("cripto")).toBe(true);
  });

  it("num grupo, liga se alguma categoria dele não é renda fixa", () => {
    expect(ibovespaByDefault("group:3", ["fii", "acoes"])).toBe(true);
    expect(ibovespaByDefault("group:3", ["renda_fixa"])).toBe(false);
    expect(ibovespaByDefault("group:3")).toBe(false);
  });
});
