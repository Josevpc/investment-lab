import { describe, expect, it } from "vitest";
import { DASH, tooltipStyle } from "./chart";

describe("tooltipStyle", () => {
  it("separa a dica do gráfico pela sombra suave, sem borda (como o resto do produto)", () => {
    // O Recharts traz `1px solid #ccc` por padrão: "none" é o que tira a linha.
    expect(tooltipStyle.border).toBe("none");
    expect(tooltipStyle.boxShadow).toContain("var(--tooltip-shadow)");
  });
});

describe("DASH", () => {
  it("cada referência tem um traço próprio (a cor não é o único sinal)", () => {
    const patterns = Object.values(DASH);
    expect(new Set(patterns).size).toBe(patterns.length);
  });
});
