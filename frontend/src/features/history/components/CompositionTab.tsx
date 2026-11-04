import { useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { legendText } from "@/shared/lib/chartLegend";
import { groupsByClassKey, useAssetGroups } from "@/features/groups";
import { useAssetClasses } from "@/features/portfolio";
import { AXIS, GRID, percentLabel, RESERVE_COLOR, tooltipStyle } from "@/shared/lib/chart";
import { formatBRL, formatBRLCompact, formatDate, formatPercent, formatTickDate } from "@/shared/lib/format";
import { Card, Empty, ErrorBox, Loading, Money, Notice, Segmented } from "@/shared/ui";
import { rangeLabel, type RangeKey } from "../lib/range";
import { compositionSeries, seriesShares, seriesValues, type CompositionBy } from "../lib/series";
import type { Evolution } from "../types";

interface Props {
  range: RangeKey;
  data: Evolution | undefined;
  loading: boolean;
  error: unknown;
}

/** Participação de cada categoria no patrimônio ao longo do tempo, e o valor de cada uma. */
export function CompositionTab({ range, data, loading, error }: Props) {
  const [chosenBy, setBy] = useState<CompositionBy>("class");
  const classList = useAssetClasses(true);
  const groupList = useAssetGroups(false);

  const raw = data?.points ?? [];
  // O histórico identifica a categoria pela chave; o grupo vem do cadastro atual (id da categoria -> grupo).
  const groupOfKey = groupsByClassKey(
    groupList.data.filter((g) => !g.archived),
    classList.data ?? [],
  );
  const dataClasses = data?.classes ?? [];
  const canGroup = dataClasses.some((c) => groupOfKey.has(c.key));
  const by: CompositionBy = canGroup ? chosenBy : "class";
  const series = compositionSeries(dataClasses, groupOfKey, by);
  const noun = by === "group" ? "grupo" : "categoria";
  const points = raw.map((p) => ({ date: p.date, reserva: p.reserve_cents, ...seriesValues(p, series) }));
  const shares = raw.map((p) => ({
    date: p.date,
    ...Object.fromEntries(Object.entries(seriesShares(p, series)).map(([key, bps]) => [key, bps / 100])),
  }));
  const hasReserve = raw.some((p) => p.reserve_cents > 0);
  const groupedSeries = series.filter((s) => s.isGroup);

  return (
    <div id="panel-composicao" role="tabpanel" aria-labelledby="tab-composicao" className="space-y-6">
      {loading && <Loading />}
      <ErrorBox error={error} />
      {data && raw.length < 2 && (
        <Card title="Composição">
          <Empty>
            {raw.length === 0
              ? "Nenhum saldo atualizado neste período."
              : "Atualize os saldos em mais uma data para ver a composição mudar."}{" "}
            <Link to="/carteira/atualizar" className="font-medium text-blue-700 underline dark:text-blue-300">
              Atualizar saldos
            </Link>
          </Empty>
        </Card>
      )}
      {data && raw.length >= 2 && (
        <>
          {canGroup && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Segmented
                label="Agrupar a composição por"
                size="md"
                value={by}
                options={[
                  { value: "class", label: "Por categoria" },
                  { value: "group", label: "Por grupo" },
                ]}
                onChange={setBy}
              />
            </div>
          )}
          {by === "group" && (
            <Notice>
              O agrupamento usa o grupo atual de cada categoria, inclusive nos meses passados. Categorias sem grupo aparecem sozinhas.{" "}
              {groupedSeries.map((g) => `${g.name} reúne ${g.memberNames.join(" e ")}.`).join(" ")}
            </Notice>
          )}
          <Card
            title={`Participação por ${noun}`}
            action={<span className="text-xs text-slate-500 dark:text-slate-400">{rangeLabel(range)}</span>}
          >
            <p className="-mt-2 mb-3 text-sm text-slate-600 dark:text-slate-400">
              Para onde o patrimônio foi: percentual de cada {noun} em cada data de atualização de saldo (sem a reserva).
            </p>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={shares} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={formatTickDate} stroke={AXIS} fontSize={13} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} stroke={AXIS} fontSize={13} width={56} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(label) => formatDate(String(label))}
                    formatter={(value) => percentLabel(Number(value))}
                  />
                  <Legend formatter={legendText} />
                  {series.map((c) => (
                    <Area
                      key={c.key}
                      isAnimationActive={false}
                      type="monotone"
                      dataKey={c.key}
                      name={c.name}
                      stackId="shares"
                      stroke={c.color}
                      fill={c.color}
                      fillOpacity={0.6}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-blue-700 dark:text-blue-300">Ver os mesmos dados em tabela</summary>
              <div className="relative mt-3 overflow-x-auto" role="region" aria-label={`Participação percentual por ${noun}, por data de saldo`} tabIndex={0}>
                <table className="w-full text-sm">
                  <caption className="sr-only">Participação percentual de cada {noun} em cada data de atualização de saldo</caption>
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <tr>
                      <th scope="col" className="pb-2 font-medium">Data do saldo</th>
                      {series.map((c) => (
                        <th key={c.key} scope="col" className="pb-2 pl-3 text-right font-medium">{c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {shares.map((row) => (
                      <tr key={row.date}>
                        <th scope="row" className="whitespace-nowrap py-2 text-left font-medium">{formatDate(row.date)}</th>
                        {series.map((c) => (
                          <td key={c.key} className="tabular whitespace-nowrap py-2 pl-3 text-right">
                            {formatPercent(Math.round(Number((row as Record<string, number | string>)[c.key] ?? 0) * 100))}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>

          <Card title={`Valor por ${noun}`}>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={formatTickDate} stroke={AXIS} fontSize={13} />
                  <YAxis tickFormatter={formatBRLCompact} stroke={AXIS} fontSize={13} width={72} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(label) => formatDate(String(label))}
                    formatter={(value) => formatBRL(Number(value))}
                  />
                  <Legend formatter={legendText} />
                  {series.map((c) => (
                    <Area
                      key={c.key}
                      isAnimationActive={false}
                      type="monotone"
                      dataKey={c.key}
                      name={c.name}
                      stackId="values"
                      stroke={c.color}
                      fill={c.color}
                      fillOpacity={0.55}
                    />
                  ))}
                  {hasReserve && (
                    <Area
                      isAnimationActive={false}
                      type="monotone"
                      dataKey="reserva"
                      name="Reserva de emergência"
                      stackId="values"
                      stroke={RESERVE_COLOR}
                      fill={RESERVE_COLOR}
                      fillOpacity={0.55}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-blue-700 dark:text-blue-300">Ver os mesmos dados em tabela</summary>
              <div className="relative mt-3 overflow-x-auto" role="region" aria-label={`Valor por ${noun}, por data de saldo`} tabIndex={0}>
                <table className="w-full text-sm">
                  <caption className="sr-only">Valor de cada {noun} em cada data de atualização de saldo</caption>
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <tr>
                      <th scope="col" className="pb-2 font-medium">Data do saldo</th>
                      {series.map((c) => (
                        <th key={c.key} scope="col" className="pb-2 pl-3 text-right font-medium">{c.name}</th>
                      ))}
                      {hasReserve && <th scope="col" className="pb-2 pl-3 text-right font-medium">Reserva</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {raw.map((p) => (
                      <tr key={p.date}>
                        <th scope="row" className="whitespace-nowrap py-2 text-left font-medium">{formatDate(p.date)}</th>
                        {series.map((c) => (
                          <td key={c.key} className="tabular whitespace-nowrap py-2 pl-3 text-right"><Money cents={seriesValues(p, series)[c.key] ?? 0} /></td>
                        ))}
                        {hasReserve && <td className="tabular whitespace-nowrap py-2 pl-3 text-right"><Money cents={p.reserve_cents} /></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>
        </>
      )}
    </div>
  );
}
