import { describe, expect, it } from "vitest";
import { comparisonBars, shareOfCdi } from "./cdi";

describe("shareOfCdi", () => {
  it("calcula quanto do CDI a carteira rendeu", () => {
    expect(shareOfCdi(600, 800)).toBe(75);
    expect(shareOfCdi(1200, 800)).toBe(150);
  });

  it("arredonda meio para cima", () => {
    expect(shareOfCdi(1, 8)).toBe(13); // 12,5
    expect(shareOfCdi(1, 3)).toBe(33);
  });

  it("não compara sem CDI positivo ou sem carteira", () => {
    expect(shareOfCdi(null, 800)).toBeNull();
    expect(shareOfCdi(600, null)).toBeNull();
    expect(shareOfCdi(600, 0)).toBeNull();
    expect(shareOfCdi(600, -10)).toBeNull();
  });

  it("carteira que perdeu rendeu 0% do CDI", () => {
    expect(shareOfCdi(-300, 800)).toBe(0);
    expect(shareOfCdi(0, 800)).toBe(0);
  });
});

describe("comparisonBars", () => {
  it("a maior ocupa a barra toda e a outra fica na proporção", () => {
    expect(comparisonBars(600, 800)).toEqual({ a: 7500, b: 10000 });
    expect(comparisonBars(800, 400)).toEqual({ a: 10000, b: 5000 });
  });

  it("valor negativo ou ausente vira barra vazia; sem nenhum positivo, as duas vazias", () => {
    expect(comparisonBars(-200, 800)).toEqual({ a: 0, b: 10000 });
    expect(comparisonBars(null, 800)).toEqual({ a: 0, b: 10000 });
    expect(comparisonBars(-1, null)).toEqual({ a: 0, b: 0 });
  });
});
