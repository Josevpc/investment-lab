import { describe, expect, it } from "vitest";
import { tooltipStyle } from "./chart";

describe("tooltipStyle", () => {
  it("separa a dica do gráfico pela sombra suave, sem borda (como o resto do produto)", () => {
    // O Recharts traz `1px solid #ccc` por padrão: "none" é o que tira a linha.
    expect(tooltipStyle.border).toBe("none");
    expect(tooltipStyle.boxShadow).toContain("var(--tooltip-shadow)");
  });
});
