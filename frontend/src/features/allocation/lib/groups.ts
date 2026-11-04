import { arrangeByGroup, type Arranged } from "@/features/groups";
import type { Comparison, ComparisonGroup, ComparisonItem } from "../types";

export type ComparisonSection = Arranged<ComparisonItem, ComparisonGroup>;

/**
 * Categorias da comparação com as de cada grupo juntas, na posição da primeira. Categoria sem grupo
 * (ou com grupo que a resposta não descreve) fica solta; sem `groups`, é a lista de sempre.
 */
export function comparisonSections(comparison: Comparison): ComparisonSection[] {
  const byId = new Map((comparison.groups ?? []).map((g) => [g.group_id, g]));
  return arrangeByGroup(
    comparison.items,
    (item) => (item.group_id === null || item.group_id === undefined ? null : byId.get(item.group_id)),
    (group) => group.group_id,
  );
}

/**
 * Quando há categoria toda mantida dentro do grupo, diz por que ela não entra no falta/sobra dele.
 * null quando nenhuma está toda mantida (categoria só parcialmente mantida continua com meta).
 */
export function groupHoldNote(items: readonly Pick<ComparisonItem, "hold_status">[]): string | null {
  const held = items.filter((i) => i.hold_status === "all").length;
  if (held === 0) return null;
  if (held === items.length) return "todas as categorias mantidas, sem novos aportes";
  return held === 1
    ? "1 categoria mantida, sem novos aportes: a barra a inclui, mas o traço de meta e o falta/sobra não"
    : `${held} categorias mantidas, sem novos aportes: a barra as inclui, mas o traço de meta e o falta/sobra não`;
}
