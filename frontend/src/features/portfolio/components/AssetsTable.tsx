import { useState } from "react";
import { formatDate, formatPercent } from "@/shared/lib/format";
import { Button, cx, Money } from "@/shared/ui";
import type { Asset } from "../types";

type SortKey = "name" | "institution" | "invested" | "current" | "gain" | "updated";

interface AssetsTableProps {
  assets: Asset[];
  /** Abre o detalhe do ativo (painel lateral). */
  onOpen: (asset: Asset) => void;
  /** Cabeçalhos clicáveis para ordenar (visão em lista). */
  sortable?: boolean;
  /** Na visão agrupada a categoria já está no cabeçalho do grupo. */
  showClass?: boolean;
  /** Mostra a participação de cada ativo no total informado (visão por categoria). */
  shareOf?: number;
}

const TYPE_BADGE = { acao: "Ação", etf: "ETF", fii: "FII" } as const;
const SEGMENT_BADGE = { papel: "Papel", tijolo: "Tijolo" } as const;

/** Cabeçalho com o mesmo respiro lateral das células (pr-3): sem ele os rótulos encostavam um no outro. */
const HEAD = "pb-2 pr-3 align-bottom font-medium";

const gainTone = (value: number | null) =>
  value === null || value === 0
    ? ""
    : value > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";

const SORTERS: Record<SortKey, (a: Asset, b: Asset) => number> = {
  name: (a, b) => a.name.localeCompare(b.name, "pt-BR"),
  institution: (a, b) => a.institution_name.localeCompare(b.institution_name, "pt-BR"),
  invested: (a, b) => a.invested_cents - b.invested_cents,
  current: (a, b) => a.current_cents - b.current_cents,
  gain: (a, b) => (a.return_bps ?? -Infinity) - (b.return_bps ?? -Infinity),
  updated: (a, b) => a.valuation_date.localeCompare(b.valuation_date),
};

export function AssetsTable({ assets, onOpen, sortable = false, showClass = true, shareOf }: AssetsTableProps) {
  const hasProventos = assets.some((a) => a.proventos_cents > 0);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null);
  const rows = sort ? [...assets].sort((a, b) => (sort.desc ? -1 : 1) * SORTERS[sort.key](a, b)) : assets;

  const header = (key: SortKey, label: string, align: "left" | "right" = "left") => {
    if (!sortable) return <th scope="col" className={cx(HEAD, align === "right" && "text-right")}>{label}</th>;
    const active = sort?.key === key;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
        className={cx(HEAD, align === "right" && "text-right")}
      >
        <button
          type="button"
          onClick={() => setSort(active ? { key, desc: !sort.desc } : { key, desc: key !== "name" && key !== "institution" })}
          className="uppercase tracking-wide hover:text-slate-900 dark:hover:text-slate-100"
        >
          {label}
          {active ? (sort.desc ? " ↓" : " ↑") : ""}
        </button>
      </th>
    );
  };

  return (
    // relative: o "Ações" só para leitor de tela é absoluto; sem isso ele escapa da rolagem e alarga a página no celular.
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-ink-3">
          <tr>
            {header("name", "Ativo")}
            {showClass && <th scope="col" className={HEAD}>Categoria</th>}
            {header("institution", "Instituição")}
            {header("invested", "Investido", "right")}
            {header("current", "Atual", "right")}
            {shareOf !== undefined && <th scope="col" className={cx(HEAD, "text-right")}>% da categoria</th>}
            {header("gain", "Rendimento", "right")}
            {hasProventos && <th scope="col" className={cx(HEAD, "text-right")}>Proventos</th>}
            {showClass && header("updated", "Atualizado", "right")}
            <th scope="col" className="pb-2"><span className="sr-only">Ações</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((asset) => (
            <tr key={asset.id} className={asset.archived ? "opacity-50" : undefined}>
              <td className="py-2 pr-3">
                <button type="button" onClick={() => onOpen(asset)} className="text-left font-medium hover:underline">
                  {asset.name}
                </button>
                {asset.ticker && <span className="ml-2 text-xs text-ink-3">{asset.ticker}</span>}
                {asset.asset_type && (
                  <span className="ml-2 rounded-full bg-raise px-2.5 py-0.5 text-xs font-medium text-ink">
                    {TYPE_BADGE[asset.asset_type]}
                    {asset.fii_segment && ` · ${SEGMENT_BADGE[asset.fii_segment]}`}
                  </span>
                )}
                {asset.hold_only && (
                  <span
                    title="Não recebe novos aportes; continua contando na carteira"
                    className="ml-2 rounded-full bg-raise px-2.5 py-0.5 text-xs font-medium text-ink"
                  >
                    Mantido
                  </span>
                )}
                {asset.purpose === "reserva" && (
                  <span className="ml-2 rounded-full bg-gold-t px-2.5 py-0.5 text-xs font-medium text-ink">
                    reserva
                  </span>
                )}
                {asset.maturity_date && (
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    Vence em {formatDate(asset.maturity_date)}
                  </span>
                )}
              </td>
              {showClass && <td className="py-2 pr-3">{asset.class_name}</td>}
              <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{asset.institution_name}</td>
              <td className="tabular py-2 pr-3 text-right"><Money cents={asset.invested_cents} /></td>
              <td className="tabular py-2 pr-3 text-right font-semibold"><Money cents={asset.current_cents} /></td>
              {shareOf !== undefined && (
                <td className="tabular py-2 pr-3 text-right text-slate-600 dark:text-slate-400">
                  {shareOf > 0 ? formatPercent(Math.round((asset.current_cents * 10_000) / shareOf)) : "—"}
                </td>
              )}
              <td className={cx("tabular py-2 pr-3 text-right", gainTone(asset.gain_cents))}>
                <Money cents={asset.gain_cents} />
                <span className="block text-xs">{asset.return_bps == null ? "—" : formatPercent(asset.return_bps)}</span>
              </td>
              {hasProventos && (
                <td className="tabular py-2 pr-3 text-right">
                  {asset.proventos_cents > 0 ? (
                    <>
                      <Money cents={asset.proventos_cents} />
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        retorno total {asset.total_return_bps == null ? "—" : formatPercent(asset.total_return_bps)}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              )}
              {showClass && (
                <td className="tabular py-2 pr-3 text-right text-slate-600 dark:text-slate-400">{formatDate(asset.valuation_date)}</td>
              )}
              <td className="py-2 text-right">
                <Button variant="ghost" size="sm" aria-label={`Detalhes de ${asset.name}`} onClick={() => onOpen(asset)}>
                  Detalhes
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
