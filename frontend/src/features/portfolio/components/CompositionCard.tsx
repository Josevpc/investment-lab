import type { ReactNode } from "react";
import { SEPARATED_LABEL } from "@/shared/lib/chart";
import { formatPercent } from "@/shared/lib/format";
import { Card, cx, Money, noticeClass, Swatch } from "@/shared/ui";
import { ChartLegend } from "@/shared/ui/ChartLegend";
import { SeparatedSwatch } from "@/shared/ui/SeparatedMark";
import { useAssetClasses } from "../hooks";
import { categoryBars } from "../lib/separated";
import type { FiiSegmentBreakdown, PortfolioSummary, TypeBreakdown } from "../types";

const TYPE_COLOR: Record<TypeBreakdown["asset_type"], string> = {
  acao: "var(--chart-cat-1)",
  etf: "var(--chart-cat-3)",
  fii: "var(--chart-cat-5)",
};

const SEGMENT_COLOR: Record<FiiSegmentBreakdown["segment"], string> = {
  papel: "var(--chart-cat-4)",
  tijolo: "var(--chart-cat-2)",
  sem_segmento: "var(--chart-cat-6)",
};

function Bar({ label, detail, color, bps, value }: { label: string; detail?: ReactNode; color: string; bps: number; value: ReactNode }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-base sm:grid-cols-[minmax(0,10rem)_1fr_auto]">
      <span className="col-start-1 row-start-1 min-w-0 truncate">
        {label}
        {detail && <span className="block text-sm text-ink-3">{detail}</span>}
      </span>
      <div className="col-span-2 col-start-1 row-start-2 h-3.5 rounded-full bg-raise sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <div className="h-full rounded-full" style={{ width: `${Math.min(bps / 100, 100)}%`, minWidth: bps > 0 ? "0.875rem" : undefined, backgroundColor: color }} />
      </div>
      <span className="tabular col-start-2 row-start-1 text-right sm:col-start-3">
        <strong>{formatPercent(bps)}</strong>
        <span className="block text-sm text-ink-3">{value}</span>
      </span>
    </li>
  );
}

/**
 * Participação de cada categoria com o dinheiro separado: o trecho investido é cheio e o separado, hachurado com
 * contorno tracejado e escrito "R$ X separado". Só existe com algo separado (é o único caso em que a tela muda).
 */
