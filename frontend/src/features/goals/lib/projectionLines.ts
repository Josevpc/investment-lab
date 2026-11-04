import { MUTED } from "@/shared/lib/chart";

/**
 * Cada cenário se distingue por traço e cor: a cor nunca é o único sinal.
 * Otimista: jade, tracejado longo. Base: tinta, contínuo. Conservador: cinza, pontilhado.
 */
export const LINES = [
  { key: "conservador", name: "Conservador", stroke: MUTED, dash: "1 6" },
  { key: "base", name: "Base", stroke: "var(--ink)", dash: undefined },
  { key: "otimista", name: "Otimista", stroke: "var(--jade)", dash: "12 7" },
] as const;

/** A meta é traço e ponto (em mel): nenhum cenário usa esse desenho, então ela não se confunde com o Conservador (pontilhado). */
export const GOAL_LINE_DASH = "10 4 1 4";
