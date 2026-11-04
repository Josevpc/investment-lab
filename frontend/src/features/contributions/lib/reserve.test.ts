import { describe, expect, it } from "vitest";
import { parseReserveInput } from "./reserve";

describe("parseReserveInput", () => {
  it("campo vazio é sem reserva", () => {
    expect(parseReserveInput("", 48_750)).toBe(0);
    expect(parseReserveInput("   ", 48_750)).toBe(0);
  });

  it("valor em reais vira centavos", () => {
    expect(parseReserveInput("97,50", 48_750)).toBe(9_750);
    expect(parseReserveInput("R$ 1.000", 48_750)).toBe(100_000);
  });

  it("com %, é a fatia do aporte, arredondada meio para cima ao centavo", () => {
    expect(parseReserveInput("20%", 48_750)).toBe(9_750);
    expect(parseReserveInput("10 %", 48_750)).toBe(4_875);
    expect(parseReserveInput("33,33%", 10_001)).toBe(3_333); // 3.333,3333 centavos
    expect(parseReserveInput("0,5%", 10_001)).toBe(50); // 50,005 centavos: abaixo da metade, não sobe
  });

  it("valor inválido é null, para a tela avisar em vez de tratar como zero", () => {
    expect(parseReserveInput("abc", 48_750)).toBeNull();
    expect(parseReserveInput("%", 48_750)).toBeNull();
    expect(parseReserveInput("10,555%", 48_750)).toBeNull();
  });
});
