import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GOLD, GRID, MUTED, tooltipStyle } from "@/shared/lib/chart";
import { currentMonth, formatBRLCompact, formatMonth, formatMonthList, formatShortDate } from "@/shared/lib/format";
import { Button, Card, Empty, ErrorBox, Loading, Money, ScrollRegion } from "@/shared/ui";
import { ChartLegend, LegendBox, LegendLine } from "@/shared/ui/ChartLegend";
import { useContributionsByMonth } from "../hooks";
import { hasNoContributions, planDifference, summarizeContributions, tickMonths, valueAxis } from "../lib/contributions";
import { rangeFromMonth, rangeLabel, type RangeKey } from "../lib/range";
import type { ContributionsMonth } from "../types";

const CARRIED_PATTERN_ID = "padrao-saldo-trazido";
const PLANNED_DASH = "6 4";
const IN_PROGRESS_DASH = "4 3";

/** Dados de uma coluna: os nomes das séries são os da legenda. */
interface Row {
  month: string;
  Aporte: number;
  "Saldo trazido": number;
  Planejado: number | null;
  raw: ContributionsMonth;
}

const toRow = (m: ContributionsMonth): Row => ({
  month: m.month,
  Aporte: m.contributed_cents,
  "Saldo trazido": m.carried_in_cents,
  Planejado: m.planned_cents,
  raw: m,
});

const monthText = (m: ContributionsMonth) => `${formatMonth(m.month)}${m.in_progress ? " (em andamento)" : ""}`;

/** Hachura própria do saldo trazido (cinza-pedra): não se confunde com a do dinheiro separado. */
function CarriedPattern({ id = CARRIED_PATTERN_ID }: { id?: string }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
      <rect width="6" height="6" fill={MUTED} fillOpacity={0.12} />
      <line x1="0" y1="0" x2="0" y2="6" stroke={MUTED} strokeWidth="2" />
    </pattern>
  );
}

function CarriedSwatch() {
  const id = `sw-${useId().replace(/:/g, "")}`;
  return (
    <svg aria-hidden width="14" height="14" className="shrink-0">
      <defs>
        <CarriedPattern id={id} />
      </defs>
      <rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill={`url(#${id})`} stroke={MUTED} strokeWidth="1.5" />
    </svg>
  );
}

function InProgressSwatch() {
  return (
    <svg aria-hidden width="14" height="14" className="shrink-0">
      <rect x="1" y="1" width="12" height="12" rx="2" fill={GOLD} fillOpacity={0.3} stroke={GOLD} strokeWidth="1.5" strokeDasharray={IN_PROGRESS_DASH} />
    </svg>
  );
}

/** Mês no eixo; o mês em andamento ganha uma segunda linha com o texto, alinhada à direita para não sair do gráfico. */
function MonthTick({ x, y, payload, inProgressMonth }: { x?: number | string; y?: number | string; payload?: { value: unknown }; inProgressMonth?: string }) {
  if (!payload) return null;
  const active = payload.value === inProgressMonth;
  // Alinhado à direita, o texto do mês atual avança um pouco além do centro da coluna, para não sair do gráfico.
  const left = Number(x ?? 0);
  const anchorX = active ? left + 12 : left;
  return (
    <text x={anchorX} y={Number(y ?? 0) + 12} fill={AXIS} fontSize={12} textAnchor={active ? "end" : "middle"}>
      <tspan x={anchorX}>{formatShortDate(`${String(payload.value)}-01`)}</tspan>
      {active && (
        <tspan x={anchorX} dy={14} fontWeight={600}>
          em andamento
        </tspan>
      )}
    </text>
  );
}

