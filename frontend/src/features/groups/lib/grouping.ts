import type { AssetGroup } from "../types";

export type Arranged<T, G> = { kind: "item"; item: T } | { kind: "group"; group: G; items: T[] };

/**
 * Junta os itens de cada grupo num bloco só, na posição do primeiro membro; quem não tem grupo (ou cujo
 * grupo `groupOf` não conhece) continua solto, na ordem de sempre. Sem grupos, devolve a lista como veio.
 */
export function arrangeByGroup<T, G>(items: readonly T[], groupOf: (item: T) => G | null | undefined, keyOf: (group: G) => string | number): Arranged<T, G>[] {
  const result: Arranged<T, G>[] = [];
  const blocks = new Map<string | number, { kind: "group"; group: G; items: T[] }>();
  for (const item of items) {
    const group = groupOf(item);
    if (group === null || group === undefined) {
      result.push({ kind: "item", item });
      continue;
    }
    const key = keyOf(group);
    const existing = blocks.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    const block = { kind: "group" as const, group, items: [item] };
    blocks.set(key, block);
    result.push(block);
  }
  return result;
}

/** Grupo de cada categoria pelo id dela. */
export function groupsByClassId(groups: readonly AssetGroup[]): Map<number, AssetGroup> {
  const map = new Map<number, AssetGroup>();
  for (const group of groups) for (const id of group.class_ids) map.set(id, group);
  return map;
}

/**
 * Grupo de cada categoria pela chave dela (o histórico e o desempenho identificam a categoria pela chave).
 * Usa o `group_id` da própria categoria quando a API o traz: a lista de grupos (`class_ids`) só tem categorias
 * ativas, e uma categoria arquivada continua no grupo (e o desempenho do grupo a soma). Sem `group_id`
 * (API anterior), cai no `class_ids`. Passe só grupos ativos: arquivar o grupo solta as categorias.
 */
export function groupsByClassKey(
  groups: readonly AssetGroup[],
  classes: readonly { id: number; key: string; group_id?: number | null }[],
): Map<string, AssetGroup> {
  const byGroupId = new Map(groups.map((g) => [g.id, g]));
  const byClassId = groupsByClassId(groups);
  const map = new Map<string, AssetGroup>();
  for (const c of classes) {
    const group = c.group_id === undefined ? byClassId.get(c.id) : c.group_id === null ? undefined : byGroupId.get(c.group_id);
    if (group) map.set(c.key, group);
  }
  return map;
}
