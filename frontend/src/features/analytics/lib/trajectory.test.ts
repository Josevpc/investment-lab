import { describe, expect, it } from "vitest";
import type { TrajectoryClass, TrajectoryPoint } from "../types";
import { targetsOfPortfolio } from "./trajectory";

// A meta efetiva vem do back-end; aqui só se converte para a carteira toda.
const cls = (key: string, effective_target_bps: number, hold_status: TrajectoryClass["hold_status"] = "none"): TrajectoryClass => ({
  key,
  name: key,
  color: "#000",
  target_bps: effective_target_bps,
  effective_target_bps,
  hold_status,
});

const point = (values: Record<string, number>): TrajectoryPoint => {
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  return { month: 0, total_cents: total, values_cents: values, shares_bps: {}, base_shares_bps: {} };
};

describe("targetsOfPortfolio", () => {
  it("converte a meta efetiva para a carteira toda e suspende a da toda mantida", () => {
    const classes = [cls("rf", 7500), cls("rv", 0, "all"), cls("cripto", 2500)];
    // Sem a mantida sobram R$ 600 de R$ 1.000: 75% de 60% = 45%; 25% de 60% = 15%.
    expect(targetsOfPortfolio(point({ rf: 30000, rv: 40000, cripto: 30000 }), classes)).toEqual({ rf: 4500, rv: null, cripto: 1500 });
  });

  it("sem mantidas, é a própria meta", () => {
    const plain = [cls("rf", 6000), cls("cripto", 4000)];
    expect(targetsOfPortfolio(point({ rf: 1, cripto: 9 }), plain)).toEqual({ rf: 6000, cripto: 4000 });
  });

  it("carteira vazia devolve a meta efetiva", () => {
    expect(targetsOfPortfolio(point({}), [cls("rf", 10000)])).toEqual({ rf: 10000 });
  });
});