function ContributionsTooltip({ active, payload }: { active?: boolean; payload?: readonly { payload?: Row }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const m = row.raw;
  return (
    <div style={{ ...tooltipStyle, padding: "10px 14px", maxWidth: 260 }}>
      <p className="font-medium">{monthText(m)}</p>
      <p className="tabular mt-1">
        Aporte <Money cents={m.contributed_cents} />
      </p>
      {m.off_goal_cents > 0 && (
        <p className="tabular">
          Fora da meta <Money cents={m.off_goal_cents} />
        </p>
      )}
      {m.carried_in_cents > 0 && (
        <p className="tabular">
          Saldo trazido <Money cents={m.carried_in_cents} />
        </p>
      )}
      <p className="tabular">{m.planned_cents === null ? "Sem plano" : <>Planejado <Money cents={m.planned_cents} /></>}</p>
    </div>
  );
}

function DifferenceCell({ month }: { month: ContributionsMonth }) {
  const diff = planDifference(month);
  if (diff === null) return <span className="text-ink-3">Sem plano</span>;
  // Mês em andamento: o aporte ainda pode crescer, então a diferença é parcial e não "ficou abaixo do plano".
  const partial = month.in_progress && <span className="block text-xs font-normal text-ink-3">até agora</span>;
  if (diff === 0) {
    return (
      <>
        <Money cents={0} />
        {partial}
      </>
    );
  }
  // Sinal junto com a cor: acima do plano (+, verde) e abaixo (−, argila).
  return (
    <>
      <span className={diff > 0 ? "text-jade" : "text-clay"}>
        {diff > 0 ? "+ " : "− "}
        <Money cents={Math.abs(diff)} />
      </span>
      {partial}
    </>
  );
}

function ContributionsTable({ months, label }: { months: readonly ContributionsMonth[]; label: string }) {
  const head = "pb-2 pl-3 text-right font-medium";
  return (
    <ScrollRegion label={label} className="mt-3">
      <table className="w-full text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className="text-left text-xs uppercase tracking-wide text-ink-3">
          <tr>
            <th scope="col" className="pb-2 font-medium">Mês</th>
            <th scope="col" className={head}>Aporte</th>
            <th scope="col" className={head}>Fora da meta</th>
            <th scope="col" className={head}>Saldo trazido</th>
            <th scope="col" className={head}>Planejado</th>
            <th scope="col" className={head}>Diferença</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-raise">
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row" className="whitespace-nowrap py-2 text-left font-medium">
                {formatMonth(m.month)}
                {m.in_progress && <span className="block text-xs font-normal text-ink-3">em andamento</span>}
              </th>
              <td className="tabular whitespace-nowrap py-2 pl-3 text-right font-semibold"><Money cents={m.contributed_cents} /></td>
              <td className="tabular whitespace-nowrap py-2 pl-3 text-right"><Money cents={m.off_goal_cents} /></td>
              <td className="tabular whitespace-nowrap py-2 pl-3 text-right"><Money cents={m.carried_in_cents} /></td>
              {/* `relative`: o texto sr-only é absoluto e, sem ancestral posicionado, escaparia da rolagem da tabela e alargaria a página. */}
              <td className="tabular relative whitespace-nowrap py-2 pl-3 text-right">
                {m.planned_cents === null ? (
                  <>
                    <span aria-hidden className="text-ink-3">—</span>
                    <span className="sr-only">Sem plano</span>
                  </>
                ) : (
                  <Money cents={m.planned_cents} />
                )}
              </td>
              <td className="tabular whitespace-nowrap py-2 pl-3 text-right"><DifferenceCell month={m} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

/** Quanto foi aportado em cada mês do período, contra o planejado. Não mexe em dados. */
export function ContributionsByMonthCard({ range }: { range: RangeKey }) {
  const query = useContributionsByMonth(rangeFromMonth(range, currentMonth()));
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const months = query.data?.months ?? [];
  const empty = query.data !== undefined && hasNoContributions(months);
  const summary = summarizeContributions(months);
  const inProgress = months.find((m) => m.in_progress);
  const hasCarried = months.some((m) => m.carried_in_cents > 0);
  const hasPlan = months.some((m) => m.planned_cents !== null);
  const rows = months.map(toRow);
  const axis = valueAxis(months);
  const clipped = axis ? months.filter((m) => m.carried_in_cents > 0 && m.contributed_cents + m.carried_in_cents > axis.ceiling) : [];
  const first = months[0];
  const last = months[months.length - 1];
  const tableLabel = "Aporte, saldo trazido e planejado por mês";

  return (
    <Card title="Aportes por mês" action={<span className="text-xs text-ink-3">{rangeLabel(range)}</span>}>
      {query.isLoading && <Loading />}
      <ErrorBox error={query.error} />

      {empty && (
        <Empty>
          Nenhum aporte no período. Registre um aporte em{" "}
          <Link to="/aporte" className="font-medium text-gold underline">
            Aporte do mês
          </Link>
          .
        </Empty>
      )}

      {query.data && !empty && (
        <>
          <div className="mb-4 space-y-1 text-sm text-ink-2">
            <p>
              {summary.averageCents === null ? (
                "Média dos meses completos: ainda não há mês fechado com aporte."
              ) : (
                <>
                  Média dos meses completos: <strong className="font-semibold text-ink"><Money cents={summary.averageCents} /></strong>
                  <span className="text-ink-3">
                    {" "}
                    ({summary.averageMonths === 1 ? "1 mês" : `${summary.averageMonths} meses`}, desde {formatMonth(summary.averageSince as string)})
                  </span>
                </>
              )}
            </p>
            {summary.current && (
              <p>
                Neste mês até agora: <strong className="font-semibold text-ink"><Money cents={summary.current.contributedCents} /></strong>
                {summary.current.plannedCents !== null && (
                  <span className="text-ink-3">
                    {" "}
                    (de <Money cents={summary.current.plannedCents} /> planejados)
                  </span>
                )}
              </p>
            )}
          </div>

          <div
            role="img"
            aria-label={`Gráfico de colunas com o aporte de cada mês, de ${formatMonth(first.month)} a ${formatMonth(last.month)}${
              hasCarried ? ", com o saldo trazido de ativos antigos hachurado por cima" : ""
            }${hasPlan ? " e uma linha tracejada com o valor planejado nos meses que têm plano" : ""}.${
              inProgress ? ` O mês de ${formatMonth(inProgress.month)} está em andamento.` : ""
            } Os valores estão na tabela logo abaixo.`}
            className="h-72"
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 14, left: 0 }}>
                <defs>
                  <CarriedPattern />
                </defs>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis
                  dataKey="month"
                  ticks={tickMonths(months)}
                  interval={0}
                  tickLine={false}
                  stroke={AXIS}
                  height={44}
                  tick={(props) => (
                    <MonthTick {...props} inProgressMonth={inProgress?.month} />
                  )}
                />
                <YAxis tickFormatter={formatBRLCompact} stroke={AXIS} fontSize={12} width={64} domain={[0, axis?.ceiling ?? "auto"]} ticks={axis?.ticks} allowDataOverflow />
                <Tooltip
                  cursor={{ fill: GRID }}
                  content={(props) => (
                    <ContributionsTooltip active={props.active} payload={props.payload as unknown as readonly { payload?: Row }[]} />
                  )}
                />
                <Bar isAnimationActive={false} dataKey="Aporte" stackId="aporte" fill={GOLD}>
                  {rows.map((row) => (
                    // O mês em andamento fica mais claro e contornado (tracejado): ainda não é um total.
                    <Cell
                      key={row.month}
                      fill={GOLD}
                      fillOpacity={row.raw.in_progress ? 0.3 : 1}
                      stroke={row.raw.in_progress ? GOLD : "none"}
                      strokeWidth={row.raw.in_progress ? 2 : 0}
                      strokeDasharray={row.raw.in_progress ? IN_PROGRESS_DASH : undefined}
                    />
                  ))}
                </Bar>
                <Bar isAnimationActive={false} dataKey="Saldo trazido" stackId="aporte" fill={`url(#${CARRIED_PATTERN_ID})`} stroke={MUTED} strokeWidth={1.5} />
                <Line
                  isAnimationActive={false}
                  type="linear"
                  dataKey="Planejado"
                  stroke={AXIS}
                  strokeWidth={2}
                  strokeDasharray={PLANNED_DASH}
                  // Sem plano no mês = sem ponto (não é zero). O ponto também desenha o mês de plano isolado.
                  connectNulls={false}
                  dot={{ r: 3, fill: AXIS, strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <ChartLegend
            items={[
              { key: "aporte", label: "Aporte", swatch: <LegendBox color={GOLD} opacity={1} /> },
              ...(hasCarried ? [{ key: "trazido", label: "Saldo trazido", swatch: <CarriedSwatch /> }] : []),
              { key: "planejado", label: "Planejado", swatch: <LegendLine color={AXIS} dash={PLANNED_DASH} width={2} /> },
              ...(inProgress ? [{ key: "andamento", label: "Mês em andamento", swatch: <InProgressSwatch /> }] : []),
            ]}
          />
          <p className="mt-2 text-xs text-ink-3">
            Colunas: o que você aportou em cada mês.
            {hasCarried && " Hachurado: saldo de ativo antigo trazido para o app, que não conta como aporte do mês."}
            {" A linha tracejada é o aporte planejado; mês sem plano fica sem linha."}
            {inProgress && " O mês em andamento é mais claro, com contorno tracejado, e ainda pode mudar."}
          </p>

          {clipped.length > 0 && (
            <p className="mt-2 text-xs text-ink-3">
              O saldo trazido de {formatMonthList(clipped.map((m) => m.month))} é maior que a escala do gráfico e aparece cortado no
              topo, para não achatar os aportes. O valor inteiro está na tabela.
            </p>
          )}

          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            aria-expanded={showTable}
            aria-controls={tableId}
            onClick={() => setShowTable((open) => !open)}
          >
            Ver os mesmos dados em tabela
          </Button>
          <div id={tableId}>{showTable && <ContributionsTable months={months} label={tableLabel} />}</div>
        </>
      )}
    </Card>
  );
}
