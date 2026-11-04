import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { legendText } from "@/shared/lib/chartLegend";
import { ibovespaByDefault, ibovespaGap, ibovespaGapMessage, usePerformance, type StaleAsset } from "@/features/analytics";
import { useAssetGroups } from "@/features/groups";
import { useAssetClasses } from "@/features/portfolio";
import { useDismissed } from "@/shared/lib/preferences";
import { AXIS, GOLD, GRID, INDEX, tooltipStyle } from "@/shared/lib/chart";
import { formatDate, formatPointsDiff, formatSignedPercent, formatTickDate } from "@/shared/lib/format";
import { ButtonLink, Card, Empty, ErrorBox, inputClass, Loading, Money, Notice, noticeClass } from "@/shared/ui";
import { rangeLabel, rangeStart, type RangeKey } from "../lib/range";

// A legenda segue a ordem de leitura (carteira primeiro), não a alfabética padrão do Recharts.
const LEGEND_ORDER = ["Carteira", "CDI", "Ibovespa"];

const UPDATE_HREF = "/carteira/atualizar";
const MAX_STALE_LISTED = 5;

const dateTime = (iso: string) => `${formatDate(iso.slice(0, 10))} às ${iso.slice(11, 16)}`;

const days = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="tabular mt-1 font-serif text-xl font-semibold sm:text-2xl">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

/** Dinheiro que entrou (+) ou saiu (−) da carteira; o sinal vai junto com o valor, nunca só a cor. */
function Flow({ cents }: { cents: number }) {
  if (cents === 0) return <>—</>;
  return (
    <>
      {/* Espaço sem quebra: no celular o sinal não pode ficar sozinho numa linha. */}
      <span className="whitespace-nowrap">
        {cents > 0 ? "+ " : "− "}
        <Money cents={Math.abs(cents)} />
      </span>
    </>
  );
}

/** Ativos com o último saldo velho: o retorno deles pode estar defasado. A saída é atualizar os saldos. */
function StaleAssets({ assets }: { assets: StaleAsset[] }) {
  const listed = assets.slice(0, MAX_STALE_LISTED);
  const hidden = assets.length - listed.length;
  return (
    <div role="status" className={noticeClass("attention")}>
      <p className="font-medium">Há saldos desatualizados, e isso pode distorcer o desempenho.</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {listed.map((a) => (
          <li key={a.asset_id}>
            {a.asset_name} está sem atualização há {days(a.days)} (último saldo em {formatDate(a.last_observed_date)}).
          </li>
        ))}
        {hidden > 0 && <li>E mais {hidden} {hidden === 1 ? "ativo" : "ativos"}.</li>}
      </ul>
      <p className="mt-2">
        <Link to={UPDATE_HREF} className="font-semibold underline hover:no-underline">
          Atualizar saldos
        </Link>
      </p>
    </div>
  );
}

