import { describe, expect, it } from "vitest";
import type { AssetGroup } from "../types";
import { arrangeByGroup, groupsByClassId, groupsByClassKey } from "./grouping";

const group = (id: number, name: string, class_ids: number[]): AssetGroup => ({ id, name, color: "#000", archived: false, class_ids });
const rv = group(1, "Renda variável", [2, 3]);

describe("arrangeByGroup", () => {
  const items = [
    { id: 1, name: "Renda fixa" },
    { id: 2, name: "FII" },
    { id: 4, name: "Cripto" },
    { id: 3, name: "Ações/ETF" },
  ];
  const byId = groupsByClassId([rv]);

  it("junta os membros do grupo na posição do primeiro e deixa os demais soltos", () => {
    const arranged = arrangeByGroup(items, (i) => byId.get(i.id), (g) => g.id);
    expect(arranged.map((a) => (a.kind === "group" ? `grupo:${a.group.name}[${a.items.map((i) => i.name)}]` : a.item.name))).toEqual([
      "Renda fixa",
      "grupo:Renda variável[FII,Ações/ETF]",
      "Cripto",
    ]);
  });

  it("sem grupos, mantém a lista como veio", () => {
    const arranged = arrangeByGroup(items, () => null, (g: AssetGroup) => g.id);
    expect(arranged.every((a) => a.kind === "item")).toBe(true);
    expect(arranged).toHaveLength(4);
  });
});

describe("groupsByClassKey com group_id da categoria", () => {
  const active = [group(1, "Renda variável", [2])]; // class_ids só traz a ativa

  it("mantém no grupo a categoria arquivada que ainda tem group_id", () => {
    const map = groupsByClassKey(active, [
      { id: 2, key: "fii", group_id: 1 },
      { id: 3, key: "acoes", group_id: 1 },
      { id: 1, key: "renda_fixa", group_id: null },
    ]);
    expect([...map.keys()]).toEqual(["fii", "acoes"]);
  });

  it("ignora group_id de grupo que não está entre os ativos (arquivar o grupo solta as categorias)", () => {
    expect(groupsByClassKey(active, [{ id: 3, key: "acoes", group_id: 99 }]).size).toBe(0);
  });
});

describe("groupsByClassKey", () => {
  it("traduz id da categoria em chave", () => {
    const map = groupsByClassKey([rv], [
      { id: 1, key: "renda_fixa" },
      { id: 2, key: "fii" },
    ]);
    expect(map.get("fii")?.name).toBe("Renda variável");
    expect(map.has("renda_fixa")).toBe(false);
  });
});
