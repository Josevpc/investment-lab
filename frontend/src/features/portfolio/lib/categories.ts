import type { Asset } from "../types";

/** Ativos agrupados pela categoria, do maior para o menor valor atual (empate pelo nome). */
export function assetsByClass(assets: readonly Asset[]): Map<string, Asset[]> {
  const byClass = new Map<string, Asset[]>();
  for (const asset of assets) {
    byClass.set(asset.class_key, [...(byClass.get(asset.class_key) ?? []), asset]);
  }
  for (const list of byClass.values()) {
    list.sort((a, b) => b.current_cents - a.current_cents || a.name.localeCompare(b.name, "pt-BR"));
  }
  return byClass;
}

/** "sem ativos", "1 ativo", "3 ativos". */
export function assetCountLabel(count: number): string {
  if (count === 0) return "sem ativos";
  return count === 1 ? "1 ativo" : `${count} ativos`;
}
