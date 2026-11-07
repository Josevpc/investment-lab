import { IrRateSelect, ibovespaGap, ibovespaGapMessage, useAssetsVsCdi, useIrRate, type AssetVsCdiResult } from "@/features/analytics";
import { formatDate, formatPercent, formatPointsDiff, formatSignedPercent } from "@/shared/lib/format";
import { Badge, Card, cx, Empty, ErrorBox, Loading, Money, Notice } from "@/shared/ui";
import { rangeLabel, rangeStart, type RangeKey } from "../lib/range";

/** A cor só apoia o sinal (+/−) que já está no texto. */
function diffTone(bps: number | null): string {
  if (bps === null || bps === 0) return "";
  return bps > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}

const FIXED_COLUMNS = 7;

/** Como o saldo digitado se relaciona com o IR: isento, tributado com saldo bruto ou tributado com saldo já líquido. */
function taxKind(a: AssetVsCdiResult): "exempt" | "gross" | "net" {
  return a.tax_exempt ? "exempt" : a.balance_is_net ? "net" : "gross";
}

/** De onde sai o número da coluna "% do CDI líquido": mostra a conta, não só o resultado. */
function netBasis(a: AssetVsCdiResult): string | null {
  switch (taxKind(a)) {
    case "exempt":
      return "sem IR";
    case "net":
      return "saldo já líquido";
    default:
      return a.ir_rate_bps === null ? null : `IR de ${formatPercent(a.ir_rate_bps)}`;
  }
}

function FixedIncomeRow({ a }: { a: AssetVsCdiResult }) {
  const basis = netBasis(a);
  return (
    <tr>
      <th scope="row" className="sticky left-0 min-w-36 bg-card py-2 pr-3 text-left font-medium">
        {a.asset_name}
        <span className="mt-0.5 block text-xs font-normal text-ink-3">
          {a.tax_exempt ? <Badge tone="good">Isento de IR</Badge> : a.balance_is_net ? "saldo líquido de IR" : "saldo bruto"}
        </span>
      </th>
      {/* Destaque: é a única coluna que compara isentos e tributados na mesma régua. Logo depois do ativo, para
          aparecer no celular sem rolar a tabela. */}
      <td className="tabular bg-gold-t px-3 py-2 text-right text-ink">
        <span className="font-semibold">{a.net_pct_of_cdi_bps === null ? "—" : formatPercent(a.net_pct_of_cdi_bps)}</span>
        {basis && <span className="block text-xs text-ink-2">{basis}</span>}
      </td>
      <td className="tabular whitespace-nowrap py-2 pr-3 text-ink-2">
        {a.start_date && a.end_date ? `${formatDate(a.start_date)} → ${formatDate(a.end_date)}` : "—"}
      </td>
      <td className="tabular py-2 pr-3 text-right">
        <Money cents={a.yield_cents ?? 0} />
        {a.return_bps !== null && <span className="block text-xs text-ink-3">{formatSignedPercent(a.return_bps)}</span>}
      </td>
      <td className="tabular py-2 pr-3 text-right">
        {a.cdi_bps === null ? "—" : formatSignedPercent(a.cdi_bps)}
        {a.net_cdi_bps !== null && <span className="block text-xs text-ink-3">CDI líquido {formatSignedPercent(a.net_cdi_bps)}</span>}
      </td>
      <td className="tabular py-2 pr-3 text-right">{formatPercent(a.pct_of_cdi_bps ?? 0)}</td>
      <td className="tabular py-2 pl-3 text-right">
        {a.contracted_pct_bps === null ? (
          "—"
        ) : (
          <>
            {formatPercent(a.contracted_pct_bps)}
            {a.vs_contracted_bps !== null && <span className="block text-xs text-ink-3">{formatPointsDiff(a.vs_contracted_bps)}</span>}
          </>
        )}
      </td>
    </tr>
  );
}

