import { useState } from "react";
import { formatBRL, formatDate, formatPercent, formatPointsDiff, formatSignedPercent } from "@/shared/lib/format";
import { Button, Empty, ErrorBox, Loading, Money, Notice } from "@/shared/ui";
import { useAssetVsCdi, useIrRate } from "../hooks";
import { benchmarkGap, benchmarkGapMessage } from "../lib/benchmarks";
import type { AssetFlow, AssetVsCdi as AssetVsCdiData } from "../types";
import { IrRateSelect } from "./IrRateSelect";

const FLOW_LABEL: Record<AssetFlow["kind"], string> = {
  aporte: "Aporte",
  transferencia_entrada: "Transferência recebida",
  transferencia_saida: "Transferência enviada",
  provento_creditado: "Provento creditado",
  resgate: "Resgate",
};

function Metric({ label, value, hint, strong, small }: { label: string; value: string; hint?: string; strong?: boolean; small?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`tabular mt-1 font-serif font-semibold ${strong ? "text-3xl text-blue-700 dark:text-blue-300" : small ? "text-base" : "text-2xl"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950/60";

/** De onde sai o "% do CDI líquido": isento, saldo já líquido ou saldo bruto com a alíquota escolhida. */
function netPctHint(p: AssetVsCdiData): string {
  const rate = p.ir_rate_bps === null ? null : formatPercent(p.ir_rate_bps);
  if (p.tax_exempt) return rate ? `isento de IR · CDI líquido com IR de ${rate}` : "isento de IR";
  if (p.balance_is_net) return rate ? `saldo já líquido · CDI líquido com IR de ${rate}` : "saldo já líquido";
  return rate ? `rendimento e CDI com IR de ${rate} (simulação)` : "";
}

/**
 * Quanto % do CDI o ativo rendeu. O período padrão é o total (do primeiro ao último saldo digitado);
 * dá para escolher qualquer par de saldos como início e fim.
 */
export function AssetVsCdi({ assetId }: { assetId: number }) {
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [irRate, setIrRate] = useIrRate();
  const query = useAssetVsCdi(assetId, from ?? undefined, to ?? undefined, irRate);
  const p = query.data;
  const custom = from !== null || to !== null;
  // Fora da renda fixa há uma referência de mercado: o dólar para a cripto, o Ibovespa para o resto.
  const fixedIncome = p?.class_key === "renda_fixa";
  const crypto = p?.class_key === "cripto";
  const reference = crypto
    ? { key: "usd" as const, name: "dólar", bps: p?.usd_bps ?? null, diff: p?.vs_usd_bps ?? null, through: p?.usd_covered_through ?? null }
    : { key: "ibovespa" as const, name: "Ibovespa", bps: p?.ibovespa_bps ?? null, diff: p?.vs_ibovespa_bps ?? null, through: p?.ibovespa_covered_through ?? null };
  const gap = p && !fixedIncome ? benchmarkGap([{ bps: reference.bps, through: reference.through }]) : null;

  return (
    <div className="space-y-4">
      {query.isLoading && <Loading />}
      <ErrorBox error={query.error} />

      {fixedIncome && <IrRateSelect value={irRate} onChange={setIrRate} />}

      {p && p.dates.length >= 2 && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">Saldo inicial</span>
            <select
              className={selectClass}
              value={p.start_date ?? ""}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Data do saldo inicial"
            >
              {p.dates.slice(0, -1).map((d) => (
                <option key={d} value={d}>
                  {formatDate(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">Saldo final</span>
            <select
              className={selectClass}
              value={p.end_date ?? ""}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Data do saldo final"
            >
              {p.dates.slice(1).map((d) => (
                <option key={d} value={d}>
                  {formatDate(d)}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            disabled={!custom}
            onClick={() => {
              setFrom(null);
              setTo(null);
            }}
          >
            Período total
          </Button>
        </div>
      )}

      {p && p.pct_of_cdi_bps === null && p.warnings.length === 0 && <Empty>Sem dados para medir este período.</Empty>}

      {p && p.start_date && p.end_date && (
        <>
          {/* Fica numa gaveta estreita: 5 colunas apertariam "−2,95 p.p."; com a referência (Ibovespa ou dólar), 3 + 2. */}
          <div className={`grid grid-cols-2 gap-3 ${fixedIncome ? "lg:grid-cols-3" : "sm:grid-cols-3"}`}>
            {fixedIncome ? (
              <>
                <Metric
                  label="% do CDI realizado"
                  strong
                  value={p.pct_of_cdi_bps === null ? "—" : formatPercent(p.pct_of_cdi_bps)}
                  hint={
                    p.contracted_pct_bps !== null
                      ? `contratado: ${formatPercent(p.contracted_pct_bps)}` +
                        (p.vs_contracted_bps !== null ? ` (${formatPointsDiff(p.vs_contracted_bps)} do CDI)` : "")
                      : "ativo sem % do CDI informado"
                  }
                />
                <Metric
                  label="% do CDI líquido"
                  strong
                  value={p.net_pct_of_cdi_bps === null ? "—" : formatPercent(p.net_pct_of_cdi_bps)}
                  hint={netPctHint(p)}
                />
              </>
            ) : (
              <Metric
                label="Variação contra o CDI"
                strong
                value={p.return_bps === null || p.cdi_bps === null ? "—" : formatPointsDiff(p.return_bps - p.cdi_bps)}
                hint={`variação ${p.return_bps === null ? "—" : formatSignedPercent(p.return_bps)} contra CDI ${p.cdi_bps === null ? "—" : formatSignedPercent(p.cdi_bps)}`}
              />
            )}
            {!fixedIncome && (
              <Metric
                label={`Variação contra o ${reference.name}`}
                value={reference.diff === null ? "—" : formatPointsDiff(reference.diff)}
                hint={
                  gap
                    ? p.warnings.some((w) => w.toLowerCase().includes(reference.name.toLowerCase()))
                      ? `sem ${reference.name} no período: veja o aviso abaixo`
                      : benchmarkGapMessage(reference.key, gap)
                    : `variação ${p.return_bps === null ? "—" : formatSignedPercent(p.return_bps)} contra ${reference.name} ${reference.bps === null ? "—" : formatSignedPercent(reference.bps)}`
                }
              />
            )}
            <Metric label="Rendimento no período" value={p.yield_cents === null ? "—" : formatBRL(p.yield_cents)} hint={p.return_bps === null ? undefined : `${formatSignedPercent(p.return_bps)} sobre o capital`} />
            <Metric label="CDI no período" value={p.cdi_bps === null ? "—" : formatSignedPercent(p.cdi_bps)} hint="acumulado dia a dia" />
            {fixedIncome && (
              <Metric
                label="CDI líquido no período"
                value={p.net_cdi_bps === null ? "—" : formatSignedPercent(p.net_cdi_bps)}
                hint={p.ir_rate_bps === null ? undefined : `CDI depois de IR de ${formatPercent(p.ir_rate_bps)} (simulação)`}
              />
            )}
            <Metric small label="Período" value={`${formatDate(p.start_date)} → ${formatDate(p.end_date)}`} hint={custom ? "período escolhido" : "período total"} />
          </div>

          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500 dark:text-slate-400">Saldo inicial</dt>
              <dd className="tabular font-medium">
                <Money cents={p.start_cents ?? 0} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500 dark:text-slate-400">Saldo final</dt>
              <dd className="tabular font-medium">
                <Money cents={p.end_cents ?? 0} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500 dark:text-slate-400">Entradas e saídas no período</dt>
              <dd className="tabular font-medium">
                <Money cents={p.flows_cents} />
              </dd>
            </div>
            {p.proventos_cents > 0 && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">Proventos recebidos (fora do saldo)</dt>
                <dd className="tabular font-medium">
                  <Money cents={p.proventos_cents} />
                </dd>
              </div>
            )}
          </dl>

          {p.flows.length > 0 && (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {p.flows.map((f, i) => (
                <li key={`${f.date}-${i}`} className="flex justify-between gap-3 py-1.5">
                  <span>
                    {FLOW_LABEL[f.kind]} <span className="tabular text-slate-500 dark:text-slate-400">em {formatDate(f.date)}</span>
                  </span>
                  <span className="tabular font-medium">
                    <Money cents={f.cents} />
                  </span>
                </li>
              ))}
            </ul>
          )}

          {p.steps.length > 1 && (
            // Rede de segurança: se ainda não couber (valores muito grandes), a rolagem fica no quadro e dá para rolar pelo teclado.
            <div className="overflow-x-auto" role="region" aria-label="Rendimento por intervalo" tabIndex={0}>
              <table className="w-full text-sm">
                <caption className="mb-1 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Por intervalo</caption>
                {fixedIncome ? (
                  <>
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <tr>
                        <th scope="col" className="pb-2 font-medium">Intervalo</th>
                        <th scope="col" className="pb-2 pl-3 text-right font-medium">Rendimento</th>
                        <th scope="col" className="pb-2 pl-3 text-right font-medium">CDI</th>
                        <th scope="col" className="pb-2 pl-3 text-right font-medium">% do CDI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {p.steps.map((s) => (
                        <tr key={s.start_date}>
                          <th scope="row" className="py-2 text-left font-normal">
                            {formatDate(s.start_date)} → {formatDate(s.end_date)}
                          </th>
                          <td className="tabular whitespace-nowrap py-2 pl-3 text-right">
                            <Money cents={s.yield_cents} />
                          </td>
                          <td className="tabular whitespace-nowrap py-2 pl-3 text-right">{s.cdi_bps === null ? "—" : formatSignedPercent(s.cdi_bps)}</td>
                          <td className="tabular whitespace-nowrap py-2 pl-3 text-right font-medium">
                            {s.pct_of_cdi_bps === null ? "—" : formatPercent(s.pct_of_cdi_bps)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                ) : (
                  <>
                    {/* "% do CDI" (k × CDI) só faz sentido em renda fixa: num mês de −3% em ações daria "−300% do CDI".
                        Fora dela, a mesma leitura do card do topo: variação e diferença em p.p. No celular ficam só
                        Intervalo e "Contra o CDI"; rendimento, variação e CDI descem para uma linha sob o intervalo. */}
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <tr>
                        <th scope="col" className="pb-2 font-medium">Intervalo</th>
                        <th scope="col" className="hidden pb-2 pl-3 text-right font-medium sm:table-cell">Rendimento</th>
                        <th scope="col" className="hidden pb-2 pl-3 text-right font-medium sm:table-cell">Variação</th>
                        <th scope="col" className="hidden pb-2 pl-3 text-right font-medium sm:table-cell">CDI</th>
                        <th scope="col" className="pb-2 pl-3 text-right font-medium">Contra o CDI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {p.steps.map((s) => {
                        const variation = s.return_bps === null ? "—" : formatSignedPercent(s.return_bps);
                        const cdi = s.cdi_bps === null ? "—" : formatSignedPercent(s.cdi_bps);
                        return (
                          <tr key={s.start_date} className="align-top">
                            <th scope="row" className="py-2 text-left font-normal">
                              <span className="whitespace-nowrap">
                                {formatDate(s.start_date)} → {formatDate(s.end_date)}
                              </span>
                              <span className="tabular mt-0.5 block text-xs text-slate-500 sm:hidden dark:text-slate-400">
                                <span className="whitespace-nowrap">
                                  Rendimento <Money cents={s.yield_cents} />
                                </span>
                                {" · "}
                                <span className="whitespace-nowrap">Variação {variation}</span>
                                {" · "}
                                <span className="whitespace-nowrap">CDI {cdi}</span>
                              </span>
                            </th>
                            <td className="tabular hidden whitespace-nowrap py-2 pl-3 text-right sm:table-cell">
                              <Money cents={s.yield_cents} />
                            </td>
                            <td className="tabular hidden whitespace-nowrap py-2 pl-3 text-right sm:table-cell">{variation}</td>
                            <td className="tabular hidden whitespace-nowrap py-2 pl-3 text-right sm:table-cell">{cdi}</td>
                            <td className="tabular whitespace-nowrap py-2 pl-3 text-right font-medium">
                              {s.return_bps === null || s.cdi_bps === null ? "—" : formatPointsDiff(s.return_bps - s.cdi_bps)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          )}
        </>
      )}

      {crypto && p?.start_date && (
        // O dólar mostra quanto do ganho em reais pode ter vindo só do câmbio, mas não é uma conta exata.
        <Notice>
          O dólar (PTAX) é só uma referência. Sem a cotação em dólar de cada moeda, não dá para separar o que veio da cripto do que veio do
          câmbio.
        </Notice>
      )}
      {p?.tax_exempt && <Notice>Isento de IR: o saldo bruto já é o que você recebe.</Notice>}
      {p?.balance_is_net && (
        <Notice>
          O saldo deste ativo já vem sem o IR, então o % do CDI realizado sai menor do que sairia com o saldo bruto e não é comparável ao de
          um ativo com saldo bruto. Compare pela linha &quot;% do CDI líquido&quot;, que não desconta o imposto de novo. O app não calcula
          imposto. Para mudar, edite o ativo e escolha &quot;Tributado, saldo bruto&quot;.
        </Notice>
      )}
      {p?.warnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}
      {p && p.start_date && (
        <Notice>
          <strong>Como calculamos:</strong> {p.method} Em períodos curtos e com valores pequenos, centavos e o dia do aporte pesam: use o
          resultado como referência, não como certeza.
          {p.cdi_covered_through && ` CDI diário até ${formatDate(p.cdi_covered_through)}.`}
          {!fixedIncome && reference.through && ` ${crypto ? "Dólar" : "Ibovespa"} até ${formatDate(reference.through)}.`}
        </Notice>
      )}
    </div>
  );
}
