import { formatPercent } from "@/shared/lib/format";
import { RESERVE_COLOR } from "@/shared/lib/chart";
import { Money, Swatch } from "@/shared/ui";
import { classHoldStatus } from "../lib/hold";
import type { Asset, AssetClass } from "../types";
import { AssetsTable } from "./AssetsTable";

interface AssetsByCategoryProps {
  assets: Asset[];
  categories: AssetClass[];
  /** Todos os ativos, sem filtros: a situação "mantida" da categoria não depende do filtro da tela. */
  allAssets?: Asset[];
  onOpen: (asset: Asset) => void;
}

interface GroupProps {
  title: string;
  color: string;
  note?: string;
  items: Asset[];
  total: number;
  onOpen: (asset: Asset) => void;
  shareLabel: string;
  emptyLabel: string;
}

function Group({ title, color, note, items, total, onOpen, shareLabel, emptyLabel }: GroupProps) {
  const current = items.reduce((sum, a) => sum + a.current_cents, 0);
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h3 className="flex items-center gap-2 font-semibold">
          <Swatch color={color} />
          {title}
          {note && <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{note}</span>}
        </h3>
        <span className="tabular text-sm text-slate-600 dark:text-slate-400">
          {items.length} {items.length === 1 ? "ativo" : "ativos"}
        </span>
        <span className="tabular ml-auto text-sm">
          <strong><Money cents={current} /></strong>
          <span className="ml-2 text-slate-500 dark:text-slate-400">
            {total > 0 ? formatPercent(Math.round((current * 10_000) / total)) : "0%"} {shareLabel}
          </span>
        </span>
      </header>
      <div className="px-4 py-3">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{emptyLabel}</p>
        ) : (
          <AssetsTable assets={items} onOpen={onOpen} showClass={false} shareOf={current} />
        )}
      </div>
    </section>
  );
}

const HOLD_NOTE = {
  none: undefined,
  partial: "(parte dos ativos mantida)",
  all: "(toda mantida: sem novos aportes, meta suspensa)",
} as const;

/** Visão macro (categorias) com o detalhe micro (ativos) dentro de cada uma. A reserva fica à parte. */
export function AssetsByCategory({ assets, categories, allAssets = assets, onOpen }: AssetsByCategoryProps) {
  const reserve = assets.filter((a) => a.purpose === "reserva");
  const investments = assets.filter((a) => a.purpose !== "reserva");
  const investmentsTotal = investments.reduce((sum, a) => sum + a.current_cents, 0);

  const groups = categories
    .filter((c) => !c.archived || investments.some((a) => a.class_key === c.key))
    .map((category) => ({ category, items: investments.filter((a) => a.class_key === category.key) }));

  return (
    <div className="space-y-4">
      {groups.map(({ category, items }) => (
        <Group
          key={category.id}
          title={category.name}
          note={category.archived ? "(arquivada)" : HOLD_NOTE[classHoldStatus(allAssets, category.key)]}
          color={category.color}
          items={items}
          total={investmentsTotal}
          onOpen={onOpen}
          shareLabel="dos investimentos"
          emptyLabel="Nenhum ativo nesta categoria."
        />
      ))}
      {reserve.length > 0 && (
        <Group
          title="Reserva de emergência"
          note="(fora do rebalanceamento)"
          color={RESERVE_COLOR}
          items={reserve}
          total={reserve.reduce((sum, a) => sum + a.current_cents, 0)}
          onOpen={onOpen}
          shareLabel="da reserva"
          emptyLabel=""
        />
      )}
    </div>
  );
}
