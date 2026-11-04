import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, tooltipStyle } from "@/shared/lib/chart";
import { cx, Empty, Money } from "@/shared/ui";
import { formatWorkMinutes, workMinutesRows } from "../lib/earnings";
import type { EarningsMonth } from "../types";

/**
 * Quantos minutos do seu trabalho o rendimento de cada mês equivale: o rendimento sobre o salário
 * daquele mês, numa jornada de 220 h por mês. Uma série só, então uma cor só (o título dá o nome).
 */
/** Faixa da tabela: fundo `raise` com as pontas arredondadas, sem linhas. */
const cell = "bg-raise px-3 py-2.5 first:rounded-l-field last:rounded-r-field";

// Barras de terra (terracota): o mel é só de meta e foco.
const BAR = "var(--chart-cat-2)";

export function WorkMinutesChart({ months }: { months: readonly EarningsMonth[] }) {
  const rows = workMinutesRows(months);
  if (rows.length === 0) return null;

  const withBar = rows.filter((r) => r.minutes !== null);
  const inProgress = withBar.find((r) => r.partial);
  const withoutBar = rows.length - withBar.length;
  const summary =
    "Gráfico de colunas: minutos de trabalho que o dinheiro rendeu por mês. " +
    rows.map((r) => `${r.label}: ${r.minutes === null ? r.reason : `${r.minutes} min`}`).join("; ") +
    ".";

  return (
    <div>
      <h3 className="font-serif text-xl">Minutos que seu dinheiro trabalhou por mês</h3>
      <p className="mt-1 text-sm text-ink-3">
        {rows.length === 1 ? "Último mês" : `Últimos ${rows.length} meses`}. O que seus investimentos renderam em cada mês, contado em tempo do seu trabalho: pelo seu
        salário daquele mês e uma jornada de 220 h por mês.
      </p>

      {withBar.length === 0 ? (
        <div className="mt-4 space-y-2">
          <Empty>
            Ainda não há mês com ganho para mostrar: atualize os saldos e tenha o salário registrado para ver quantos minutos de trabalho seu dinheiro rende.
          </Empty>
          <Link to="/aporte" className="inline-flex min-h-10 items-center text-sm font-medium text-ink underline underline-offset-2">
            Registrar o salário no aporte do mês
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm text-ink-3">minutos de trabalho</p>
          <div role="img" aria-label={summary} className="mt-1 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="axis" stroke={AXIS} fontSize={13} tickLine={false} />
                <YAxis stroke={AXIS} fontSize={13} width={48} tickFormatter={(v) => Number(v).toLocaleString("pt-BR")} allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "var(--chart-grid)" }}
                  labelFormatter={(_label, payload) => payload?.[0]?.payload?.label ?? ""}
                  formatter={(value) => [`${value} min (${formatWorkMinutes(Number(value))})`, "Trabalho equivalente"]}
                />
                <Bar dataKey="minutes" fill={BAR} radius={8} maxBarSize={36} isAnimationActive={false}>
                  {rows.map((r) => (
                    <Cell key={r.month} fillOpacity={r.partial ? 0.5 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {withoutBar > 0 && (
            <p className="mt-2 text-sm text-ink-3">
              Meses sem barra não puderam ser medidos: sem atualização de saldo, sem salário registrado ou sem ganho. A tabela diz o motivo de cada um.
            </p>
          )}
          {inProgress && (
            <p className="mt-2 flex items-center gap-2 text-sm text-ink-3">
              <span aria-hidden className="inline-block size-3 rounded-full opacity-50" style={{ backgroundColor: BAR }} />
              Barra clara: mês em andamento, até {inProgress.throughLabel}. O valor ainda cresce com as próximas atualizações.
            </p>
          )}
        </>
      )}

      <details className="mt-4" aria-label="Tabela dos minutos de trabalho por mês">
        <summary className="inline-flex min-h-10 cursor-pointer items-center text-sm font-medium text-ink underline underline-offset-2">Ver os mesmos dados em tabela</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[30rem] border-separate border-spacing-y-1.5 text-sm">
            <caption className="sr-only">Minutos de trabalho que o dinheiro rendeu em cada mês, e por que um mês pode ficar sem valor</caption>
            <thead className="text-left text-ink-3">
              <tr>
                <th scope="col" className="px-3 pb-1 font-medium">Mês</th>
                <th scope="col" className="px-3 pb-1 text-right font-medium">Minutos</th>
                <th scope="col" className="px-3 pb-1 text-right font-medium">Por extenso</th>
                <th scope="col" className="px-3 pb-1 text-right font-medium">Rendeu</th>
                <th scope="col" className="px-3 pb-1 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.month}>
                  <th scope="row" className={cx(cell, "whitespace-nowrap text-left font-medium")}>{r.label}</th>
                  <td className={cx(cell, "tabular text-right font-semibold")}>{r.minutes === null ? "—" : `${r.minutes} min`}</td>
                  <td className={cx(cell, "tabular text-right")}>{r.minutes === null ? "—" : formatWorkMinutes(r.minutes)}</td>
                  <td className={cx(cell, "tabular text-right")}>{r.reason === "sem atualização de saldo" ? "—" : <Money cents={r.earnedCents} />}</td>
                  <td className={cx(cell, "text-ink-2")}>
                    {r.reason ?? (r.partial ? `em andamento, até ${r.throughLabel}` : "mês completo")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
