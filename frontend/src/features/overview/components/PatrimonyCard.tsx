import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RANGES, rangeStart, type RangeKey, useEvolution } from "@/features/history";
import { useMonthSummary, type PortfolioSummary } from "@/features/portfolio";
import { AXIS, GRID, tooltipStyle } from "@/shared/lib/chart";
import {
  currentMonth,
  formatBRL,
  formatBRLCompact,
  formatDate,
  formatSignedPercent,
  formatTickDate,
  monthName,
  todayISO,
} from "@/shared/lib/format";
import { cx, Empty, Loading, Money, Segmented } from "@/shared/ui";
import { Figure } from "@/shared/ui/Figure";
import { daysBefore, evolutionTitle } from "../lib/header";
import { AppreciationPill } from "./AppreciationPill";

const linkClass = "inline-flex min-h-10 items-center font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink";

/** Forma orgânica decorativa no canto do cartão: só enfeite, fora da árvore de acessibilidade. */
function Blob() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 200"
      className="pointer-events-none absolute -right-10 -top-12 size-44 fill-gold-t sm:-right-8 sm:-top-10 sm:size-72"
    >
      <path d="M152 18c32 20 50 56 41 93s-45 64-84 66-72-24-86-58 0-74 29-98S119-2 152 18Z" />
    </svg>
  );
}

/** Amostra do traço na legenda: o formato da linha diz qual série é, não só a cor. */
function Swatch({ dotted }: { dotted?: boolean }) {
  return (
    <svg aria-hidden width="30" height="8" className="shrink-0">
      <line
        x1="3"
        x2="27"
        y1="4"
        y2="4"
        stroke={dotted ? "var(--ink-3)" : "var(--ink)"}
        strokeWidth={dotted ? 3 : 3.5}
        strokeLinecap="round"
        strokeDasharray={dotted ? "0.1 7" : undefined}
      />
    </svg>
  );
}

/** Ponto final da linha: círculo cheio com contorno na cor do cartão. */
function endDot(lastIndex: number) {
  return function Dot({ cx, cy, index }: { cx?: number; cy?: number; index?: number }) {
    if (index !== lastIndex || cx === undefined || cy === undefined) return <g key={index} />;
    return <circle key={index} cx={cx} cy={cy} r={7} fill="var(--ink)" stroke="var(--card)" strokeWidth={3.5} />;
  };
}

/**
 * Cartão de patrimônio: o número grande, a valorização recente (com a data em que a medição começa), três números
 * quietos e a evolução no período escolhido (com legenda, tabela alternativa e seletor de período).
 */