/** Cada ativo contra o CDI no período escolhido (os saldos mais próximos das datas do período). */
export function AssetsVsCdiCard({ range }: { range: RangeKey }) {
  const [irRate, setIrRate] = useIrRate();
  const query = useAssetsVsCdi(rangeStart(range), irRate);
  const all = query.data ?? [];
  const fixed = all.filter((a) => a.class_key === "renda_fixa");
  const measured = fixed.filter((a) => a.pct_of_cdi_bps !== null);
  const others = all.filter((a) => a.class_key !== "renda_fixa" && a.return_bps !== null && a.cdi_bps !== null);
  const missing = fixed.length - measured.length;
  // Isentos e tributados lado a lado só se comparam pela coluna líquida: a nota aparece quando há mais de um tipo.
  const mixesTaxKinds = new Set(measured.map(taxKind)).size > 1;
  const groups = [
    { id: "exempt", title: "Isentos de IR", rows: measured.filter((a) => a.tax_exempt) },
    { id: "taxed", title: "Tributados", rows: measured.filter((a) => !a.tax_exempt) },
  ].filter((group) => group.rows.length > 0);
  const hasGroups = groups.length > 1;
  const onlyTaxed = groups.length === 1 && groups[0].id === "taxed";
  const irSource = measured.find((a) => a.ir_rates_source)?.ir_rates_source;
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
          Quanto % do CDI cada ativo rendeu, a partir dos saldos que você digitou e dos aportes com data. A coluna % do CDI líquido compara
          tudo depois do IR, inclusive os isentos. Para escolher o período de um ativo, abra o ativo em Carteira → Desempenho vs. CDI.
        </p>
        {query.isLoading && <Loading />}
        <ErrorBox error={query.error} />
        {query.data && measured.length === 0 && (
          <Empty>{firstWarning ?? "Ainda não há dois saldos de um mesmo ativo de renda fixa para medir o rendimento."}</Empty>
        )}
        {measured.length > 0 && (
          <>
            <IrRateSelect className="mb-4" value={irRate} onChange={setIrRate} />
            <p className="mb-2 text-xs text-slate-500 sm:hidden dark:text-slate-400">Arraste a tabela para o lado para ver todas as colunas.</p>
            <div
              className={cx("relative overflow-x-auto", query.isPlaceholderData && "opacity-60")}
              role="region"
              aria-label="Rendimento de cada ativo de renda fixa"
              aria-busy={query.isFetching}
              tabIndex={0}
            >
              <table className="w-full min-w-[52rem] text-sm">
                <caption className="sr-only">
                  Rendimento de cada ativo de renda fixa contra o CDI no período, com o % do CDI depois do IR na alíquota de{" "}
                  {formatPercent(irRate)}
                </caption>
                <thead className="text-left text-xs uppercase tracking-wide text-ink-3">
                  <tr>
                    <th scope="col" className="sticky left-0 bg-card pb-2 pr-3 font-medium">Ativo</th>
                    <th scope="col" className="bg-gold-t px-3 pb-2 pt-2 text-right font-semibold text-ink">% do CDI líquido</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Período</th>
                    <th scope="col" className="pb-2 pr-3 text-right font-medium">Rendimento</th>
                    <th scope="col" className="pb-2 pr-3 text-right font-medium">CDI no período</th>
                    <th scope="col" className="pb-2 pr-3 text-right font-medium">% do CDI</th>
                    <th scope="col" className="pb-2 pl-3 text-right font-medium">Contratado</th>
                  </tr>
                </thead>
                {groups.map((group) => (
                  <tbody key={group.id} className="divide-y divide-slate-100 dark:divide-slate-800">
                    {hasGroups && (
                      <tr>
                        <th scope="rowgroup" colSpan={FIXED_COLUMNS} className="pb-1 pt-4 text-left text-sm font-semibold text-ink">
                          {group.title}
                        </th>
                      </tr>
                    )}
                    {group.rows.map((a) => (
                      <FixedIncomeRow key={a.asset_id} a={a} />
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
            {(onlyTaxed || irSource) && (
              <p className="mt-3 text-xs text-ink-3">
                {onlyTaxed && "Nenhum ativo isento de IR marcado. Marque os isentos em Carteira → editar ativo. "}
                {irSource && `Fonte: ${irSource.replace(/\.$/, "")}.`}
              </p>
            )}
          </>
        )}
        {mixesTaxKinds && (
          <div className="mt-3">
            <Notice>
              Para comparar isentos e tributados, use a coluna % do CDI líquido. É uma simulação com a alíquota escolhida; o app não calcula
              o IR devido.
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
