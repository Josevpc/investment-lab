import { ibovespaGap, ibovespaGapMessage, useAssetsVsCdi } from "@/features/analytics";
import { formatDate, formatPercent, formatPointsDiff, formatSignedPercent } from "@/shared/lib/format";
import { Card, Empty, ErrorBox, Loading, Money, Notice } from "@/shared/ui";
import { rangeLabel, rangeStart, type RangeKey } from "../lib/range";

/** A cor só apoia o sinal (+/−) que já está no texto. */
function diffTone(bps: number | null): string {
  if (bps === null || bps === 0) return "";
  return bps > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}

/** Cada ativo contra o CDI no período escolhido (os saldos mais próximos das datas do período). */
export function AssetsVsCdiCard({ range }: { range: RangeKey }) {
  const query = useAssetsVsCdi(rangeStart(range));
  const all = query.data ?? [];
  const fixed = all.filter((a) => a.class_key === "renda_fixa");
  const measured = fixed.filter((a) => a.pct_of_cdi_bps !== null);
  const others = all.filter((a) => a.class_key !== "renda_fixa" && a.return_bps !== null && a.cdi_bps !== null);
  const missing = fixed.length - measured.length;
  // Saldo líquido rende menos que o bruto por causa do IR: lado a lado, o % do CDI engana.
  const mixesTaxBasis = new Set(measured.map((a) => a.balance_is_net)).size > 1;
  // Um aviso só para a tabela inteira, em vez de repetir o motivo em cada linha sem Ibovespa.
  const gap = ibovespaGap(others);
  const firstWarning = fixed.find((a) => a.pct_of_cdi_bps === null && a.warnings.length > 0)?.warnings[0];

  return (
    <>
      <Card
        title="Renda fixa frente ao CDI"
        action={<span className="text-xs text-slate-500 dark:text-slate-400">{rangeLabel(range)}</span>}
      >
        <p className="-mt-2 mb-4 text-sm text-slate-600 dark:text-slate-400">
          Quanto % do CDI cada ativo rendeu, a partir dos saldos que você digitou (como estão na conta, brutos ou líquidos de IR) e dos
          aportes com data. Para escolher o período de um ativo, abra o ativo em Carteira → Desempenho vs. CDI.
        </p>
        {query.isLoading && <Loading />}
        <ErrorBox error={query.error} />
        {query.data && measured.length === 0 && (
          <Empty>{firstWarning ?? "Ainda não há dois saldos de um mesmo ativo de renda fixa para medir o rendimento."}</Empty>
        )}
        {measured.length > 0 && (
          <>
            <p className="mb-2 text-xs text-slate-500 sm:hidden dark:text-slate-400">Arraste a tabela para o lado para ver todas as colunas.</p>
            <div className="relative overflow-x-auto" role="region" aria-label="Rendimento de cada ativo de renda fixa" tabIndex={0}>
            <table className="w-full text-sm">
              <caption className="sr-only">Rendimento de cada ativo de renda fixa contra o CDI no período</caption>
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <tr>
                  <th scope="col" className="pb-2 font-medium">Ativo</th>
                  <th scope="col" className="pb-2 font-medium">Período</th>
                  <th scope="col" className="pb-2 text-right font-medium">Rendimento</th>
                  <th scope="col" className="pb-2 text-right font-medium">CDI no período</th>
                  <th scope="col" className="pb-2 text-right font-medium">% do CDI</th>
                  <th scope="col" className="pb-2 text-right font-medium">Contratado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {measured.map((a) => (
                  <tr key={a.asset_id}>
                    <th scope="row" className="min-w-36 py-2 pr-3 text-left font-medium">
                      {a.asset_name}
                      <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">
                        {a.balance_is_net ? "saldo líquido de IR" : "saldo bruto"}
                      </span>
                    </th>
                    <td className="tabular whitespace-nowrap py-2 pr-3 text-slate-600 dark:text-slate-400">
                      {a.start_date && a.end_date ? `${formatDate(a.start_date)} → ${formatDate(a.end_date)}` : "—"}
                    </td>
                    <td className="tabular py-2 text-right">
                      <Money cents={a.yield_cents ?? 0} />
                      {a.return_bps !== null && (
                        <span className="block text-xs text-slate-500 dark:text-slate-400">{formatSignedPercent(a.return_bps)}</span>
                      )}
                    </td>
                    <td className="tabular py-2 text-right">{a.cdi_bps === null ? "—" : formatSignedPercent(a.cdi_bps)}</td>
                    <td className="tabular py-2 text-right font-semibold">{formatPercent(a.pct_of_cdi_bps ?? 0)}</td>
                    <td className="tabular py-2 text-right">
                      {a.contracted_pct_bps === null ? (
                        "—"
                      ) : (
                        <>
                          {formatPercent(a.contracted_pct_bps)}
                          {a.vs_contracted_bps !== null && (
                            <span className="block text-xs text-slate-500 dark:text-slate-400">{formatPointsDiff(a.vs_contracted_bps)}</span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
        {mixesTaxBasis && (
          <div className="mt-3">
            <Notice tone="warn">
              Esta tabela mistura saldos brutos e líquidos de IR. O % do CDI de um ativo líquido sai menor e não é comparável ao de um
              bruto: compare só ativos com o mesmo tipo de saldo. O app não calcula imposto. Para corrigir a marca, edite o ativo em
              Carteira.
            </Notice>
          </div>
        )}
        {missing > 0 && measured.length > 0 && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {missing} {missing === 1 ? "ativo ficou" : "ativos ficaram"} de fora por falta de saldos no período.
          </p>
        )}
      </Card>

      {others.length > 0 && (
        <Card
          title="Renda variável e cripto frente ao CDI e ao Ibovespa"
          action={<span className="text-xs text-slate-500 dark:text-slate-400">{rangeLabel(range)}</span>}
        >
          <p className="-mt-2 mb-2 text-sm text-slate-600 dark:text-slate-400">
            Aqui não faz sentido falar em &quot;% do CDI&quot;: mostramos a variação do ativo no período contra o CDI acumulado e contra o
            Ibovespa nas mesmas datas. Dividendos e rendimentos pagos aparecem à parte, porque não entram no saldo.
          </p>
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
            O Ibovespa é a referência da bolsa brasileira; para cripto e ativos no exterior ele serve só como comparação geral.
          </p>
          {gap && (
            <div className="mb-4">
              <Notice tone="warn">{ibovespaGapMessage(gap)}</Notice>
            </div>
          )}
          <p className="mb-2 text-xs text-slate-500 sm:hidden dark:text-slate-400" aria-hidden="true">
            Arraste a tabela para o lado para ver CDI e Ibovespa →
          </p>
          <div
            className="overflow-x-auto"
            role="region"
            aria-label="Tabela de renda variável e cripto (role para o lado para ver todas as colunas)"
            tabIndex={0}
          >
            <table className="w-full min-w-[46rem] text-sm">
              <caption className="sr-only">
                Variação de ativos de renda variável e cripto contra o CDI e contra o Ibovespa no período, com a diferença em pontos
                percentuais
              </caption>
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <tr>
                  <th scope="col" className="sticky left-0 bg-white pb-2 pr-3 font-medium dark:bg-slate-900">Ativo</th>
                  <th scope="col" className="pb-2 font-medium">Período</th>
                  <th scope="col" className="pb-2 text-right font-medium">Variação</th>
                  <th scope="col" className="pb-2 text-right font-medium">Proventos</th>
                  <th scope="col" className="pb-2 text-right font-medium">CDI no período</th>
                  <th scope="col" className="pb-2 text-right font-medium">Diferença vs. CDI</th>
                  <th scope="col" className="pb-2 text-right font-medium">Ibovespa no período</th>
                  <th scope="col" className="pb-2 text-right font-medium">Diferença vs. Ibovespa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {others.map((a) => {
                  const diff = (a.return_bps ?? 0) - (a.cdi_bps ?? 0);
                  return (
                    <tr key={a.asset_id}>
                      {/* O nome fica preso à esquerda ao rolar no celular, para as diferenças não perderem o ativo. */}
                      <th scope="row" className="sticky left-0 bg-white py-2 pr-3 text-left font-medium dark:bg-slate-900">
                        {a.asset_name}
                      </th>
                      <td className="tabular py-2 text-slate-600 dark:text-slate-400">
                        {a.start_date && a.end_date ? `${formatDate(a.start_date)} → ${formatDate(a.end_date)}` : "—"}
                      </td>
                      <td className="tabular py-2 text-right">
                        <Money cents={a.yield_cents ?? 0} />
                        <span className="block text-xs text-slate-500 dark:text-slate-400">{formatSignedPercent(a.return_bps ?? 0)}</span>
                      </td>
                      <td className="tabular py-2 text-right">{a.proventos_cents > 0 ? <Money cents={a.proventos_cents} /> : "—"}</td>
                      <td className="tabular py-2 text-right">{formatSignedPercent(a.cdi_bps ?? 0)}</td>
                      <td className={`tabular py-2 text-right font-semibold ${diffTone(diff)}`}>{formatPointsDiff(diff)}</td>
                      <td className="tabular py-2 text-right">{a.ibovespa_bps === null ? "—" : formatSignedPercent(a.ibovespa_bps)}</td>
                      <td className={`tabular py-2 text-right font-semibold ${diffTone(a.vs_ibovespa_bps)}`}>
                        {a.vs_ibovespa_bps === null ? "—" : formatPointsDiff(a.vs_ibovespa_bps)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
