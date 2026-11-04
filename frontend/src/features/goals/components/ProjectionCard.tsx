import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type LabelProps } from "recharts";
import { AXIS, GOLD, GRID, tooltipStyle } from "@/shared/lib/chart";
import { formatBRL, formatBRLCompact, formatMonth, formatPercent } from "@/shared/lib/format";
import { Badge, Card, cx, Empty, ErrorBox, Loading, Money, Notice, Segmented } from "@/shared/ui";
import { useProjection } from "../hooks";
import { goalSentence, plural, projectionRows, type ProjectionView } from "../lib/goals";
import { GOAL_LINE_DASH, LINES } from "../lib/projectionLines";
import { yearFraction } from "../lib/progress";
import type { ContributionPace as Pace, GoalBasis, GoalSettings, Projection, ProjectionScenario } from "../types";
import { ContributionPace } from "./ContributionPace";

const VIEWS = [
  { value: "nominal", label: "Valores nominais" },
  { value: "today", label: "Em valores de hoje" },
] as const;

function monthlySource(p: Projection): string {
  if (p.monthly_source === "manual") return "sua meta de aporte mensal";
  if (p.monthly_source === "media") return `média dos últimos ${plural(p.monthly_considered, "aporte", "aportes")}`;
  return "nenhum aporte registrado ainda";
}

/** Anos redondos para o eixo: poucos rótulos, para não se sobreporem no celular. */
function yearTicks(from: number, to: number): number[] {
  const span = to - from;
  const step = span <= 6 ? 1 : span <= 12 ? 2 : span <= 30 ? 5 : 10;
  const ticks: number[] = [];
  for (let year = Math.ceil(from / step) * step; year <= to; year += step) ticks.push(year);
  return ticks;
}

/**
 * Rótulo da linha da meta: fica acima dela, no começo (onde os cenários ainda estão longe da meta), e leva um
 * contorno da cor do cartão para continuar legível se uma curva passar por perto.
 */
function goalLabel(text: string) {
  return {
    content: ({ viewBox }: LabelProps) => {
      // O ReferenceLine entrega o segmento da linha como retângulo (x, y); o rótulo se apoia no início dele.
      const { x = 0, y = 0 } = (viewBox ?? {}) as { x?: number; y?: number };
      return (
      <text
        x={x + 8}
        y={y - 10}
        fontSize={13}
        fill={GOLD}
        stroke="var(--card)"
        strokeWidth={4}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {text}
      </text>
      );
    },
  };
}