export function PatrimonyCard({ total, range, onRangeChange }: { total: PortfolioSummary; range: RangeKey; onRangeChange: (range: RangeKey) => void }) {
  const month = currentMonth();
  const today = todayISO();
  const evolution = useEvolution(rangeStart(range));
  const lastDays = useEvolution(daysBefore(today, 30));
  const monthSummary = useMonthSummary(month);

  const points = (evolution.data?.points ?? []).map((p) => ({ date: p.date, total: p.total_cents, invested: p.invested_cents }));
  // Eixo começando perto dos valores (e não em zero): com patrimônio alto e variação pequena, a linha ficaria chapada.
  const values = points.flatMap((p) => [p.total, p.invested]);
  const floor = values.length ? Math.min(...values) : 0;
  const ceil = values.length ? Math.max(...values) : 0;
  const pad = Math.max(Math.round((ceil - floor) * 0.15), 1000);
  const domain: [number, number] = [Math.max(Math.floor((floor - pad) / 10_000) * 10_000, 0), Math.ceil((ceil + pad) / 10_000) * 10_000];
  const gain = total.total_current_cents - total.total_invested_cents;
  // A janela pede 30 dias, mas a medição começa no primeiro saldo dentro dela: a data real vai escrita na pílula.
  const appreciation = lastDays.data?.summary?.appreciation_cents;
  const measuredSince = lastDays.data?.summary?.start_date;
  const title = evolutionTitle(range);

  return (
    <section aria-labelledby="patrimonio-titulo" className="rise relative overflow-hidden rounded-card bg-card p-6 shadow-soft sm:p-10">
      <Blob />
      <div className="relative">
        <h2 id="patrimonio-titulo" className="text-base text-ink-2">
          Patrimônio atual
        </h2>
        <p className="mt-1 break-words font-serif text-[2.5rem] leading-none sm:text-display">
          <Money cents={total.total_current_cents} />
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {appreciation !== undefined && measuredSince ? (
            <AppreciationPill cents={appreciation} since={measuredSince} />
          ) : (
            !lastDays.isLoading && (
              <span className="text-sm text-ink-2">
                Sem saldos suficientes para medir a valorização recente.{" "}
                <Link to="/carteira/atualizar" className={linkClass}>
                  Atualizar saldos
                </Link>
              </span>
            )
          )}
        </div>

        {Boolean(total.cash_cents) && (
          <p className="mt-3 text-base text-ink-2">
            Fora desse total, <Money cents={total.cash_cents} /> em caixa nas contas, ainda não investidos.{" "}
            <Link to="/carteira/contas" className={linkClass}>
              Ver caixa
            </Link>
          </p>
        )}

        <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(min(11rem,100%),1fr))] gap-x-8 gap-y-5">
          <Figure size="md" label="Investido" value={<Money cents={total.total_invested_cents} />} hint="dinheiro que entrou" />
          <Figure
            size="md"
            label="Valorização total"
            tone={gain >= 0 ? "good" : undefined}
            value={
              <>
                <span aria-hidden>{gain >= 0 ? "▲ " : "▼ "}</span>
                <Money cents={Math.abs(gain)} />
              </>
            }
            hint={total.return_bps == null ? "sobre o investido" : `${formatSignedPercent(total.return_bps)} sobre o investido`}
          />
          <Figure
            size="md"
            label="Aportado neste mês"
            value={monthSummary.data ? <Money cents={monthSummary.data.total_cents} /> : "—"}
            hint={`em ${monthName(month)}`}
          />
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <h3 className="font-serif text-xl sm:text-2xl">{title}</h3>
          <Segmented
            label="Período do gráfico"
            value={range}
            options={RANGES.map((r) => ({ value: r.key, label: r.key === "all" ? "Todo" : r.label }))}
            onChange={onRangeChange}
          />
        </div>

        <div className="mt-4">
          {evolution.isLoading && <Loading />}
          {evolution.data && points.length < 2 && (
            <Empty>
              {points.length === 0 ? "Nenhum saldo atualizado neste período." : "Falta saldo em mais uma data para desenhar a evolução."}{" "}
              <Link to="/carteira/atualizar" className={linkClass}>
                Atualizar saldos
              </Link>
            </Empty>
          )}
          {points.length >= 2 && (
            <div
              role="img"
              aria-label={`${title}. Linha do patrimônio e linha pontilhada do valor investido, nas datas em que você atualizou os saldos. Os valores estão na tabela logo abaixo.`}
              className="h-64 sm:h-72"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  {/* tickMargin e padding à esquerda: sem eles o primeiro rótulo de data encostava no último valor do eixo vertical. */}
                  <XAxis dataKey="date" tickFormatter={formatTickDate} stroke={AXIS} fontSize={13} tickLine={false} axisLine={false} minTickGap={24} tickMargin={10} padding={{ left: 24 }} />
                  <YAxis domain={domain} tickFormatter={formatBRLCompact} stroke={AXIS} fontSize={13} width={86} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(label) => formatDate(String(label))}
                    formatter={(value, name) => [formatBRL(Number(value)), String(name)]}
                  />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="invested"
                    name="Investido"
                    stroke="var(--ink-3)"
                    strokeWidth={3}
                    strokeDasharray="0.1 7"
                    strokeLinecap="round"
                    fill="none"
                    dot={false}
                    activeDot={false}
                  />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="total"
                    name="Patrimônio"
                    stroke="var(--ink)"
                    strokeWidth={3.5}
                    strokeLinecap="round"
                    fill="var(--chart-gold)"
                    fillOpacity={0.13}
                    dot={endDot(points.length - 1)}
                    activeDot={{ r: 6, fill: "var(--ink)", stroke: "var(--card)", strokeWidth: 3 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {points.length >= 2 && (
          <>
            <ul aria-label="Legenda do gráfico" className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-2">
              <li className="flex items-center gap-2">
                <Swatch /> Patrimônio (valor atual)
              </li>
              <li className="flex items-center gap-2">
                <Swatch dotted /> Investido (o que entrou)
              </li>
            </ul>
            <details className="mt-3">
              <summary className={cx(linkClass, "cursor-pointer")}>Ver como tabela</summary>
              <div className="mt-2 max-h-72 overflow-y-auto rounded-field">
                <table className="w-full text-base">
                  <caption className="sr-only">{title}: patrimônio e valor investido em cada data de saldo, da mais antiga para a mais recente</caption>
                  <thead className="sticky top-0 bg-card text-left text-sm text-ink-3">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-normal">
                        Data
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">
                        Patrimônio
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">
                        Investido
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((p) => (
                      <tr key={p.date} className="odd:bg-raise">
                        <th scope="row" className="tabular rounded-l-field px-3 py-2 text-left font-normal">
                          {formatDate(p.date)}
                        </th>
                        <td className="tabular px-3 py-2 text-right">
                          <Money cents={p.total} />
                        </td>
                        <td className="tabular rounded-r-field px-3 py-2 text-right">
                          <Money cents={p.invested} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
