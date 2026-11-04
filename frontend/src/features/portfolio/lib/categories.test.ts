import { describe, expect, it } from "vitest";
import type { Asset } from "../types";
import { assetCountLabel, assetsByClass } from "./categories";

const asset = (id: number, name: string, class_key: string, current_cents: number) => ({ id, name, class_key, current_cents }) as Asset;

describe("assetsByClass", () => {
  it("agrupa pela categoria e ordena do maior para o menor valor", () => {
    const grouped = assetsByClass([asset(1, "A", "rf", 100), asset(2, "B", "rv", 50), asset(3, "C", "rf", 300), asset(4, "D", "rf", 300)]);
    expect(grouped.get("rf")?.map((a) => a.name)).toEqual(["C", "D", "A"]);
    expect(grouped.get("rv")?.map((a) => a.name)).toEqual(["B"]);
    expect(grouped.get("cripto")).toBeUndefined();
  });
});

describe("assetCountLabel", () => {
  it("concorda no singular e no plural", () => {
    expect(assetCountLabel(0)).toBe("sem ativos");
    expect(assetCountLabel(1)).toBe("1 ativo");
    expect(assetCountLabel(4)).toBe("4 ativos");
  });
});
