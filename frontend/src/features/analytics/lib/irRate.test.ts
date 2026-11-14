import { describe, expect, it } from "vitest";
import { DEFAULT_IR_RATE_BPS, parseIrRate } from "./irRate";

describe("parseIrRate", () => {
  it("aceita as quatro alíquotas da tabela regressiva", () => {
    for (const bps of [2250, 2000, 1750, 1500]) expect(parseIrRate(String(bps))).toBe(bps);
  });

  it("sem nada guardado, vale o padrão de 15%", () => {
    expect(parseIrRate(null)).toBe(DEFAULT_IR_RATE_BPS);
    expect(DEFAULT_IR_RATE_BPS).toBe(1500);
  });

  it("valor que não é uma alíquota volta ao padrão", () => {
    for (const raw of ["", "abc", "1600", "15", "-1500", "1500.5", "2250 "]) expect(parseIrRate(raw)).toBe(1500);
  });
});
