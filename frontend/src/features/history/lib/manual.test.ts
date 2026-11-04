import { describe, expect, it } from "vitest";
import { buildSnapshotItems, type ManualRow } from "./manual";

const row = (key: string, invested: string, current: string): ManualRow => ({ key, name: key.toUpperCase(), invested, current });

describe("buildSnapshotItems", () => {
  it("converte valores digitados em centavos e ignora linhas em branco", () => {
    const result = buildSnapshotItems([
      row("rf", "1.000,00", "1.250,50"),
      row("rv", "", ""),
      row("cripto", "500", "6.000"),
    ]);
    expect(result.error).toBeNull();
    expect(result.items).toEqual([
      { class_key: "rf", invested_cents: 100000, current_cents: 125050 },
      { class_key: "cripto", invested_cents: 50000, current_cents: 600000 },
    ]);
  });

  it("assume investido igual ao atual quando o investido fica vazio", () => {
    const { items } = buildSnapshotItems([row("rf", "", "2.000,00")]);
    expect(items).toEqual([{ class_key: "rf", invested_cents: 200000, current_cents: 200000 }]);
  });

  it("exige o valor atual quando só o investido foi preenchido", () => {
    expect(buildSnapshotItems([row("rf", "100", "")]).error).toContain("RF");
  });

  it("recusa valores inválidos e formulário vazio", () => {
    expect(buildSnapshotItems([row("rf", "100", "abc")]).error).toContain("atual inválido");
    expect(buildSnapshotItems([row("rf", "x", "100")]).error).toContain("investido inválido");
    expect(buildSnapshotItems([row("rf", "", ""), row("rv", "", "")]).error).toContain("ao menos uma");
    expect(buildSnapshotItems([row("rf", "", "")], true)).toEqual({ items: [], error: null });
  });

  it("aceita zero como valor atual (categoria zerada na data)", () => {
    const { items, error } = buildSnapshotItems([row("rf", "100", "0")]);
    expect(error).toBeNull();
    expect(items[0].current_cents).toBe(0);
  });
});
