import { useState } from "react";
import { Link } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type PieLabelRenderProps } from "recharts";
import { CATEGORICAL, MUTED, tooltipStyle } from "@/shared/lib/chart";
import { formatBRL, formatDate, formatPercent } from "@/shared/lib/format";
import { Badge, Card, Empty, ErrorBox, Loading, Money, Segmented } from "@/shared/ui";
import { useAssets, usePortfolioSummary } from "../hooks";
import { assetDistribution, groupDistribution, type Slice } from "../lib/distribution";
import { GroupDistribution } from "./GroupDistribution";

const colorOf = (slice: Slice) => (slice.slot === null ? MUTED : CATEGORICAL[slice.slot]);

/** Abaixo disso a fatia é fina demais para um rótulo ao lado dela sem esbarrar nas vizinhas. */
const LABEL_MIN_BPS = 800;

/** Rótulo só nas fatias grandes, fora do anel e em tinta de texto (a cor fica na fatia). Os demais valores vão na legenda e na tabela. */
function sliceLabel(slices: readonly Slice[]) {
  return function SliceLabel({ cx, cy, midAngle, outerRadius, index }: PieLabelRenderProps) {
    const slice = slices[index ?? -1];
    if (!slice || slice.bps < LABEL_MIN_BPS) return null;
    const angle = (-(midAngle ?? 0) * Math.PI) / 180;
    const radius = Number(outerRadius) + 14;
    const x = Number(cx) + radius * Math.cos(angle);
    const y = Number(cy) + radius * Math.sin(angle);
    return (
      <text x={x} y={y} textAnchor={x >= Number(cx) ? "start" : "end"} dominantBaseline="central" fontSize={13} className="fill-ink-2">
        {formatPercent(slice.bps)}
      </text>
    );
  };
}

