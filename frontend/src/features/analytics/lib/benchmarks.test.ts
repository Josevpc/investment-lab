import { describe, expect, it } from "vitest";
import { benchmarkGap, benchmarkGapMessage, ibovespaByDefault, usdByDefault } from "./benchmarks";

describe("benchmarkGap", () => {
  it("não acusa nada quando todas as linhas têm a referência", () => {
    expect(benchmarkGap([{ bps: 120, through: "2026-10-16" }])).toBeNull();
    expect(benchmarkGap([])).toBeNull();
  });

  it("nunca baixado: nenhuma linha tem data de cobertura", () => {
    const gap = benchmarkGap([{ bps: null, through: null }]);
    expect(gap).toEqual({ kind: "missing" });
    expect(benchmarkGapMessage("ibovespa", gap!)).toBe(
      "Ainda não há dados do Ibovespa. Atualize os índices em Configurações → Dados e proteção.",
    );
    expect(benchmarkGapMessage("usd", gap!)).toBe(
      "Ainda não há dados do dólar. Atualize os índices em Configurações → Dados e proteção.",
    );
    expect(benchmarkGapMessage("ipca", gap!)).toBe(
      "Ainda não há dados do IPCA. Atualize os índices em Configurações → Dados e proteção.",
    );
  });

  it("parcial: diz até onde a referência vai (a data mais recente entre as linhas)", () => {
    const gap = benchmarkGap([
      { bps: 300, through: "2026-09-30" },
      { bps: null, through: "2026-09-30" },
      { bps: null, through: null },
    ]);
    expect(gap).toEqual({ kind: "partial", through: "2026-09-30" });
    expect(benchmarkGapMessage("ibovespa", gap!)).toBe("O Ibovespa só vai até 30/09/2026; atualize os índices.");
    expect(benchmarkGapMessage("usd", gap!)).toBe("O dólar só vai até 30/09/2026; atualize os índices.");
  });

  it("IPCA parcial: a cobertura é mensal e a mensagem explica o atraso", () => {
    const gap = benchmarkGap([{ bps: null, through: "2026-09" }]);
    expect(benchmarkGapMessage("ipca", gap!)).toBe("O IPCA só vai até set/2026 (ele é divulgado com atraso); atualize os índices.");
  });
});

describe("ibovespaByDefault", () => {
  it("liga para categorias de bolsa e desliga para carteira total, renda fixa e cripto", () => {
    expect(ibovespaByDefault("total")).toBe(false);
    expect(ibovespaByDefault("renda_fixa")).toBe(false);
    expect(ibovespaByDefault("cripto")).toBe(false);
    expect(ibovespaByDefault("renda_variavel")).toBe(true);
  });

  it("num grupo, liga se alguma categoria dele é de bolsa", () => {
    expect(ibovespaByDefault("group:3", ["fii", "acoes"])).toBe(true);
    expect(ibovespaByDefault("group:3", ["renda_fixa", "cripto"])).toBe(false);
    expect(ibovespaByDefault("group:3", ["cripto", "fii"])).toBe(true);
    expect(ibovespaByDefault("group:3")).toBe(false);
  });
});

describe("usdByDefault", () => {
  it("o dólar abre ligado só na categoria Cripto", () => {
    expect(usdByDefault("cripto")).toBe(true);
    expect(usdByDefault("total")).toBe(false);
    expect(usdByDefault("renda_variavel")).toBe(false);
    expect(usdByDefault("group:3")).toBe(false);
  });
});
