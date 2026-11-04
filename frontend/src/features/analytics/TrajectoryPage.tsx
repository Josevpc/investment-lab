import { useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { legendText } from "@/shared/lib/chartLegend";
import { useDebounced } from "@/shared/hooks/useDebounced";
import { AXIS, GRID, tooltipStyle } from "@/shared/lib/chart";
import { centsToInput, formatPercent, todayISO, formatDate, parseMoneyToCents } from "@/shared/lib/format";
import { adjustedTargetNote, joinNames } from "@/features/allocation";
import { Badge, Card, Empty, ErrorBox, Field, inputClass, Loading, Money, Notice, PageHeader, Segmented, Stat, Swatch } from "@/shared/ui";
import { useTrajectory } from "./hooks";
import { formatDuration, formatGap, trajectoryHeadline } from "./lib/headline";
import { targetsOfPortfolio } from "./lib/trajectory";
import type { TrajectoryMode } from "./types";

const HORIZONS = [12, 24, 36, 60, 120];

const SOURCE_HINT = {
  informed: "Valor informado por você.",
  last_contribution: "Pré-preenchido com o último aporte registrado.",
  none: "Nenhum aporte registrado ainda.",
} as const;

export function TrajectoryPage() {
  const [months, setMonths] = useState(24);
  const [mode, setMode] = useState<TrajectoryMode>("rebalance");
  const [amountText, setAmountText] = useState<string | null>(null);
  const [useScenario, setUseScenario] = useState(false);

  const typed = useScenario ? amountText : null;
  const parsed = typed === null || typed.trim() === "" ? null : parseMoneyToCents(typed);
  const invalidAmount = typed !== null && typed.trim() !== "" && parsed === null;

  const input = useDebounced({ months, mode, monthly_contribution_cents: parsed, tolerance_bps: 100 });
  const trajectory = useTrajectory(input);
  const t = trajectory.data;

  // Tudo em % da carteira toda. A meta (tracejada) também: com uma categoria toda mantida, a meta
  // ajustada das outras vira % da carteira toda mês a mês, então a linha da meta pode subir.
  const classes = t?.classes ?? [];
  const fullyHeld = classes.filter((c) => c.hold_status === "all");
  const noteItems = classes.map((c) => ({
    key: c.key,
    class_name: c.name,
    hold_status: c.hold_status,
    target_bps: c.target_bps,
    effective_target_bps: c.effective_target_bps,
  }));
  const chartData = (t?.points ?? []).map((p) => {
    const targets = targetsOfPortfolio(p, classes);
    return {
      month: p.month,
      ...Object.fromEntries(classes.map((c) => [c.key, (p.shares_bps[c.key] ?? 0) / 100])),
      ...Object.fromEntries(
        classes.flatMap((c) => {
          const target = targets[c.key];
          return target === null ? [] : [[`meta_${c.key}`, target / 100]];
        }),
      ),
    };
  });
  const first = t?.points[0];
  const last = t?.points.at(-1);
  const firstTargets = first ? targetsOfPortfolio(first, classes) : {};
  const lastTargets = last ? targetsOfPortfolio(last, classes) : {};
  const adjustedNotes = noteItems.flatMap((item) => {
    const note = adjustedTargetNote(item, noteItems);
    return note && t
      ? [
          {
            key: item.key,
            text:
              `${item.class_name}: ${note} (equivale a ${formatPercent(firstTargets[item.key] ?? 0)} da carteira hoje e ` +
              `${formatPercent(lastTargets[item.key] ?? 0)} em ${formatDuration(t.months)}).`,
          },
        ]
      : [];
  });
  // Os desvios do back-end medem a fatia de cada categoria na carteira sem as todas mantidas contra a
  // meta efetiva; com mantidas, a dica diz isso para o número não parecer contradizer a tabela.
  const gapHint = t?.all_held
    ? "Sem meta para comparar: todas as categorias estão mantidas"
    : fullyHeld.length > 0
      ? `Contra a meta ajustada, na carteira sem ${joinNames(fullyHeld.map((c) => c.name))}`
      : "Maior distância de uma categoria até a meta";

  return (
    <>
      <PageHeader
        title="Trajetória"
        subtitle="Para onde a carteira vai se você seguir aportando com o plano ativo. Útil para ver quanto falta para chegar à meta."
      />

      <div className="mb-6">
        <Notice>
          <strong>Simulação baseada em aportes.</strong> Não inclui rentabilidade, impostos nem garante resultados. Ponto de partida:
          a carteira de hoje ({formatDate(todayISO())}), sem a reserva de emergência.
        </Notice>
      </div>

      <div className="space-y-6">
        <Card title="Simulação">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Aporte mensal assumido</span>
              <Segmented
                label="Origem do aporte mensal"
                size="md"
                value={useScenario ? "scenario" : "last"}
                onChange={(value) => setUseScenario(value === "scenario")}
                options={[
                  { value: "last", label: "Último registrado" },
                  { value: "scenario", label: "Valor de cenário" },
                ]}
              />
            </div>
            <Field
              label="Aporte mensal (R$)"
              error={invalidAmount ? "Digite um valor como 1.500,00" : null}
              hint={
                // Com tudo mantido o campo mostra 0,00: dizer "último aporte" confundiria.
                t?.all_held
                  ? "Não usado: todos os ativos estão mantidos."
                  : t
                    ? SOURCE_HINT[typed === null || parsed === null ? t.contribution_source : "informed"]
                    : undefined
              }
              className="w-56"
            >
              <input
                inputMode="decimal"
                placeholder={t ? centsToInput(t.monthly_contribution_cents) : "0,00"}
                className={`${inputClass} tabular`}
                value={useScenario ? (amountText ?? "") : t ? centsToInput(t.monthly_contribution_cents) : ""}
                disabled={!useScenario}
                onChange={(e) => setAmountText(e.target.value)}
              />
            </Field>

            <Field label="Horizonte" className="w-40">
              <select className={inputClass} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                {HORIZONS.map((h) => (
                  <option key={h} value={h}>
                    {formatDuration(h)}
                  </option>
                ))}
              </select>
            </Field>

            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Divisão do aporte</span>
              <Segmented
                label="Modo de divisão"
                size="md"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "rebalance", label: "Rebalancear" },
                  { value: "proportional", label: "Proporcional" },
                ]}
              />
            </div>
          </div>
        </Card>

        {trajectory.isLoading && <Loading />}
        <ErrorBox error={trajectory.error} />

        {t?.all_held && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
          >
            <p className="font-medium">Com todos os ativos em &quot;Manter posição&quot;, a simulação não tem aportes.</p>
            <p className="mt-1">
              O aporte mensal acima não entra na conta: a carteira fica como está hoje. Para simular aportes, desligue &quot;Manter
              posição&quot; em ao menos um ativo.
            </p>
            <Link
              to="/carteira/ativos"
              className="mt-2 inline-flex min-h-10 items-center font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
            >
              Ir para os ativos na Carteira
            </Link>
          </div>
        )}

        {t && first && last && (
          <>
            <Card>
              <p className="text-lg font-semibold">{trajectoryHeadline(t)}</p>
              <div className="mt-5 grid grid-cols-2 gap-6 lg:grid-cols-4">
                {/* Com tudo mantido não há meta valendo: "0,0 p.p." pareceria "na meta". */}
                <Stat label="Maior desvio hoje" value={t.all_held ? "—" : formatGap(t.start_gap_bps)} hint={gapHint} />
                <Stat
                  label={`Maior desvio em ${formatDuration(t.months)}`}
                  value={t.all_held ? "—" : formatGap(t.end_gap_bps)}
                  tone={!t.all_held && t.end_gap_bps < t.start_gap_bps ? "good" : undefined}
                  hint={gapHint}
                />
                <Stat label="Patrimônio hoje" value={<Money cents={first.total_cents} />} hint="Real, sem a reserva" />
                <Stat
                  label={`Patrimônio simulado em ${formatDuration(t.months)}`}
                  value={<Money cents={last.total_cents} />}
                  hint="Simulação: só aportes, sem rentabilidade"
                />
              </div>
            </Card>

            <Card title="Participação de cada categoria ao longo do tempo">
              {first.total_cents === 0 ? (
                <Empty>Cadastre ativos na Carteira para simular a trajetória.</Empty>
              ) : (
                <>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis
                          dataKey="month"
                          type="number"
                          domain={[0, t.months]}
                          tickFormatter={(m) => (m === 0 ? "hoje" : `+${m}m`)}
                          stroke={AXIS}
                          fontSize={13}
                        />
                        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} stroke={AXIS} fontSize={13} width={48} />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          labelFormatter={(m) => (Number(m) === 0 ? "Hoje" : `Daqui a ${formatDuration(Number(m))}`)}
                          formatter={(value) => `${Number(value).toFixed(1).replace(".", ",")}%`}
                        />
                        <Legend formatter={legendText} />
                        {classes
                          .filter((c) => c.hold_status !== "all")
                          .map((c) => (
                            <Line
                              key={`meta-${c.key}`}
                              isAnimationActive={false}
                              type="monotone"
                              dataKey={`meta_${c.key}`}
                              name={`Meta de ${c.name}`}
                              stroke={c.color}
                              strokeDasharray="4 4"
                              strokeOpacity={0.6}
                              strokeWidth={1.5}
                              dot={false}
                              legendType="none"
                            />
                          ))}
                        {classes.map((c) => (
                          <Line key={c.key} isAnimationActive={false} type="monotone" dataKey={c.key} name={c.name} stroke={c.color} strokeWidth={2.5} dot={false} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Linhas cheias: % da carteira toda.
                    {!t.all_held && (
                      <>
                        {" "}
                        Linhas tracejadas: a meta de cada categoria no plano &quot;{t.plan_name}&quot;, também em % da carteira toda.
                      </>
                    )}{" "}
                    A simulação considera só os aportes (<Money cents={t.monthly_contribution_cents} /> por
                    mês), sem rentabilidade nem impostos.
                    {t.all_held && " Todas as categorias estão mantidas: sem aportes, as participações não mudam."}
                    {fullyHeld.length > 0 &&
                      !t.all_held &&
                      ` ${joinNames(fullyHeld.map((c) => c.name))} ${fullyHeld.length === 1 ? "está toda mantida" : "estão todas mantidas"}: meta suspensa, sem tracejado. Sem novos aportes, a fatia ${fullyHeld.length === 1 ? "dela" : "delas"} cai e a meta das outras sobe.`}
                  </p>
                </>
              )}
            </Card>

            {first.total_cents > 0 && (
              <Card title="Hoje vs. depois">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs sm:text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="pb-2 font-medium">Categoria</th>
                        <th className="pb-2 text-right font-medium">% da carteira hoje</th>
                        <th className="pb-2 text-right font-medium">% da carteira em {formatDuration(t.months)}</th>
                        <th className="pb-2 pl-3 text-right font-medium">Meta</th>
                        {/* No celular o valor em reais sai para as colunas de % e meta caberem sem rolar. */}
                        <th className="hidden pb-2 text-right font-medium sm:table-cell">Valor em {formatDuration(t.months)}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {noteItems.map((item) => {
                        const c = classes.find((cl) => cl.key === item.key)!;
                        return (
                          <tr key={c.key}>
                            <td className="py-2">
                              <span className="flex flex-wrap items-center gap-2">
                                <Swatch color={c.color} />
                                {c.name}
                              </span>
                              {c.hold_status === "all" && <Badge>Mantida: meta suspensa</Badge>}
                            </td>
                            <td className="tabular py-2 text-right">{formatPercent(first.shares_bps[c.key] ?? 0)}</td>
                            <td className="tabular py-2 text-right font-semibold">{formatPercent(last.shares_bps[c.key] ?? 0)}</td>
                            <td className="tabular py-2 pl-3 text-right">
                              {c.hold_status === "all" ? (
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  suspensa
                                  <span className="block">plano: {formatPercent(c.target_bps)}</span>
                                </span>
                              ) : (
                                <>
                                  {formatPercent(c.effective_target_bps)}
                                  {c.effective_target_bps !== c.target_bps && (
                                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                                      ajustada*, era {formatPercent(c.target_bps)}
                                    </span>
                                  )}
                                </>
                              )}
                            </td>
                            <td className="tabular hidden py-2 text-right sm:table-cell">
                              <Money cents={last.values_cents[c.key] ?? 0} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {adjustedNotes.length > 0 && (
                  <ul className="mt-3 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {adjustedNotes.map((n, i) => (
                      <li key={n.key}>
                        {i === 0 && <span aria-hidden>* </span>}
                        {n.text}
                      </li>
                    ))}
                  </ul>
                )}
                {fullyHeld.length > 0 && !t.all_held && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    A participação das categorias todas mantidas tende a cair, porque a carteira cresce com os aportes e elas não os
                    recebem.
                  </p>
                )}
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}
