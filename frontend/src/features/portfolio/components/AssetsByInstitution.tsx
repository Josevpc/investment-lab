import { formatPercent } from "@/shared/lib/format";
import { Money } from "@/shared/ui";
import type { Asset } from "../types";
import { AssetsTable } from "./AssetsTable";

/** Saldos agrupados por banco ou corretora (a reserva entra no saldo da instituição e fica marcada). */
export function AssetsByInstitution({ assets, onOpen }: { assets: Asset[]; onOpen: (asset: Asset) => void }) {
  const total = assets.reduce((sum, a) => sum + a.current_cents, 0);
  const groups = new Map<number, { name: string; items: Asset[] }>();
  for (const asset of assets) {
    const group = groups.get(asset.institution_id) ?? { name: asset.institution_name, items: [] };
    group.items.push(asset);
    groups.set(asset.institution_id, group);
  }
  const ordered = [...groups.values()]
    .map((g) => ({ ...g, current: g.items.reduce((sum, a) => sum + a.current_cents, 0) }))
    .sort((a, b) => b.current - a.current);

  return (
    <div className="space-y-4">
      {ordered.map((group) => (
        <section key={group.name} className="rounded-xl border border-slate-200 dark:border-slate-800">
          <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h3 className="font-semibold">{group.name}</h3>
            <span className="tabular text-sm text-slate-600 dark:text-slate-400">
              {group.items.length} {group.items.length === 1 ? "ativo" : "ativos"}
            </span>
            <span className="tabular ml-auto text-sm">
              <strong>
                <Money cents={group.current} />
              </strong>
              <span className="ml-2 text-slate-500 dark:text-slate-400">
                {total > 0 ? formatPercent(Math.round((group.current * 10_000) / total)) : "0%"} do total
              </span>
            </span>
          </header>
          <div className="px-4 py-3">
            <AssetsTable assets={group.items} onOpen={onOpen} showClass />
          </div>
        </section>
      ))}
    </div>
  );
}