/** Carteira: onde está o dinheiro hoje, ativo por ativo, em pizza (com a legenda e a tabela dizendo os mesmos números). */
export function AssetDistributionCard() {
  const query = useAssets(false);
  const portfolio = usePortfolioSummary();
  const [view, setView] = useState<"asset" | "group">("asset");
  const assets = Array.isArray(query.data) ? query.data : [];
  const { totalCents, slices, rows, asOf } = assetDistribution(assets);

  // Sem grupos (ou numa API anterior a eles), a escolha nem aparece e o cartão fica como sempre foi.
  const byGroup = portfolio.data && Array.isArray(portfolio.data.by_group) ? portfolio.data.by_group : [];
  const groupMode = view === "group" && byGroup.length > 0 && portfolio.data !== undefined;
  const investments = {
    currentCents: portfolio.data?.investments_current_cents ?? 0,
    investedCents: (portfolio.data?.total_invested_cents ?? 0) - (portfolio.data?.reserve_invested_cents ?? 0),
  };

  const summary =
    "Gráfico de pizza com a distribuição da carteira por ativo: " + slices.map((s) => `${s.label} ${formatPercent(s.bps)}${s.folded.length > 0 ? ` (${s.folded.join(", ")})` : ""}`).join("; ") + ".";

  return (
    <Card
      title={groupMode ? "Distribuição da carteira por grupo" : "Distribuição da carteira por ativo"}
      action={
        byGroup.length > 0 && (
          <Segmented
            label="Distribuir por"
            value={view}
            options={[
              { value: "asset", label: "Ativo" },
              { value: "group", label: "Grupo" },
            ]}
            onChange={setView}
          />
        )
      }
    >
      <p className="-mt-2 mb-5 text-base text-ink-2">
        {groupMode ? (
          <>
            Quanto cada grupo de categorias soma hoje, pelo valor atual. Não inclui a reserva de emergência; categorias fora de
            grupos entram em &quot;Sem grupo&quot;.
          </>
        ) : (
          <>Onde está o seu dinheiro hoje, ativo por ativo, pelo valor atual de cada um. Inclui a reserva de emergência.</>
        )}
        {asOf && ` Saldos até ${formatDate(asOf)}.`}
      </p>

      {query.isLoading && <Loading />}
      <ErrorBox error={query.error} />
      {query.isSuccess && totalCents === 0 && (
        <div className="space-y-2">
          <Empty>Cadastre ativos e atualize os saldos para ver como o seu dinheiro está distribuído.</Empty>
          <Link to="/carteira/atualizar" className="inline-flex min-h-10 items-center font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink">
            Atualizar saldos
          </Link>
        </div>
      )}

      {groupMode && <GroupDistribution rows={groupDistribution(byGroup, investments)} investmentsCents={investments.currentCents} />}

      {totalCents > 0 && !groupMode && (
        <>
          <div className="grid items-center gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <div role="img" aria-label={summary} className="relative mx-auto h-64 w-full max-w-xs">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  {/* Desenha por plotCents ("Outros" estreito sobe até o mínimo visual); a dica lê o valor real. */}
                  <Pie
                    data={slices}
                    dataKey="plotCents"
                    nameKey="label"
                    innerRadius="66%"
                    outerRadius="88%"
                    startAngle={90}
                    endAngle={-270}
                    paddingAngle={slices.length > 1 ? 3 : 0}
                    cornerRadius={4}
                    stroke="none"
                    isAnimationActive={false}
                    labelLine={false}
                    label={sliceLabel(slices)}
                  >
                    {slices.map((slice) => (
                      <Cell key={slice.key} fill={colorOf(slice)} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(_value, name, item) => [formatBRL((item.payload as Slice).cents), String(name)]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-sm text-ink-3">Total</span>
                <Money cents={totalCents} className="font-serif text-lg" />
              </div>
            </div>

            <ul aria-label="Legenda: participação de cada ativo na carteira" className="min-w-0 space-y-3 text-base">
              {slices.map((slice) => (
                <li key={slice.key} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                  <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: colorOf(slice) }} />
                  <span className="min-w-0 truncate">
                    {slice.folded.length > 0 ? "Outros" : slice.label}{" "}
                    {slice.reserve && <Badge tone="gold">reserva</Badge>}
                    {slice.folded.length > 0 && (
                      <span className="block truncate text-sm text-ink-3">
                        {slice.folded.length === 1 ? "1 ativo menor" : `${slice.folded.length} ativos menores`}: {slice.folded.join(", ")}
                      </span>
                    )}
                  </span>
                  <span className="tabular text-right">
                    <strong>{formatPercent(slice.bps)}</strong>
                    <span className="block text-sm text-ink-3">
                      <Money cents={slice.cents} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <details className="mt-5" aria-label="Tabela da distribuição por ativo">
            <summary className="inline-flex min-h-10 cursor-pointer items-center font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink">Ver os mesmos dados em tabela</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <caption className="sr-only">Valor atual e participação de cada ativo na carteira, do maior para o menor</caption>
                <thead className="text-left text-sm text-ink-3">
                  <tr>
                    <th scope="col" className="px-3 pb-2 font-normal">Ativo</th>
                    <th scope="col" className="px-3 pb-2 font-normal">Instituição</th>
                    <th scope="col" className="px-3 pb-2 font-normal">Categoria</th>
                    <th scope="col" className="px-3 pb-2 text-right font-normal">Valor atual</th>
                    <th scope="col" className="px-3 pb-2 text-right font-normal">% da carteira</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ asset, bps }) => (
                    <tr key={asset.id} className="odd:bg-raise">
                      <th scope="row" className="rounded-l-field px-3 py-2 text-left font-medium">
                        {asset.name} {asset.purpose === "reserva" && <Badge tone="gold">reserva</Badge>}
                      </th>
                      <td className="px-3 py-2 text-ink-2">{asset.institution_name}</td>
                      <td className="px-3 py-2 text-ink-2">{asset.class_name}</td>
                      <td className="tabular px-3 py-2 text-right">
                        <Money cents={asset.current_cents} />
                      </td>
                      <td className="tabular rounded-r-field px-3 py-2 text-right font-medium">{formatPercent(bps)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Card>
  );
}
