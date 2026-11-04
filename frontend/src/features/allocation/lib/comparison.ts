import { ApiError } from "@/shared/lib/api";
import { formatPercent } from "@/shared/lib/format";
import type { HoldStatus } from "../types";
import { joinNames } from "./messages";

interface WithHold {
  class_name: string;
  hold_status: HoldStatus;
  target_bps: number;
  effective_target_bps: number;
}

/** Texto curto da situação frente à meta; null na categoria toda mantida (a meta dela está suspensa). */
export function targetStatus(item: { hold_status: HoldStatus; diff_cents: number | null }): string | null {
  if (item.hold_status === "all" || item.diff_cents === null) return null;
  if (item.diff_cents > 0) return "acima da meta";
  if (item.diff_cents < 0) return "abaixo da meta";
  return "na meta";
}

/**
 * Meta efetiva expressa em % da carteira toda. A meta ajustada vale sobre a carteira sem as categorias
 * todas mantidas (`base_cents`); convertida, fica na mesma base da coluna "% da carteira" e o traço da
 * barra concorda com o falta/sobra. Sem mantidas, base e total coincidem e o valor é a própria meta.
 */
export function targetShareOfPortfolio(
  item: { hold_status: HoldStatus; effective_target_bps: number },
  totals: { base_cents: number; total_cents: number },
): number | null {
  if (item.hold_status === "all") return null;
  if (totals.total_cents <= 0) return item.effective_target_bps;
  return Math.round((item.effective_target_bps * totals.base_cents) / totals.total_cents);
}

/** Nomes das categorias com todos os ativos mantidos (fora do aporte, meta suspensa). */
export function fullyHeldNames(items: readonly WithHold[]): string[] {
  return items.filter((i) => i.hold_status === "all").map((i) => i.class_name);
}

/**
 * Explica a meta ajustada: "meta 50%, ajustada para 71,43% porque Renda variável está toda mantida".
 * null quando a meta vale como foi definida (ou na própria mantida, que tem a meta suspensa).
 */
export function adjustedTargetNote(item: WithHold, items: readonly WithHold[]): string | null {
  if (item.hold_status === "all" || item.effective_target_bps === item.target_bps) return null;
  const held = fullyHeldNames(items);
  const reason =
    held.length === 0
      ? ""
      : ` porque ${joinNames(held)} ${held.length === 1 ? "está toda mantida" : "estão todas mantidas"}`;
  return `meta ${formatPercent(item.target_bps)}, ajustada para ${formatPercent(item.effective_target_bps)}${reason}`;
}

/**
 * O back-end recusa dividir (e salvar) o aporte com 422 `code: "all_held"` quando todas as categorias
 * estão com todos os ativos mantidos. Sem `code` (resposta de versão anterior), reconhece pelo texto.
 */
export function isAllHeldSplitError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 422) return false;
  const code = error.extra?.code;
  if (code !== undefined) return code === "all_held";
  return /manter posição/i.test(error.message);
}
