import type { HoldStatus } from "@/features/allocation";
import type { Asset } from "../types";

type HoldFields = Pick<Asset, "id" | "class_key" | "hold_only" | "archived" | "purpose">;

/**
 * Situação da categoria, pela mesma regra do back-end: "all" só com ao menos um ativo não arquivado e
 * todos mantidos; "partial" com alguns. A reserva fica fora: ela não entra na divisão do aporte.
 */
export function classHoldStatus(assets: readonly HoldFields[], classKey: string): HoldStatus {
  const inClass = assets.filter((a) => a.class_key === classKey && !a.archived && a.purpose !== "reserva");
  const held = inClass.filter((a) => a.hold_only).length;
  if (inClass.length === 0 || held === 0) return "none";
  return held === inClass.length ? "all" : "partial";
}

/**
 * Aviso do que muda na categoria ao salvar o ativo: se ela volta a receber aportes ou se fica toda
 * mantida (meta suspensa). `draft` é o ativo como vai ser salvo (id null na criação).
 */
export function holdChangeNotice(
  assets: readonly HoldFields[],
  draft: Omit<HoldFields, "id"> & { id: number | null },
  className: string,
): string | null {
  const before = classHoldStatus(assets, draft.class_key);
  const others = assets.filter((a) => a.id !== draft.id);
  const after = classHoldStatus([...others, { ...draft, id: draft.id ?? -1 }], draft.class_key);
  if (before === "all" && after !== "all") {
    return `${className} está toda mantida hoje. Com este ativo recebendo aportes, a categoria volta a receber a parte dela no próximo aporte e a meta dela volta a valer.`;
  }
  if (before !== "all" && after === "all") {
    return `Com isso, todos os ativos de ${className} ficam mantidos: a categoria deixa de receber aportes, a meta dela fica suspensa e as metas das outras são ajustadas.`;
  }
  return null;
}
