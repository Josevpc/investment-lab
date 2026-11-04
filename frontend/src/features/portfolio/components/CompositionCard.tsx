import type { ReactNode } from "react";
import { formatPercent } from "@/shared/lib/format";
import { Card, cx, Money, noticeClass } from "@/shared/ui";
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

/** Composição micro: tipos de ativo (ação, ETF, FII) e, dentro dos FIIs, papel x tijolo. */
export function CompositionCard({ summary }: { summary: PortfolioSummary }) {
  const hasTypes = summary.by_type.length > 0;
  const fiiTotal = summary.fii_segments.reduce((sum, s) => sum + s.current_cents, 0);
  const fiiProventos = summary.fii_segments.reduce((sum, s) => sum + s.proventos_cents, 0);

  if (!hasTypes && summary.untyped_count === 0) return null;

  return (
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
  );
}
