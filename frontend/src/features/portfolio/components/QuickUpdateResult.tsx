import { useAssetsPeriodVsCdi, type AssetVsCdiResult } from "@/features/analytics";
import { formatDate, formatPercent, formatPointsDiff, formatSignedPercent } from "@/shared/lib/format";
import { Button, ButtonLink, Card, cx, Money, Notice } from "@/shared/ui";
import { daysSince, totalResult, type PeriodResult } from "../lib/quickUpdate";
import type { Asset } from "../types";

/** Um ativo gravado: o que ele era antes (o `asset` vem da lista de antes de salvar) e o que passou a ser. */
export interface SavedRow {
  asset: Asset;
  balanceCents: number;
  contributionCents: number;
  result: PeriodResult;
}

/** A cor só apoia o sinal (+/-), que já está no texto. */
function tone(cents: number): string {
  if (cents === 0) return "";
  return cents > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}

/** Valor em reais com sinal explícito: "+R$ 12,30" ou "-R$ 5,00". */
export function SignedMoney({ cents }: { cents: number }) {
  return (
    <span className={tone(cents)}>
      {cents > 0 ? "+" : cents < 0 ? "-" : ""}
      <Money cents={Math.abs(cents)} />
    </span>
  );
}

/** "% do CDI" só faz sentido em renda fixa; fora dela, a diferença em pontos percentuais contra o CDI do período. */
function cdiCell(asset: Asset, result: PeriodResult, data: AssetVsCdiResult): string {
  if (asset.class_key === "renda_fixa") {
    return data.pct_of_cdi_bps === null ? "—" : `${formatPercent(data.pct_of_cdi_bps)} do CDI`;
  }
  return data.cdi_bps === null || result.returnBps === null ? "—" : formatPointsDiff(result.returnBps - data.cdi_bps);
}

/** O que o salvamento fez e o que vem a seguir: quanto cada ativo e o total renderam desde a última atualização. */
export function QuickUpdateResult({
  saved,
  date,
  unchanged,
  onAgain,
}: {
  saved: SavedRow[];
  date: string;
  /** Ativos que a pessoa não alterou e que continuam como estavam. */
  unchanged: number;
  onAgain: () => void;
}) {
  // Atualizar duas vezes no mesmo dia não tem período para comparar com o CDI.
  const periods = saved.filter((s) => daysSince(s.asset.valuation_date, date) > 0).map((s) => ({ assetId: s.asset.id, from: s.asset.valuation_date, to: date }));
  const cdiQueries = useAssetsPeriodVsCdi(periods);
  const cdiOf = (assetId: number) => cdiQueries[periods.findIndex((p) => p.assetId === assetId)];

  const total = totalResult(saved.map((s) => ({ previousCents: s.asset.current_cents, gainCents: s.result.gainCents })));

  return (
    <Card title="Saldos atualizados" className="max-w-4xl">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {saved.length} {saved.length === 1 ? "ativo atualizado" : "ativos atualizados"} em {formatDate(date)}. O rendimento já desconta os
        aportes.
      </p>

      {total && (
        <div role="group" aria-label="Total desde a última atualização" className="mt-4 grid grid-cols-2 gap-3 sm:max-w-md">
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">Rendimento desde a última atualização</p>
            <p className="tabular mt-1 font-serif text-2xl font-semibold">
              <SignedMoney cents={total.gainCents} />
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">Variação</p>
            <p className={cx("tabular mt-1 font-serif text-2xl font-semibold", tone(total.returnBps ?? 0))}>
              {total.returnBps === null ? "—" : formatSignedPercent(total.returnBps)}
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 overflow-x-auto" role="region" aria-label="Resultado por ativo" tabIndex={0}>
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Resultado da atualização: rendimento, variação e desempenho contra o CDI de cada ativo</caption>
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <tr>
              <th scope="col" className="pb-2 font-medium">Ativo</th>
              <th scope="col" className="pb-2 text-right font-medium">Saldo</th>
              <th scope="col" className="pb-2 text-right font-medium">Rendimento</th>
              <th scope="col" className="pb-2 text-right font-medium">Variação</th>
              <th scope="col" className="pb-2 text-right font-medium">Contra o CDI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {saved.map(({ asset, balanceCents, result }) => {
              const query = cdiOf(asset.id);
              return (
                <tr key={asset.id} className="align-top">
                  <th scope="row" className="py-2 text-left font-medium">
                    {asset.name}
                    <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">
                      {asset.institution_name}
                      {asset.class_key === "renda_fixa" && asset.balance_is_net && " · saldo líquido de IR"}
                    </span>
                  </th>
                  <td className="tabular whitespace-nowrap py-2 text-right">
                    <span className="text-slate-500 dark:text-slate-400"><Money cents={asset.current_cents} /> →</span> <Money cents={balanceCents} />
                  </td>
                  <td className="tabular whitespace-nowrap py-2 text-right font-medium">
                    <SignedMoney cents={result.gainCents} />
                  </td>
                  <td className={cx("tabular whitespace-nowrap py-2 text-right font-medium", tone(result.returnBps ?? 0))}>
                    {result.returnBps === null ? "—" : formatSignedPercent(result.returnBps)}
                  </td>
                  <td className="tabular whitespace-nowrap py-2 text-right">
                    {!query ? (
                      "—"
                    ) : query.isPending ? (
                      <span className="text-slate-500 dark:text-slate-400">calculando…</span>
                    ) : query.data ? (
                      <>
                        <span className="font-medium">{cdiCell(asset, result, query.data)}</span>
                        {query.data.cdi_bps !== null && (
                          <span className="block text-xs text-slate-500 dark:text-slate-400">CDI no período {formatSignedPercent(query.data.cdi_bps)}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">indisponível</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 space-y-2">
        {unchanged > 0 && (
          <Notice>
            {unchanged === 1 ? "1 ativo não mudou e ficou como estava." : `${unchanged} ativos não mudaram e ficaram como estavam.`}
          </Notice>
        )}
        <Notice>
          Em períodos curtos, como uma semana, centavos e o dia do aporte pesam no % do CDI: use como referência, não como certeza.
        </Notice>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <ButtonLink to="/historico?aba=desempenho">Ver desempenho</ButtonLink>
        <Button variant="secondary" onClick={onAgain}>
          Atualizar mais saldos
        </Button>
        <ButtonLink to="/carteira/fechamento" variant="ghost">
          Fazer o fechamento do mês
        </ButtonLink>
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        No fim do mês, o fechamento guarda uma foto da carteira no Histórico.
      </p>
    </Card>
  );
}
