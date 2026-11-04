import { describe, expect, it } from "vitest";
import { biggestShortfall, gapFromTarget } from "./allocationRows";

const totals = { base_cents: 100_000, total_cents: 100_000 };
const row = (patch: Record<string, unknown>) => ({
  class_key: "rf",
  hold_status: "none" as const,
  current_bps: 4000,
  effective_target_bps: 5000,
  ...patch,
});

describe("gapFromTarget", () => {
  it("diz quantos pontos abaixo da meta", () => {
    expect(gapFromTarget(row({}), totals)).toEqual({ bps: -1000, text: "10 pontos abaixo da meta" });
  });

  it("diz quantos pontos acima, com vírgula decimal e singular", () => {
    expect(gapFromTarget(row({ current_bps: 5350 }), totals)).toEqual({ bps: 350, text: "3,5 pontos acima da meta" });
    expect(gapFromTarget(row({ current_bps: 5100 }), totals).text).toBe("1 ponto acima da meta");
  });

  it("na meta quando a diferença some no arredondamento", () => {
    expect(gapFromTarget(row({ current_bps: 5000 }), totals)).toEqual({ bps: 0, text: "na meta" });
    expect(gapFromTarget(row({ current_bps: 5003 }), totals).text).toBe("na meta");
  });

  it("converte a meta ajustada para a base da carteira toda (categoria mantida fora da base)", () => {
    // Base de R$ 700 numa carteira de R$ 1.000: meta efetiva 71,43% equivale a 50% da carteira toda.
    const t = { base_cents: 70_000, total_cents: 100_000 };
    expect(gapFromTarget(row({ current_bps: 4000, effective_target_bps: 7143 }), t).bps).toBe(-1000);
  });

  it("sem meta (categoria toda mantida), não há diferença a dizer", () => {
    expect(gapFromTarget(row({ hold_status: "all", effective_target_bps: 0 }), totals)).toEqual({ bps: 0, text: null });
  });
});

describe("biggestShortfall", () => {
  it("escolhe a categoria mais abaixo da meta", () => {
    expect(
      biggestShortfall(
        [row({ class_key: "a", current_bps: 4500 }), row({ class_key: "b", current_bps: 3000 }), row({ class_key: "c", current_bps: 6000 })],
        totals,
      ),
    ).toBe("b");
  });

  it("é null quando ninguém está abaixo da meta, ou só há categorias mantidas", () => {
    expect(biggestShortfall([row({ current_bps: 6000 }), row({ class_key: "x", current_bps: 5000 })], totals)).toBeNull();
    expect(biggestShortfall([row({ hold_status: "all", effective_target_bps: 0 })], totals)).toBeNull();
  });
});