function CategoriesWithSeparated({ summary }: { summary: PortfolioSummary }) {
  const classes = useAssetClasses(true);
  const names = new Map((classes.data ?? []).map((c) => [c.key, { name: c.name, color: c.color }]));
  const bars = categoryBars(summary, names);
  if (bars.length === 0) return null;

  return (
    <Card title="Composição por categoria">
      <p className="-mt-2 mb-5 text-base text-ink-2">
        Quanto cada categoria pesa, contando o dinheiro já separado para comprá-la. O trecho hachurado ainda não foi investido.
      </p>
      <ul className="space-y-4">
        {bars.map((bar) => {
          const bps = Math.min(bar.shareBps, 10_000);
          return (
            <li key={bar.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-base sm:grid-cols-[minmax(0,10rem)_1fr_auto]">
              <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
                <Swatch color={bar.color} />
                <span className="truncate">{bar.name}</span>
              </span>
              <div
                role="img"
                aria-label={`${bar.name}: ${formatPercent(bar.shareBps)} do total${bar.separatedCents > 0 ? ", com parte separada, ainda não investida" : ""}`}
                className="col-span-2 col-start-1 row-start-2 h-3.5 rounded-full bg-raise sm:col-span-1 sm:col-start-2 sm:row-start-1"
              >
                <div className="flex h-full overflow-hidden rounded-full" style={{ width: `${bps / 100}%`, minWidth: bps > 0 ? "0.875rem" : undefined }}>
                  {bar.currentCents > 0 && <div data-part="invested" className="h-full" style={{ flexGrow: bar.currentCents, backgroundColor: bar.color }} />}
                  {bar.separatedCents > 0 && <div data-part="separated" className="separated-fill h-full" style={{ flexGrow: bar.separatedCents, minWidth: "0.5rem" }} />}
                </div>
              </div>
              <span className="tabular col-start-2 row-start-1 text-right sm:col-start-3">
                <strong>{formatPercent(bar.shareBps)}</strong>
                <span className="block text-sm text-ink-3">
                  <Money cents={bar.currentCents} />
                </span>
                {bar.separatedCents > 0 && (
                  <span className="block text-sm text-ink-2">
                    <Money cents={bar.separatedCents} /> separado
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <ChartLegend
        label="Legenda das barras"
        items={[
          { key: "investido", label: "Investido (trecho de cor cheia)", swatch: <span aria-hidden className="inline-block h-3 w-7 rounded-sm bg-ink-3" /> },
          { key: "separado", label: SEPARATED_LABEL, swatch: <SeparatedSwatch /> },
        ]}
      />
      <details className="mt-4">
        <summary className="inline-flex min-h-10 cursor-pointer items-center font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink">
          Ver como tabela
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[26rem] text-base">
            <caption className="sr-only">Valor investido, dinheiro separado e participação de cada categoria</caption>
            <thead className="text-left text-sm text-ink-3">
              <tr>
                <th scope="col" className="px-3 py-2 font-normal">Categoria</th>
                <th scope="col" className="px-3 py-2 text-right font-normal">Investido</th>
                <th scope="col" className="px-3 py-2 text-right font-normal">Separado</th>
                <th scope="col" className="px-3 py-2 text-right font-normal">% do total</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((bar) => (
                <tr key={bar.key} className="odd:bg-raise">
                  <th scope="row" className="rounded-l-field px-3 py-2 text-left font-normal">{bar.name}</th>
                  <td className="tabular px-3 py-2 text-right"><Money cents={bar.currentCents} /></td>
                  <td className="tabular px-3 py-2 text-right"><Money cents={bar.separatedCents} /></td>
                  <td className="tabular rounded-r-field px-3 py-2 text-right">{formatPercent(bar.shareBps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

/** Composição micro: tipos de ativo (ação, ETF, FII) e, dentro dos FIIs, papel x tijolo. Com dinheiro separado, também por categoria. */
export function CompositionCard({ summary }: { summary: PortfolioSummary }) {
  const hasSeparated = (summary.reserved_by_class ?? []).some((r) => r.reserved_cents > 0);
  const hasTypes = summary.by_type.length > 0;
  const fiiTotal = summary.fii_segments.reduce((sum, s) => sum + s.current_cents, 0);
  const fiiProventos = summary.fii_segments.reduce((sum, s) => sum + s.proventos_cents, 0);

  if (!hasTypes && summary.untyped_count === 0) return hasSeparated ? <CategoriesWithSeparated summary={summary} /> : null;

  return (
    <>
      {hasSeparated && <CategoriesWithSeparated summary={summary} />}
      <Card title="Composição por tipo de ativo">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="mb-4 text-base font-medium text-ink-2">Ações, ETFs e fundos imobiliários</h3>
            {hasTypes ? (
              <ul className="space-y-4">
                {summary.by_type.map((t) => (
                  <Bar
                    key={t.asset_type}
                    label={t.label}
                    detail={`${t.assets_count} ${t.assets_count === 1 ? "ativo" : "ativos"}`}
                    color={TYPE_COLOR[t.asset_type]}
                    bps={t.share_bps}
                    value={<Money cents={t.current_cents} />}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-base text-ink-2">Defina o tipo dos ativos de renda variável para ver a composição.</p>
            )}
          </div>

          <div>
            <h3 className="mb-4 text-base font-medium text-ink-2">Fundos imobiliários: papel x tijolo</h3>
            {summary.fii_segments.length > 0 ? (
              <>
                <ul className="space-y-4">
                  {summary.fii_segments.map((s) => (
                    <Bar
                      key={s.segment}
                      label={s.label}
                      detail={
                        s.proventos_cents > 0 ? (
                          <>
                            proventos: <Money cents={s.proventos_cents} />
                          </>
                        ) : (
                          `${s.assets_count} ${s.assets_count === 1 ? "fundo" : "fundos"}`
                        )
                      }
                      color={SEGMENT_COLOR[s.segment]}
                      bps={s.share_bps}
                      value={<Money cents={s.current_cents} />}
                    />
                  ))}
                </ul>
                <p className="mt-4 text-sm text-ink-3">
                  Total em FIIs: <Money cents={fiiTotal} />
                  {fiiProventos > 0 && (
                    <>
                      {" · proventos recebidos: "}
                      <Money cents={fiiProventos} />
                    </>
                  )}
                </p>
              </>
            ) : (
              <p className="text-base text-ink-2">Nenhum fundo imobiliário cadastrado ainda.</p>
            )}
          </div>
        </div>

        {summary.untyped_count > 0 && (
          <p className={cx(noticeClass("attention"), "mt-5")}>
            {summary.untyped_count} {summary.untyped_count === 1 ? "ativo de renda variável está" : "ativos de renda variável estão"} sem tipo (
            <Money cents={summary.untyped_current_cents} />). Edite-{summary.untyped_count === 1 ? "o" : "os"} para indicar se {summary.untyped_count === 1 ? "é" : "são"} ação, ETF
            ou fundo imobiliário.
          </p>
        )}
      </Card>
    </>
  );
}
