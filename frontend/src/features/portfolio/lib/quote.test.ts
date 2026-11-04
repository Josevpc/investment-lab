import { describe, expect, it } from "vitest";
import { addQuantities, parseQuantity, valueFromQuote } from "./quote";

describe("valueFromQuote", () => {
  it("multiplica quantidade por cotação", () => {
    expect(valueFromQuote("10", "12,34")).toBe(12_340); // 10 cotas x R$ 12,34 = R$ 123,40
    expect(valueFromQuote("45", "106,50")).toBe(479_250);
  });

  it("aceita quantidade fracionada de cripto sem erro de ponto flutuante", () => {
    expect(valueFromQuote("0.0025", "350000")).toBe(87_500); // 0,0025 BTC x R$ 350.000 = R$ 875,00
    expect(valueFromQuote("0,1", "0,3")).toBe(3); // 0,03 -> R$ 0,03 (0.1 x 0.3 em float daria 0.030000000000000002)
  });

  it("arredonda meio para cima no centavo", () => {
    expect(valueFromQuote("1", "0,005")).toBe(1); // meio centavo sobe
    expect(valueFromQuote("3", "0,3333")).toBe(100); // 0,9999 -> R$ 1,00
    expect(valueFromQuote("1", "0,004")).toBe(0);
  });

  it("entende o formato brasileiro e o milhar", () => {
    expect(valueFromQuote("1.000", "2,50")).toBe(250_000); // 1.000 cotas
    expect(valueFromQuote("2", "R$ 1.234,56")).toBe(246_912);
  });

  it("devolve null para entradas inválidas ou sem quantidade", () => {
    expect(valueFromQuote("", "10")).toBeNull();
    expect(valueFromQuote(null, "10")).toBeNull();
    expect(valueFromQuote("abc", "10")).toBeNull();
    expect(valueFromQuote("10", "")).toBeNull();
    expect(valueFromQuote("10", "0")).toBeNull();
    expect(valueFromQuote("10", "1,2,3")).toBeNull();
    expect(valueFromQuote("0", "10")).toBeNull();
    expect(valueFromQuote("1.123456789", "10")).toBeNull(); // mais de 8 casas
  });
});

describe("parseQuantity", () => {
  it("só aceita quantidade positiva", () => {
    expect(parseQuantity("10")).not.toBeNull();
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity(undefined)).toBeNull();
  });
});

describe("addQuantities", () => {
  it("soma com casas decimais diferentes, sem erro de ponto flutuante", () => {
    expect(addQuantities("0.1", "0,2")).toBe("0.3");
    expect(addQuantities("0.0025", "0.0025")).toBe("0.005");
    expect(addQuantities("1", "0,00000001")).toBe("1.00000001");
  });
  it("parte do zero quando o ativo não tem quantidade", () => {
    expect(addQuantities(null, "0,5")).toBe("0.5");
    expect(addQuantities("", "2")).toBe("2");
  });
  it("devolve null para quantidade inválida", () => {
    expect(addQuantities("abc", "1")).toBeNull();
    expect(addQuantities("1", "0")).toBeNull();
  });
});
