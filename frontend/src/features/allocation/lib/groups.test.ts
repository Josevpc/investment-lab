import { describe, expect, it } from "vitest";
import type { Comparison, ComparisonGroup, ComparisonItem } from "../types";
import { comparisonSections, groupHoldNote } from "./groups";

const item = (key: string, group_id: number | null | undefined, patch: Partial<ComparisonItem> = {}): ComparisonItem => ({
  class_id: 1,
  class_key: key,
  class_name: key,
  color: "#000",
  group_id,
  current_cents: 0,
  current_bps: 0,
  target_bps: 0,
  effective_target_bps: 0,
  hold_status: "none",
  diff_cents: 0,
  held_assets: [],
  ...patch,
});

const group: ComparisonGroup = {
  group_id: 7,
  name: "Renda variável",
  color: "#000",
  class_keys: ["fii", "acoes"],
  current_cents: 0,
  current_bps: 0,
  target_bps: 3000,
  effective_target_bps: 3000,
  diff_cents: 0,
  hold_status: "none",
};

describe("comparisonSections", () => {
  const base = { plan_id: 1, plan_name: "P", total_cents: 0, base_cents: 0 };

  it("agrupa as categorias do grupo na posição da primeira", () => {
    const sections = comparisonSections({ ...base, items: [item("rf", null), item("fii", 7), item("cripto", null), item("acoes", 7)], groups: [group] });
    expect(sections.map((s) => (s.kind === "group" ? `${s.group.name}:${s.items.map((i) => i.class_key)}` : s.item.class_key))).toEqual([
      "rf",
      "Renda variável:fii,acoes",
      "cripto",
    ]);
  });

  it("sem groups (API antiga) ou com grupo desconhecido, deixa tudo solto", () => {
    const old: Comparison = { ...base, items: [item("rf", undefined), item("fii", 7)] };
    expect(comparisonSections(old).every((s) => s.kind === "item")).toBe(true);
    expect(comparisonSections({ ...old, groups: [] })).toHaveLength(2);
  });
});

describe("groupHoldNote", () => {
  it("não fala nada sem categoria toda mantida", () => {
    expect(groupHoldNote([{ hold_status: "none" }, { hold_status: "partial" }])).toBeNull();
  });
  it("distingue uma parte das categorias de todas", () => {
    expect(groupHoldNote([{ hold_status: "all" }, { hold_status: "none" }])).toBe(
      "1 categoria mantida, sem novos aportes: a barra a inclui, mas o traço de meta e o falta/sobra não",
    );
    expect(groupHoldNote([{ hold_status: "all" }, { hold_status: "all" }])).toBe("todas as categorias mantidas, sem novos aportes");
  });
});
