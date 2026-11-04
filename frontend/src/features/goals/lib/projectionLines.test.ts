import { describe, expect, it } from "vitest";
import { GOAL_LINE_DASH, LINES } from "./projectionLines";

describe("traços do gráfico de projeção", () => {
  it("a linha da meta tem um traço que nenhum cenário usa", () => {
    expect(LINES.map((l) => l.dash)).not.toContain(GOAL_LINE_DASH);
  });

  it("os três cenários também se distinguem entre si pelo traço", () => {
    expect(new Set(LINES.map((l) => l.dash)).size).toBe(LINES.length);
  });
});
