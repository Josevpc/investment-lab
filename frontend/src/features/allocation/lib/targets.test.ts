import { describe, expect, it } from "vitest";
import { allocate, moveBoundary, redistribute, splitProportional, totalOf, type Targets } from "./targets";

const base: Targets = { rf: 5000, acoes: 2500, etfs: 1500, cripto: 1000 };

describe("allocate", () => {
  it("não perde nem cria unidades", () => {
    for (let total = 0; total < 200; total += 7) {
      const parts = allocate(total, [3333, 3333, 3334]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("divide igualmente quando todos os pesos são zero", () => {
    expect(allocate(10, [0, 0])).toEqual([5, 5]);
  });
});

describe("redistribute", () => {
  it("reajusta as demais classes proporcionalmente e mantém 100%", () => {
    const result = redistribute(base, "rf", 7000);
    expect(result.rf).toBe(7000);
    expect(totalOf(result)).toBe(10000);
    // acoes:etfs:cripto = 25:15:10 de 3000
    expect(result).toEqual({ rf: 7000, acoes: 1500, etfs: 900, cripto: 600 });
  });

  it("preserva classes travadas", () => {
    const result = redistribute(base, "rf", 7000, new Set(["cripto"]));
    expect(result.cripto).toBe(1000);
    expect(result.rf).toBe(7000);
    expect(totalOf(result)).toBe(10000);
  });

  it("limita ao que sobra quando há classes travadas", () => {
    const result = redistribute(base, "rf", 10000, new Set(["cripto"]));
    expect(result.rf).toBe(9000);
    expect(result.acoes + result.etfs).toBe(0);
    expect(totalOf(result)).toBe(10000);
  });

  it("não altera uma classe travada", () => {
    expect(redistribute(base, "rf", 100, new Set(["rf"]))).toBe(base);
  });

  it("dá o restante à única classe livre", () => {
    const result = redistribute({ a: 5000, b: 5000 }, "a", 3000);
    expect(result).toEqual({ a: 3000, b: 7000 });
  });

  it("zera as demais quando uma classe vai a 100%", () => {
    expect(redistribute(base, "rf", 10000)).toEqual({ rf: 10000, acoes: 0, etfs: 0, cripto: 0 });
  });

  it("mantém a soma em 100% para entradas arbitrárias", () => {
    for (const next of [0, 1, 333, 4999, 5001, 9999, 12000, -50]) {
      for (const key of Object.keys(base)) {
        expect(totalOf(redistribute(base, key, next))).toBe(10000);
      }
    }
  });
});

describe("moveBoundary", () => {
  const order = ["rf", "acoes", "etfs", "cripto"];

  it("troca valor só entre as duas fatias vizinhas", () => {
    // fronteira rf|acoes está em 5000; arrastada para 5500
    const result = moveBoundary(base, order, 0, 5500);
    expect(result).toEqual({ rf: 5500, acoes: 2000, etfs: 1500, cripto: 1000 });
  });

  it("considera o que vem antes da fronteira", () => {
    // fronteira acoes|etfs em 7500; arrastada para 8000
    const result = moveBoundary(base, order, 1, 8000);
    expect(result).toEqual({ rf: 5000, acoes: 3000, etfs: 1000, cripto: 1000 });
  });

  it("não ultrapassa a soma das duas fatias", () => {
    const result = moveBoundary(base, order, 2, 10000);
    expect(result.etfs).toBe(2500);
    expect(result.cripto).toBe(0);
    expect(totalOf(result)).toBe(10000);
  });

  it("ajusta ao passo de 0,5 p.p.", () => {
    expect(moveBoundary(base, order, 0, 5530).rf).toBe(5550);
  });

  it("ignora fronteiras que tocam fatias travadas", () => {
    expect(moveBoundary(base, order, 0, 6000, new Set(["acoes"]))).toBe(base);
  });
});

describe("splitProportional", () => {
  it("espelha a divisão do back-end e soma o aporte exato", () => {
    const parts = splitProportional(50000, base);
    expect(parts).toEqual({ rf: 25000, acoes: 12500, etfs: 7500, cripto: 5000 });
    expect(Object.values(splitProportional(100, { a: 3333, b: 3333, c: 3334 })).reduce((x, y) => x + y)).toBe(100);
  });

  it("manda a sobra para a maior fatia", () => {
    expect(splitProportional(100, { a: 3333, b: 3333, c: 3334 })).toEqual({ a: 33, b: 33, c: 34 });
  });

  it("metas todas zeradas dividem por igual, como o back-end", () => {
    const parts = splitProportional(100, { a: 0, b: 0, c: 0 });
    expect(Object.values(parts).reduce((x, y) => x + y)).toBe(100);
    expect(Math.max(...Object.values(parts)) - Math.min(...Object.values(parts))).toBeLessThanOrEqual(1);
  });

  it("sem categorias, não divide nada", () => {
    expect(splitProportional(100, {})).toEqual({});
  });
});
