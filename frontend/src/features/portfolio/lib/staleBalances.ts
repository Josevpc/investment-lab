import type { Asset } from "../types";

/** Dias sem saldo novo a partir dos quais o ativo entra no aviso "Saldos em dia?". */
export const STALE_AFTER_DAYS = 10;

/** Dias inteiros entre duas datas AAAA-MM-DD, sem passar por fuso (ver Date.UTC). */
export function daysBetween(from: string, to: string): number {
  const utc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

export interface StaleAsset {
  asset: Asset;
  days: number;
}

/**
 * Ativos cujo último saldo é mais velho que `after` dias, do mais atrasado para o mais recente. Ativo arquivado
 * não entra (não se atualiza mais) e quem não tem saldo guardado também não: não há o que estar velho.
 */
export function staleAssets(assets: readonly Asset[], today: string, after = STALE_AFTER_DAYS): StaleAsset[] {
  return assets
    .filter((asset) => !asset.archived && asset.valuation_date)
    .map((asset) => ({ asset, days: daysBetween(asset.valuation_date, today) }))
    .filter((entry) => entry.days > after)
    .sort((a, b) => b.days - a.days || a.asset.name.localeCompare(b.asset.name, "pt-BR"));
}

/** Data do saldo mais recente entre os ativos ativos (null sem nenhum). */
export function lastBalanceDate(assets: readonly Asset[]): string | null {
  return assets
    .filter((asset) => !asset.archived && asset.valuation_date)
    .reduce<string | null>((latest, a) => (latest === null || a.valuation_date > latest ? a.valuation_date : latest), null);
}