/** Amostra do traço da linha, igual à do gráfico: é a legenda. */
function LineSample({ stroke, dash }: { stroke: string; dash?: string }) {
  return (
    <svg aria-hidden width="40" height="8" className="shrink-0">
      <line x1="3" x2="37" y1="4" y2="4" stroke={stroke} strokeWidth="3" strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
}

/** O futuro em uma frase: quanto o cenário base entrega e de onde vem o dinheiro. */
function Headline({ p, base, view }: { p: Projection; base: ProjectionScenario; view: ProjectionView }) {
  const years = plural(p.horizon_years, "ano", "anos");
  const total = view === "today" ? base.final_today_cents : base.final_nominal_cents;
  const deposited = p.start_cents + p.contributed_cents;
  const interest = base.final_nominal_cents - deposited;
  return (
    <div>
      <p className="text-base text-ink-2">
        Daqui a {years}, no cenário base ({formatPercent(base.annual_bps)} ao ano):
      </p>
      <p className="tabular mt-1 break-words font-serif text-4xl leading-none sm:text-display">
        <Money cents={total} />
      </p>
      <p className="mt-3 max-w-3xl text-base text-ink-2">
        {view === "today" ? (
          <>
            Já descontada a inflação: é o poder de compra de hoje. Em valor nominal seriam <Money cents={base.final_nominal_cents} />.{" "}
          </>
        ) : (
          "Valor nominal, sem descontar a inflação. "
        )}
        Desse valor nominal, <strong className="font-semibold text-ink"><Money cents={deposited} /></strong> são o que você tem e vai aportar e{" "}
        <strong className="font-semibold text-jade"><Money cents={Math.max(0, interest)} /></strong> é o rendimento
        trabalhando por você.
      </p>
    </div>
  );
}

/** A projeção de longo prazo: traz o futuro para perto, com três cenários e a inflação descontada. */
export function ProjectionCard({ pace, settings }: { pace?: Pace; settings?: GoalSettings }) {
  const projection = useProjection();
  const [view, setView] = useState<ProjectionView>("today");
  const p = projection.data;
  // API antiga não manda goal_basis e comparava o valor nominal. Na nova, a meta é em reais de hoje.
  const goalBasis: GoalBasis = p?.goal_basis ?? "nominal";
  const hasGoal = (p?.net_worth_goal_cents ?? 0) > 0;
  // A meta só é comparável com a curva da mesma base da conta; na outra visão a linha enganaria.
  const showGoalLine = hasGoal && view === goalBasis;
  const rows = p ? projectionRows(p, view) : [];
  const chartRows = rows.map((row) => ({ ...row, t: yearFraction(row.month) }));
  const first = chartRows[0]?.t ?? 0;
  const last = chartRows[chartRows.length - 1]?.t ?? 0;

  return (
    <Card
      title="Seu futuro, em perspectiva"
      action={
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="gold">Simulação, não promessa</Badge>
          <Segmented<ProjectionView> label="Como mostrar os valores" value={view} options={VIEWS} onChange={setView} />
        </div>
      }
    >
      {projection.isLoading && <Loading />}
      <ErrorBox error={projection.error} />
      {p && p.start_cents === 0 && p.monthly_cents === 0 && (
        <Empty>Cadastre ativos na Carteira e registre o aporte do mês para ver a projeção.</Empty>
      )}
      {p && (p.start_cents > 0 || p.monthly_cents > 0) && (
        <div className="space-y-8">
          <Headline p={p} base={p.scenarios.find((s) => s.key === "base") ?? p.scenarios[0]} view={view} />

          <div>
            <h3 className="mb-1 text-base font-medium">
              Patrimônio projetado por ano ({view === "today" ? "em valores de hoje" : "valor nominal"})
            </h3>
            {hasGoal && (showGoalLine || goalBasis === "today") && (
              <p className="mb-3 text-sm text-ink-3">
                {showGoalLine
                  ? `A linha de traço e ponto, em mel, é a sua meta de patrimônio, ${goalBasis === "today" ? "em reais de hoje" : "em valor nominal"}. Cada círculo marca onde o cenário a alcança.`
                  : "A meta está em reais de hoje, então só aparece no gráfico em valores de hoje. Trocar a visão não muda a data de chegada."}
              </p>
            )}
            <div
              role="img"
              aria-label={`Gráfico de linhas: patrimônio projetado de ${formatMonth(rows[0].month).slice(-4)} a ${formatMonth(rows[rows.length - 1].month).slice(-4)} em três cenários, conservador, base e otimista. Os mesmos valores estão na tabela abaixo.`}
              className="h-72"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={[first, last]}
                    ticks={yearTicks(first, last)}
                    tickFormatter={(t: number) => String(Math.round(t))}
                    stroke={AXIS}
                    fontSize={13}
                    tickLine={false}
                  />
                  <YAxis tickFormatter={formatBRLCompact} stroke={AXIS} fontSize={13} width={72} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(_label, payload) => formatMonth(String(payload?.[0]?.payload?.month ?? ""))}
                    formatter={(value, name) => [formatBRL(Number(value)), String(name)]}
                  />
                  {showGoalLine && (
                    <ReferenceLine
                      y={p.net_worth_goal_cents}
                      stroke={GOLD}
                      strokeWidth={2}
                      strokeDasharray={GOAL_LINE_DASH}
                      strokeLinecap="round"
                      ifOverflow="extendDomain"
                      label={goalLabel(`Meta: ${formatBRLCompact(p.net_worth_goal_cents)}`)}
                    />
                  )}
                  {LINES.map((line) => (
                    <Line
                      key={line.key}
                      isAnimationActive={false}
                      type="linear"
                      dataKey={line.key}
                      name={line.name}
                      stroke={line.stroke}
                      strokeDasharray={line.dash}
                      strokeLinecap="round"
                      strokeWidth={3}
                      dot={false}
                    />
                  ))}
                  {showGoalLine &&
                    p.scenarios.map((s) => {
                      const line = LINES.find((l) => l.key === s.key);
                      if (!line || !s.goal_month) return null;
                      const x = yearFraction(s.goal_month);
                      if (x < first || x > last) return null;
                      return (
                        <ReferenceDot
                          key={s.key}
                          x={x}
                          y={p.net_worth_goal_cents}
                          r={7}
                          fill="var(--card)"
                          stroke={line.stroke}
                          strokeWidth={3}
                        />
                      );
                    })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(15rem,100%),1fr))] gap-3" aria-label="Cenários">
            {p.scenarios.map((s) => {
              const line = LINES.find((l) => l.key === s.key);
              return (
                <li key={s.key} className="rounded-field bg-raise p-4">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-medium">
                    {line && <LineSample stroke={line.stroke} dash={line.dash} />}
                    <span>
                      {s.name} <span className="font-normal text-ink-2">· {formatPercent(s.annual_bps)} ao ano</span>
                    </span>
                  </p>
                  <p className="tabular mt-2 font-serif text-2xl">
                    <Money cents={view === "today" ? s.final_today_cents : s.final_nominal_cents} />
                  </p>
                  {hasGoal && (
                    <p className="mt-1 text-sm text-ink-2">{goalSentence(s.goal_month, p.start_month, p.horizon_years, goalBasis)}</p>
                  )}
                </li>
              );
            })}
          </ul>

          <details className="text-base">
            <summary className="inline-flex min-h-10 cursor-pointer items-center font-medium text-ink underline underline-offset-2">
              Ver os valores em tabela
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[26rem] border-separate border-spacing-y-1.5 text-sm">
                <caption className="sr-only">Patrimônio projetado por ano e cenário</caption>
                <thead className="text-left text-ink-3">
                  <tr>
                    <th scope="col" className="px-3 pb-1 font-medium">Ano</th>
                    {LINES.map((line) => (
                      <th key={line.key} scope="col" className="px-3 pb-1 text-right font-medium">{line.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.month}>
                      <th scope="row" className="rounded-l-field bg-raise px-3 py-2 text-left font-normal">{formatMonth(row.month)}</th>
                      {LINES.map((line, i) => (
                        <td key={line.key} className={cx("tabular bg-raise px-3 py-2 text-right", i === LINES.length - 1 && "rounded-r-field")}>
                          <Money cents={row[line.key]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="space-y-3">
            <p className="text-sm text-ink-2">
              {hasGoal &&
                (goalBasis === "today"
                  ? "A data de chegada à meta é calculada em valores de hoje: o patrimônio já descontada a inflação contra a meta em reais de hoje. "
                  : "A data de chegada à meta compara o valor nominal com a meta. ")}
              Premissas: parte de <Money cents={p.start_cents} /> hoje, com aporte de <Money cents={p.monthly_cents} /> por mês (
              {monthlySource(p)}), inflação de {formatPercent(p.inflation_bps)} ao ano e horizonte de {plural(p.horizon_years, "ano", "anos")}.
              Mude tudo isso em &quot;Definir metas&quot; abaixo.
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-2">
              <li>O aporte é um valor fixo em reais, sem reajuste: em valores de hoje, ele perde poder de compra a cada ano.</li>
              <li>Cada cenário usa uma taxa única para a carteira inteira, sem separar as categorias.</li>
              <li>As taxas são nominais (já incluem a inflação) e não descontam imposto de renda nem custos.</li>
            </ul>
            <Notice tone="attention">
              É uma simulação, não uma promessa: os retornos reais variam de ano para ano e a inflação futura é uma estimativa.
            </Notice>
          </div>
        </div>
      )}
      {/* O ritmo real fica junto da projeção: é ele que diz se o aporte assumido está perto do que você faz. */}
      {pace && (
        <div className="mt-8">
          <ContributionPace pace={pace} settings={settings} />
        </div>
      )}
    </Card>
  );
}