/** Sua carteira vs. mercado: retorno acumulado, em %, a partir dos saldos digitados em cada data (ver `method`). */
export function PerformanceTab({ range }: { range: RangeKey }) {
  const [chosenScope, setScope] = useState("total");
  const [includeReserve, setIncludeReserve] = useState(false);
  const [showCdi, setShowCdi] = useState(true);
  const [showIbovespa, setShowIbovespa] = useState(ibovespaByDefault("total"));
  const [noteDismissed, dismissNote] = useDismissed("performance-method-change");

  const classes = useAssetClasses(true);
  const groups = useAssetGroups(false);
  const activeGroups = groups.data.filter((g) => !g.archived);
  // Um grupo arquivado some da lista; sem este desvio o seletor ficaria em branco e a consulta pediria um escopo sem dono.
  const scope = chosenScope.startsWith("group:") && !activeGroups.some((g) => `group:${g.id}` === chosenScope) ? "total" : chosenScope;
  const scopeGroup = activeGroups.find((g) => `group:${g.id}` === scope);
  // Pelo group_id da categoria: o desempenho do grupo também soma as arquivadas, que a lista de grupos não traz.
  const membersOf = (group: { id: number; class_ids: number[] }) =>
    (classes.data ?? []).filter((c) => (c.group_id === undefined ? group.class_ids.includes(c.id) : c.group_id === group.id));
  const performance = usePerformance({ scope, includeReserve, from: rangeStart(range) });
  const p = performance.data;
  const s = p?.summary;

  const rows = (p?.points ?? []).map((point) => ({
    date: point.date,
    value: point.value_cents,
    flows: point.flows_cents,
    Carteira: point.portfolio_bps === null ? null : point.portfolio_bps / 100,
    CDI: point.cdi_bps === null ? null : point.cdi_bps / 100,
    Ibovespa: point.ibovespa_bps === null ? null : point.ibovespa_bps / 100,
  }));
  const canChart = rows.filter((r) => r.Carteira !== null).length >= 2;
  // Com uma data só, o back-end devolve 0% (início = fim): isso não é um resultado, então mostramos "—".
  const comparable = canChart && (p?.observations_count ?? 0) >= 2;
  const metric = (bps: number | null, format: (bps: number) => string) => (bps === null || !comparable ? "—" : format(bps));
  const pct = (value: number | null) => (value === null ? "—" : formatSignedPercent(Math.round(value * 100)));
  // O aviso de Ibovespa ausente só importa com a série ligada; se o back-end já avisou, não repetimos.
  // Sem duas datas, o vazio abaixo já explica; os outros avisos não teriam o que comentar.
  const warnings = (p?.warnings ?? []).filter(
    (w) => comparable && (showIbovespa || !w.includes("Ibovespa")),
  );
  const gap =
    p && s && showIbovespa && !warnings.some((w) => w.includes("Ibovespa"))
      ? ibovespaGap([{ ibovespa_bps: s.ibovespa_bps, ibovespa_covered_through: p.ibovespa_covered_through }])
      : null;
  if (gap) warnings.push(ibovespaGapMessage(gap));

  return (
    <div id="panel-desempenho" role="tabpanel" aria-labelledby="tab-desempenho" className="space-y-6">
      <Card
        title="Sua carteira vs. mercado"
        action={<span className="text-xs text-slate-500 dark:text-slate-400">{rangeLabel(range)}</span>}
      >
        <p className="-mt-2 mb-4 text-sm text-slate-600 dark:text-slate-400">
          Retorno acumulado, a partir dos saldos que você atualiza, comparado com o CDI no mesmo período
        </p>

        <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">Escopo</span>
            <select
              className={`${inputClass} w-auto!`}
              value={scope}
              onChange={(e) => {
                // Trocar o escopo volta ao padrão dele (Ibovespa ligado só nas categorias de bolsa); a pessoa pode mudar depois.
                setScope(e.target.value);
                const group = activeGroups.find((g) => `group:${g.id}` === e.target.value);
                setShowIbovespa(ibovespaByDefault(e.target.value, group ? membersOf(group).map((c) => c.key) : undefined));
              }}
            >
              <option value="total">Carteira total</option>
              {activeGroups.length > 0 && (
                <optgroup label="Grupos de categorias">
                  {activeGroups.map((g) => (
                    <option key={g.id} value={`group:${g.id}`}>
                      Grupo {g.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {activeGroups.length > 0 ? (
                <optgroup label="Categorias">
                  {classes.data
                    ?.filter((c) => !c.archived)
                    .map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.name}
                      </option>
                    ))}
                </optgroup>
              ) : (
                classes.data
                  ?.filter((c) => !c.archived)
                  .map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))
              )}
            </select>
          </label>
          <fieldset className="flex flex-wrap items-center gap-4 pb-2 text-sm">
            <legend className="sr-only">Séries do gráfico</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={showCdi} onChange={(e) => setShowCdi(e.target.checked)} className="size-4 accent-blue-500" />
              CDI
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showIbovespa}
                onChange={(e) => setShowIbovespa(e.target.checked)}
                className="size-4 accent-blue-500"
              />
              Ibovespa
            </label>
          </fieldset>
          {scope === "total" && (
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={includeReserve}
                onChange={(e) => setIncludeReserve(e.target.checked)}
                className="size-4 accent-blue-500"
              />
              Incluir reserva
            </label>
          )}
        </div>

        {scopeGroup && (
          <p className="-mt-2 mb-4 text-xs text-slate-500 dark:text-slate-400">
            Grupo {scopeGroup.name}: soma das categorias {membersOf(scopeGroup).map((c) => c.name).join(", ") || "(nenhuma ainda)"} que fazem parte dele hoje,
            inclusive nos meses passados.
          </p>
        )}

        {performance.isLoading && <Loading />}
        <ErrorBox error={performance.error} />

        {p && s && (
          <>
            {/* Mudança de método: quem já olhava esta tela vai ver números diferentes e precisa saber por quê. */}
            {!noteDismissed && (
              <div className={`${noticeClass("info")} mb-5 flex flex-col items-start gap-1 sm:flex-row sm:gap-3`}>
                <p className="min-w-0 flex-1">
                  <strong>Mudou o jeito de calcular.</strong> O retorno da carteira e o CDI agora seguem as datas em que você atualizou os
                  saldos, e não mais os fechamentos mensais. Por isso os números podem ser diferentes dos que você via antes.
                </p>
                <button
                  type="button"
                  onClick={dismissNote}
                  className="-ml-3 min-h-10 shrink-0 rounded-lg px-3 text-sm font-medium sm:ml-0 text-blue-700 underline hover:no-underline dark:text-blue-300"
                >
                  Entendi
                </button>
              </div>
            )}

            {p.stale_assets.length > 0 && (
              <div className="mb-5">
                <StaleAssets assets={p.stale_assets} />
              </div>
            )}

            {/* Retornos na primeira linha, diferenças e fluxo na segunda (com o Ibovespa, 3 colunas; sem ele, 4). */}
            <div className={`mb-5 grid grid-cols-2 gap-3 ${showIbovespa ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
              <Metric label={p.scope_label} value={metric(s.portfolio_bps, formatSignedPercent)} hint="retorno acumulado" />
              <Metric label="CDI" value={metric(s.cdi_bps, formatSignedPercent)} hint="mesmas datas" />
              {showIbovespa && (
                <Metric label="Ibovespa" value={metric(s.ibovespa_bps, formatSignedPercent)} hint="mesmas datas" />
              )}
              <Metric label="Diferença vs. CDI" value={metric(s.vs_cdi_bps, formatPointsDiff)} />
              {showIbovespa && (
                <Metric label="Diferença vs. Ibovespa" value={metric(s.vs_ibovespa_bps, formatPointsDiff)} />
              )}
              <Metric label="Fluxo no período" value={<Flow cents={s.flows_cents} />} hint="entrou (+) ou saiu (−); não é rendimento" />
            </div>

            {!canChart && (
              <Empty>
                {p.observations_count < 2 ? (
                  <>
                    Atualize os saldos em pelo menos duas datas para comparar com o CDI. Depois disso, aqui aparecem o retorno da carteira,
                    o CDI e o valor em cada data.
                  </>
                ) : (
                  <>
                    Não há duas datas com saldo neste período para calcular o retorno. Escolha um período maior ou atualize os saldos.
                  </>
                )}
                <span className="mt-3 block">
                  <ButtonLink to={UPDATE_HREF} size="sm">
                    Atualizar saldos
                  </ButtonLink>
                </span>
              </Empty>
            )}

            {canChart && (
              <div
                className="h-80"
                role="img"
                aria-label={`Gráfico de linhas com o retorno acumulado de ${p.scope_label}${showCdi ? ", do CDI" : ""}${
                  showIbovespa ? " e do Ibovespa" : ""
                }, de ${formatDate(s.start_date ?? rows[0].date)} a ${formatDate(s.end_date ?? rows[rows.length - 1].date)}. Os mesmos dados estão na tabela abaixo.`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="date" tickFormatter={formatTickDate} stroke={AXIS} fontSize={13} />
                    <YAxis tickFormatter={(v) => `${v}%`} stroke={AXIS} fontSize={13} width={56} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(label) => formatDate(String(label))}
                      formatter={(value) => `${Number(value).toFixed(2).replace(".", ",")}%`}
                    />
                    <Legend formatter={legendText} itemSorter={(item) => LEGEND_ORDER.indexOf(String(item.dataKey))} />
                    {/* Cada série tem um traço próprio (contínuo, tracejado, traço-ponto) e a legenda repete o traço. */}
                    <Line isAnimationActive={false} dataKey="Carteira" name={p.scope_label} stroke={GOLD} strokeWidth={3} dot={{ r: 3 }} legendType="plainline" connectNulls={false} />
                    {showCdi && (
                      <Line isAnimationActive={false} dataKey="CDI" stroke="var(--color-emerald-500)" strokeWidth={2} strokeDasharray="6 4" dot={false} legendType="plainline" connectNulls={false} />
                    )}
                    {showIbovespa && (
                      <Line isAnimationActive={false} dataKey="Ibovespa" stroke={INDEX} strokeWidth={2} strokeDasharray="12 4 2 4" dot={false} legendType="plainline" connectNulls={false} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <details className="mt-4" open={!canChart && rows.length > 0}>
              <summary className="cursor-pointer text-sm font-medium text-blue-700 dark:text-blue-300">Ver os mesmos dados em tabela</summary>
              <p className="mt-2 text-xs text-slate-500 sm:hidden dark:text-slate-400">Arraste a tabela para o lado para ver todas as colunas.</p>
              {/* relative: sem isso, texto só para leitor de tela escapa da rolagem e alarga a página. */}
              <div className="relative mt-3 overflow-x-auto" role="region" aria-label="Tabela de desempenho por data" tabIndex={0}>
                <table className="w-full text-xs sm:text-sm">
                  <caption className="sr-only">
                    Valor, fluxo e retorno acumulado em cada data com saldo: {p.scope_label}, CDI{showIbovespa ? " e Ibovespa" : ""}
                  </caption>
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <tr>
                      <th scope="col" className="pb-2 font-medium">Data do saldo</th>
                      <th scope="col" className="pb-2 pl-3 text-right font-medium">{p.scope === "total" ? "Valor da carteira" : "Valor da categoria"}</th>
                      <th scope="col" className="pb-2 pl-3 text-right font-medium">Fluxo no intervalo</th>
                      <th scope="col" className="pb-2 pl-3 text-right font-medium">Retorno: {p.scope === "total" ? "Carteira" : p.scope_label}</th>
                      <th scope="col" className="pb-2 pl-3 text-right font-medium">Retorno: CDI</th>
                      {showIbovespa && <th scope="col" className="pb-2 pl-3 text-right font-medium">Retorno: Ibovespa</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rows.map((row) => (
                      <tr key={row.date}>
                        <th scope="row" className="whitespace-nowrap py-2 text-left font-medium">{formatDate(row.date)}</th>
                        <td className="tabular whitespace-nowrap py-2 pl-3 text-right"><Money cents={row.value} /></td>
                        <td className="tabular whitespace-nowrap py-2 pl-3 text-right"><Flow cents={row.flows} /></td>
                        <td className="tabular py-2 pl-3 text-right">{pct(row.Carteira)}</td>
                        <td className="tabular py-2 pl-3 text-right">{pct(row.CDI)}</td>
                        {showIbovespa && <td className="tabular py-2 pl-3 text-right">{pct(row.Ibovespa)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Fluxo no intervalo: dinheiro que entrou (+) ou saiu (−) da carteira desde a data anterior. Ele não conta como rendimento.
              </p>
            </details>

            <div className="mt-5 space-y-2">
              {warnings.map((warning) => (
                <Notice key={warning} tone="warn">{warning}</Notice>
              ))}
              {/* O texto de método é longo: fica recolhido, mas a um clique e lido por leitor de tela. */}
              <details className={noticeClass("info")}>
                <summary className="cursor-pointer font-medium">Como calculamos</summary>
                <p className="mt-2">
                  {p.method}{" "}
                  {!p.include_reserve && p.scope === "total" && "A reserva de emergência fica fora desta comparação (use “Incluir reserva” para somá-la)."}
                </p>
              </details>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Fontes: {p.benchmark_source}
                {p.benchmark_updated_at ? `, atualizadas em ${dateTime(p.benchmark_updated_at)}` : ", ainda não baixadas (Configurações → Dados e proteção)"}
                {p.cdi_covered_through ? `. CDI até ${formatDate(p.cdi_covered_through)}.` : "."}
              </p>
              {showIbovespa && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Ibovespa:{" "}
                  {p.ibovespa_covered_through
                    ? `${[p.ibovespa_source, `dados até ${formatDate(p.ibovespa_covered_through)}`].filter(Boolean).join(", ")}.`
                    : "ainda não baixado (Configurações → Dados e proteção)."}
                </p>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
