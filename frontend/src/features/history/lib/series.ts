import { arrangeByGroup } from "@/features/groups";
import type { Evolution, EvolutionPoint } from "../types";

export type CompositionBy = "class" | "group";

export interface CompositionSeries {
  /** Chave do dado no gráfico: a da categoria, ou `group:<id>` para um grupo. */
  key: string;
  name: string;
  color: string;
  archived: boolean;
  /** Categorias somadas na série (uma só quando é categoria). */
  classKeys: string[];
  /** Nomes das categorias de um grupo, para mostrar do que ele é feito. */
  memberNames: string[];
  isGroup: boolean;
}

interface GroupRef {
  id: number;
  name: string;
  color: string;
}

/**
 * Séries da composição. Por categoria, uma por categoria. Por grupo, as categorias de cada grupo viram uma
 * série só, na posição da primeira; as que não têm grupo seguem como séries próprias. O grupo é sempre o
 * **atual** da categoria, inclusive nos meses passados: o histórico não guarda o grupo de cada época.
 */
export function compositionSeries(
  classes: Evolution["classes"],
  groupOfKey: ReadonlyMap<string, GroupRef>,
  by: CompositionBy,
): CompositionSeries[] {
  const single = (c: Evolution["classes"][number]): CompositionSeries => ({
    key: c.key,
    name: c.archived ? `${c.name} (arquivada)` : c.name,
    color: c.color,
    archived: c.archived,
    classKeys: [c.key],
    memberNames: [],
    isGroup: false,
  });
  if (by === "class") return classes.map(single);

  return arrangeByGroup(classes, (c) => groupOfKey.get(c.key), (g) => g.id).map((entry) =>
    entry.kind === "item"
      ? single(entry.item)
      : {
          key: `group:${entry.group.id}`,
          name: entry.group.name,
          color: entry.group.color,
          archived: false,
          classKeys: entry.items.map((c) => c.key),
          memberNames: entry.items.map((c) => c.name),
          isGroup: true,
        },
  );
}

/** Valor (centavos) de cada série numa data: a soma das categorias dela. */
export function seriesValues(point: EvolutionPoint, series: readonly CompositionSeries[]): Record<string, number> {
  return Object.fromEntries(series.map((s) => [s.key, s.classKeys.reduce((sum, key) => sum + (point.by_class[key] ?? 0), 0)]));
}

/** Participação (pontos-base) de cada série no patrimônio investido da data (sem a reserva). */
export function seriesShares(point: EvolutionPoint, series: readonly CompositionSeries[]): Record<string, number> {
  const total = Object.values(point.by_class).reduce((sum, v) => sum + v, 0);
  const values = seriesValues(point, series);
  return Object.fromEntries(series.map((s) => [s.key, total > 0 ? Math.round((values[s.key] * 10_000) / total) : 0]));
}
