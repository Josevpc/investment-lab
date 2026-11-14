import { Link } from "react-router-dom";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GOLD, GRID, MUTED, SEPARATED, SEPARATED_LABEL } from "@/shared/lib/chart";
import { contributionsHint, estimatedContributionsText, isEstimated } from "@/shared/lib/estimate";
import { formatBRLCompact, formatDate, formatTickDate } from "@/shared/lib/format";
import { Card, Empty, ErrorBox, Loading, Money, NewAssetsNote, Notice, Stat } from "@/shared/ui";
import { ChartLegend, LegendLine } from "@/shared/ui/ChartLegend";
import { SEPARATED_PATTERN_ID, SeparatedPattern, separatedDot, SeparatedSwatch } from "@/shared/ui/SeparatedMark";
import { WealthTooltip, type WealthTooltipRow } from "@/shared/ui/WealthTooltip";
import { rangeLabel, type RangeKey } from "../lib/range";
import type { Evolution } from "../types";
import { ContributionsByMonthCard } from "./ContributionsByMonthCard";

interface Props {
  range: RangeKey;
  data: Evolution | undefined;
  loading: boolean;
  error: unknown;
}

/** Patrimônio em reais, separando o que entrou (aportes) do que valorizou. */
export function WealthTab({ range, data, loading, error }: Props) {
  // `separated` é o dinheiro separado para comprar (fora de `total`); numa API anterior a ele fica 0 e nada extra aparece.
  const points = (data?.points ?? []).map((p) => {
    const separated = p.reserved_cents ?? 0;
    return {
      date: p.date,
      Patrimônio: p.total_cents,
      Investido: p.invested_cents,
      Reserva: p.reserve_cents,
      total: p.total_cents,
      invested: p.invested_cents,
      separated,
      // Faixa do patrimônio até o patrimônio mais o separado, por cima da linha. Em intervalo (e não empilhada),
      // para o eixo não ser puxado para o zero por uma base transparente.
      band: [p.total_cents, p.total_cents + separated],
    };
  });
  const summary = data?.summary;
  const hasReserve = points.some((p) => p.Reserva > 0);
  const hasSeparated = points.some((p) => p.separated > 0);
  const separatedNow = points.length > 0 ? points[points.length - 1].separated : 0;
  const estimated = summary ? isEstimated(summary) : false;
  const archivedOut = summary?.archived_out_cents ?? 0;
  const released = summary?.released_cents ?? 0;
  const statCount =
    4 + (summary && summary.withdrawals_cents > 0 ? 1 : 0) + (archivedOut > 0 ? 1 : 0) + (released > 0 ? 1 : 0);

  return (
    <div id="panel-patrimonio" role="tabpanel" aria-labelledby="tab-patrimonio">
      <Card
        title="Evolução do patrimônio"
        action={<span className="text-xs text-slate-500 dark:text-slate-400">{rangeLabel(range)}</span>}
      >
        {loading && <Loading />}
        <ErrorBox error={error} />

        {summary && (
          // Uma coluna abaixo de 420 px: em duas, valores de sete dígitos (R$ 6.071.083,20) quebravam no meio do número.
          <div className={`mb-6 grid grid-cols-1 gap-5 min-[420px]:grid-cols-2 min-[420px]:gap-6 ${statCount >= 6 ? "lg:grid-cols-3" : statCount === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
            <Stat
              label="Variação no período"
              value={<Money cents={summary.change_cents} />}
              tone={summary.change_cents >= 0 ? "good" : "bad"}
              hint={`${formatDate(summary.start_date)} a ${formatDate(summary.end_date)}`}
            />
            <Stat label="Vindo de aportes" value={<Money cents={summary.contributions_cents} />} hint={contributionsHint(summary)} />
            {summary.withdrawals_cents > 0 && (
              <Stat
                label="Resgates"
                value={
                  <>
                    − <Money cents={summary.withdrawals_cents} />
                  </>
                }
                hint="Dinheiro que saiu da carteira para uso"
              />
            )}
            {released > 0 && (
              <Stat
                label="Separado liberado"
                value={
                  <>
                    − <Money cents={released} />
                  </>
                }
                hint="Voltou para o caixa livre sem comprar"
              />
            )}
            {archivedOut > 0 && (
              <Stat
                label="Ativos arquivados"
                value={
                  <>
                    − <Money cents={archivedOut} />
                  </>
                }
                hint="Saíram da carteira ao serem arquivados"
              />
            )}
            <Stat
              label="Vindo de valorização"
              value={<Money cents={summary.appreciation_cents} />}
              tone={summary.appreciation_cents >= 0 ? "good" : "bad"}
              hint={
                "Variação menos aportes" +
                (summary.withdrawals_cents > 0 ? ", mais resgates" : "") +
                (released > 0 ? ", mais separado liberado" : "") +
                (archivedOut > 0 ? ", mais ativos arquivados" : "") +
                (estimated ? " (estimada)" : "")
              }
            />
            <Stat
              label={separatedNow > 0 ? "Patrimônio total" : "Patrimônio atual"}
              value={<Money cents={summary.end_total_cents} />}
              hint={
                separatedNow > 0 ? (
                  <>
                    em {formatDate(summary.end_date)}, inclui <Money cents={separatedNow} /> separado, ainda não investido
                  </>
                ) : (
                  `em ${formatDate(summary.end_date)}`
                )
              }
            />
          </div>
        )}

        {summary && summary.withdrawals_cents > 0 && (
          <p className="-mt-2 mb-6 text-sm text-slate-600 dark:text-slate-300">
            Neste período, <Money cents={summary.withdrawals_cents} /> foram resgatados. Eles reduzem a variação do patrimônio, mas não são
            perda: a valorização soma esse valor de volta.
          </p>
        )}

        {released > 0 && (
          <p className="-mt-2 mb-6 text-sm text-slate-600 dark:text-slate-300">
            <Money cents={released} /> separados voltaram para o caixa livre sem virar compra. Eles reduzem a variação do patrimônio, mas
            não são perda: a valorização soma esse valor de volta.
          </p>
        )}

        {archivedOut > 0 && (
          <p className="-mt-2 mb-6 text-sm text-slate-600 dark:text-slate-300">
            <Money cents={archivedOut} /> saíram da carteira ao serem arquivados (sem resgate registrado). Eles reduzem a variação do
            patrimônio, mas não são perda: a valorização soma esse valor de volta.
          </p>
        )}

        {summary && (estimated || summary.new_assets_cents > 0) && (
          <div className="-mt-2 mb-6 space-y-2">
            {estimated && (
              <Notice>
                <strong className="font-semibold">Aportes estimados.</strong> {estimatedContributionsText(summary)}
              </Notice>
            )}
            <NewAssetsNote cents={summary.new_assets_cents} />
          </div>
        )}

        {data && points.length < 2 && (
          <Empty>
            {points.length === 0
              ? "Nenhum saldo atualizado neste período."
              : "Atualize os saldos em mais uma data para ver a evolução."}{" "}
            <Link to="/carteira/atualizar" className="font-medium text-blue-700 underline dark:text-blue-300">
              Atualizar saldos
            </Link>
          </Empty>
        )}

        {points.length >= 2 && (
          <>
            <div
              role="img"
              aria-label={`Gráfico de linhas do patrimônio e do valor investido${
                hasSeparated ? `, com a faixa hachurada "${SEPARATED_LABEL}" por cima do patrimônio nas datas em que há dinheiro separado` : ""
              }, em cada data de saldo. Os valores estão na tabela logo abaixo.`}
              className="h-80"
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  {hasSeparated && (
                    <defs>
                      <SeparatedPattern />
                    </defs>
                  )}
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={formatTickDate} stroke={AXIS} fontSize={13} />
                  <YAxis tickFormatter={formatBRLCompact} stroke={AXIS} fontSize={13} width={72} />
                  <Tooltip
                    content={(props) => (
                      <WealthTooltip active={props.active} payload={props.payload as unknown as readonly { payload?: WealthTooltipRow }[]} />
                    )}
                  />
                  {hasSeparated && (
                    <Area
                      isAnimationActive={false}
                      type="monotone"
                      dataKey="band"
                      name={SEPARATED_LABEL}
                      stroke={SEPARATED}
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      fill={`url(#${SEPARATED_PATTERN_ID})`}
                      fillOpacity={1}
                      dot={separatedDot}
                      activeDot={false}
                      legendType="none"
                    />
                  )}
                  <Line isAnimationActive={false} type="monotone" dataKey="Patrimônio" stroke={GOLD} strokeWidth={3} dot={{ r: 3 }} />
                  <Line isAnimationActive={false} type="monotone" dataKey="Investido" stroke={MUTED} strokeWidth={2} strokeDasharray="6 4" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <ChartLegend
              items={[
                { key: "patrimonio", label: "Patrimônio", swatch: <LegendLine color={GOLD} /> },
                { key: "investido", label: "Investido", swatch: <LegendLine color={MUTED} dash="6 4" width={2} /> },
                ...(hasSeparated ? [{ key: "separado", label: SEPARATED_LABEL, swatch: <SeparatedSwatch /> }] : []),
              ]}
            />
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Linha cheia: patrimônio (valor atual). Tracejada: valor investido (o que entrou). A distância entre as duas é a valorização.
              {hasSeparated &&
                " A faixa hachurada, com contorno tracejado, é o dinheiro separado para comprar: fica por cima do patrimônio e não conta como valorização."}
            </p>

            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-blue-700 dark:text-blue-300">Ver os mesmos dados em tabela</summary>
              <div
                className="relative mt-3 overflow-x-auto"
                role="region"
                aria-label={`Patrimônio, investido${hasSeparated ? ", separado" : ""} e reserva por data de saldo`}
                tabIndex={0}
              >
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Patrimônio, valor investido{hasSeparated ? ", dinheiro separado" : ""} e reserva em cada data de atualização de saldo
                  </caption>
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <tr>
                      <th scope="col" className="pb-2 font-medium">Data do saldo</th>
                      <th scope="col" className="pb-2 pl-3 text-right font-medium">Patrimônio</th>
                      <th scope="col" className="pb-2 pl-3 text-right font-medium">Investido</th>
                      {hasReserve && <th scope="col" className="pb-2 pl-3 text-right font-medium">Reserva (inclusa)</th>}
                      {hasSeparated && <th scope="col" className="pb-2 pl-3 text-right font-medium">Separado</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {points.map((p) => (
                      <tr key={p.date}>
                        <th scope="row" className="whitespace-nowrap py-2 text-left font-medium">{formatDate(p.date)}</th>
                        <td className="tabular whitespace-nowrap py-2 pl-3 text-right font-semibold"><Money cents={p.Patrimônio} /></td>
                        <td className="tabular whitespace-nowrap py-2 pl-3 text-right"><Money cents={p.Investido} /></td>
                        {hasReserve && <td className="tabular whitespace-nowrap py-2 pl-3 text-right"><Money cents={p.Reserva} /></td>}
                        {hasSeparated && <td className="tabular whitespace-nowrap py-2 pl-3 text-right"><Money cents={p.separated} /></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </Card>

      <div className="mt-6">
        <ContributionsByMonthCard range={range} />
      </div>
    </div>
  );
}
