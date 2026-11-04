import { parseMoneyToCents } from "@/shared/lib/format";
import type { SnapshotItemInput } from "../types";

export interface ManualRow {
  key: string;
  name: string;
  invested: string;
  current: string;
}

export interface BuiltItems {
  items: SnapshotItemInput[];
  error: string | null;
}

/**
 * Converte as linhas digitadas (uma por categoria) nos itens da API.
 * Linhas em branco são ignoradas; "investido" vazio assume o mesmo valor do atual.
 * Com `allowEmpty` (há valor na reserva), não exigir nenhuma categoria.
 */
export function buildSnapshotItems(rows: ManualRow[], allowEmpty = false): BuiltItems {
  const items: SnapshotItemInput[] = [];

  for (const row of rows) {
    const invested = row.invested.trim();
    const current = row.current.trim();
    if (invested === "" && current === "") continue;

    if (current === "") return { items: [], error: `Informe o valor atual de ${row.name}.` };
    const currentCents = parseMoneyToCents(current);
    if (currentCents === null) return { items: [], error: `Valor atual inválido em ${row.name}.` };

    const investedCents = invested === "" ? currentCents : parseMoneyToCents(invested);
    if (investedCents === null) return { items: [], error: `Valor investido inválido em ${row.name}.` };

    items.push({ class_key: row.key, invested_cents: investedCents, current_cents: currentCents });
  }

  if (items.length === 0 && !allowEmpty) {
    return { items: [], error: "Informe o valor de ao menos uma categoria ou da reserva." };
  }
  return { items, error: null };
}
