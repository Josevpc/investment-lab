import { formatPercent } from "@/shared/lib/format";
import { Money, Swatch } from "@/shared/ui";
import { PebbleBar } from "@/shared/ui/PebbleBar";
import type { GroupRow } from "../lib/distribution";

/** Cor da barra de "Sem grupo": o cinza da paleta dos gráficos (o resto vem da cor de cada grupo). */
const NO_GROUP = "var(--chart-muted)";

/** Distribuição por grupo: barras com a participação e, logo abaixo, os mesmos dados em tabela. */
export function GroupDistribution({ rows, investmentsCents }: { rows: GroupRow[]; investmentsCents: number }) {
  return (
    <>
      <ul aria-label="Participação de cada grupo nos investimentos" className="space-y-3">
        {rows.map((row) => (
          <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 text-base">
            <span className="flex min-w-0 items-center gap-2 font-medium">
              <Swatch color={row.color ?? NO_GROUP} />
              <span className="truncate">{row.label}</span>
            </span>
            <span className="tabular text-right">
              <strong>{formatPercent(row.bps)}</strong>{" "}
              <span className="text-sm text-ink-3">
                <Money cents={row.currentCents} />
              </span>
            </span>
            <PebbleBar
              role="img"
              valueBps={row.bps}
              color={row.color ?? NO_GROUP}
              label={`${row.label}: ${formatPercent(row.bps)} dos investimentos`}
              className="col-span-2"
            />
          </li>
        ))}
      </ul>

      <details className="mt-5">
        <summary className="inline-flex min-h-10 cursor-pointer items-center font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink">Ver os mesmos dados em tabela</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-base">
            <caption className="sr-only">Valor atual, investido e participação de cada grupo nos investimentos, sem a reserva</caption>
            <thead className="text-left text-sm text-ink-3">
              <tr>
                <th scope="col" className="pb-2 font-normal">Grupo</th>
                <th scope="col" className="pb-2 text-right font-normal">Valor atual</th>
                <th scope="col" className="pb-2 pl-3 text-right font-normal">Investido</th>
                <th scope="col" className="pb-2 pl-3 text-right font-normal">% dos investimentos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="odd:bg-raise">
                  <th scope="row" className="rounded-l-field px-3 py-2 text-left font-medium">{row.label}</th>
                  <td className="tabular py-2 text-right"><Money cents={row.currentCents} /></td>
                  <td className="tabular py-2 pl-3 text-right"><Money cents={row.investedCents} /></td>
                  <td className="tabular rounded-r-field py-2 pl-3 pr-3 text-right font-medium">{formatPercent(row.bps)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="px-3 pt-3 pb-2 text-left font-medium">Total dos investimentos</th>
                <td className="tabular pt-3 pb-2 text-right font-medium"><Money cents={investmentsCents} /></td>
                <td />
                <td className="tabular pt-3 pb-2 pl-3 pr-3 text-right font-medium">{formatPercent(10_000)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </details>
    </>
  );
}
