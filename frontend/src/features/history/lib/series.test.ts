import { describe, expect, it } from "vitest";
import type { Evolution, EvolutionPoint } from "../types";
import { compositionSeries, seriesShares, seriesValues } from "./series";

const classes: Evolution["classes"] = [
  { key: "renda_fixa", name: "Renda fixa", color: "#111", archived: false },
  { key: "fii", name: "FII", color: "#222", archived: false },
  { key: "cripto", name: "Cripto", color: "#333", archived: false },
  { key: "acoes", name: "Ações/ETF", color: "#444", archived: false },
  { key: "velha", name: "Velha", color: "#555", archived: true },
];
const rv = { id: 7, name: "Renda variável", color: "#999" };
const groupOfKey = new Map([
  ["fii", rv],
  ["acoes", rv],
]);

const point = (by_class: Record<string, number>): EvolutionPoint => ({
  date: "2026-10-31",
  total_cents: 0,
  invested_cents: 0,
  by_class,
  reserve_cents: 0,
});

describe("compositionSeries", () => {
  it("por categoria, uma série por categoria, com a arquivada rotulada", () => {
    const series = compositionSeries(classes, groupOfKey, "class");
    expect(series.map((s) => s.key)).toEqual(["renda_fixa", "fii", "cripto", "acoes", "velha"]);
    expect(series.at(-1)?.name).toBe("Velha (arquivada)");
  });

  it("por grupo, junta as categorias do grupo na posição da primeira e deixa as outras soltas", () => {
    const series = compositionSeries(classes, groupOfKey, "group");
    expect(series.map((s) => s.name)).toEqual(["Renda fixa", "Renda variável", "Cripto", "Velha (arquivada)"]);
    expect(series[1]).toMatchObject({ key: "group:7", isGroup: true, classKeys: ["fii", "acoes"], memberNames: ["FII", "Ações/ETF"] });
  });
});

describe("seriesValues e seriesShares", () => {
  const p = point({ renda_fixa: 50_000, fii: 20_000, cripto: 10_000, acoes: 20_000 });

  it("soma as categorias do grupo", () => {
    const series = compositionSeries(classes, groupOfKey, "group");
    expect(seriesValues(p, series)["group:7"]).toBe(40_000);
    expect(seriesShares(p, series)).toMatchObject({ renda_fixa: 5000, "group:7": 4000, cripto: 1000, velha: 0 });
  });

  it("sem patrimônio, a participação é 0", () => {
    expect(seriesShares(point({}), compositionSeries(classes, groupOfKey, "group"))["group:7"]).toBe(0);
  });
});
