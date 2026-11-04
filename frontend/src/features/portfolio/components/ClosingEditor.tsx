import { Fragment, useId, useState } from "react";
import { useAccounts } from "@/features/cash";
import { centsToInput, formatBRL, todayISO } from "@/shared/lib/format";
import { Button, cx, ErrorBox, Field, inputClass } from "@/shared/ui";
import { useSaveClosing } from "../hooks";
import { cashLink, cashUseProblem } from "../lib/cashLink";
import { previewClosing, type ClosingInput } from "../lib/closing";
import { parseQuantity, valueFromQuote } from "../lib/quote";
import type { Asset } from "../types";
import { CashContributionNote } from "./CashContributionNote";
import { FetchQuoteButton } from "./FetchQuoteButton";

/** Fechamento do mês: aporte e saldo de cada ativo. O investido e o rendimento são calculados. */
export function ClosingEditor({ assets, onDone }: { assets: Asset[]; onDone: () => void }) {
  const save = useSaveClosing();
  const [date, setDate] = useState(todayISO());
  const [fixInvested, setFixInvested] = useState(false);
  const [inputs, setInputs] = useState<Record<number, Partial<ClosingInput>>>({});
  // Por ativo: o aporte sai do caixa que já está na conta (em vez de entrar como dinheiro novo).
  const [useCash, setUseCash] = useState<Record<number, boolean>>({});
  const accounts = useAccounts();
  const reasonBase = useId();

  const inputOf = (asset: Asset): ClosingInput => ({
    contribution: inputs[asset.id]?.contribution ?? "",
    contributionDate: inputs[asset.id]?.contributionDate ?? "",
    balance: inputs[asset.id]?.balance ?? centsToInput(asset.current_cents),
    quote: inputs[asset.id]?.quote ?? "",
    investedOverride: fixInvested ? (inputs[asset.id]?.investedOverride ?? centsToInput(asset.invested_cents)) : null,
  });

  const edit = (asset: Asset, patch: Partial<ClosingInput>) =>
    setInputs((current) => ({ ...current, [asset.id]: { ...current[asset.id], ...patch } }));

  const rows = assets.map((asset) => {
    const preview = previewClosing(asset, inputOf(asset), date);
    const link = cashLink(asset.account_id, accounts.data ?? [], preview.contributionDate || date);
    const takesCash = Boolean(useCash[asset.id]) && link.kind === "ledger" && preview.contributionCents > 0;
    return { asset, input: inputOf(asset), preview, link, takesCash };
  });
  // Vários ativos podem usar o caixa da mesma conta: a soma é que precisa caber no caixa de hoje.
  const taken = new Map<number, number>();
  for (const r of rows) {
    if (r.takesCash && r.link.kind === "ledger") {
      taken.set(r.link.account.id, (taken.get(r.link.account.id) ?? 0) + r.preview.contributionCents);
    }
  }
  const cashProblemOf = (r: (typeof rows)[number]) =>
    r.takesCash && r.link.kind === "ledger" ? cashUseProblem(r.link.account.name, taken.get(r.link.account.id) ?? 0, r.link.account.balance_cents) : null;
  const cashBlocked = rows.some((r) => cashProblemOf(r) !== null);
  const changed = rows.filter((r) => r.preview.changed);
  const invalid = rows.some((r) => !r.preview.valid);
  const totalContribution = rows.reduce((sum, r) => sum + r.preview.contributionCents, 0);

  function submit() {
    save.mutate(
      changed.map(({ asset, preview, takesCash }) => ({
        id: asset.id,
        input: {
          date,
          balance_cents: preview.balanceCents ?? 0,
          contribution_cents: preview.contributionCents,
          contribution_date: preview.contributionCents > 0 && preview.contributionDate ? preview.contributionDate : undefined,
          invested_cents: fixInvested ? preview.investedOverrideCents : undefined,
          ...(takesCash && { use_cash: true }),
        },
      })),
      { onSuccess: onDone },
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Para cada ativo, informe o <strong>aporte do mês</strong> (dinheiro novo que você depositou) e o{" "}
        <strong>saldo atual</strong> do extrato, já com esse aporte. O app soma o aporte ao investido, e o que sobra é rendimento.
        Se o aporte foi feito em outro dia, informe o dia: é ele que permite medir quantos % do CDI o ativo rendeu.
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <Field label="Data dos valores" className="w-48">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={fixInvested} onChange={(e) => setFixInvested(e.target.checked)} className="size-4 accent-blue-500" />
          Corrigir o valor investido
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <tr>
              <th className="pb-2 font-medium">Ativo</th>
              <th className="pb-2 text-right font-medium">Saldo anterior</th>
              <th className="w-36 pb-2 font-medium">Aporte do mês (R$)</th>
              <th className="w-36 pb-2 font-medium">Saldo atual (R$)</th>
              <th className="pb-2 text-right font-medium">{fixInvested ? "Investido antes (R$)" : "Investido"}</th>
              <th className="pb-2 text-right font-medium">Rendimento</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((row) => {
              const { asset, input, preview, link } = row;
              const cashProblem = cashProblemOf(row);
              return (
                <Fragment key={asset.id}>
                  <tr className={preview.changed ? "bg-blue-50/60 dark:bg-blue-950/20" : undefined}>
                    <td className="py-1.5 pr-3">
                      <span className="font-medium">{asset.name}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {asset.institution_name}
                        {asset.purpose === "reserva" && " · reserva"}
                      </span>
                    </td>
                    <td className="tabular py-1.5 pr-3 text-right text-slate-500 dark:text-slate-400">{formatBRL(asset.current_cents)}</td>
                    <td className="py-1.5 pr-2">
                      <input
                        aria-label={`Aporte do mês em ${asset.name}`}
                        inputMode="decimal"
                        placeholder="0,00"
                        className={`${inputClass} tabular py-1.5 text-right`}
                        value={input.contribution}
                        onChange={(e) => edit(asset, { contribution: e.target.value })}
                      />
                      {preview.contributionCents > 0 && (
                        <label className="mt-1 flex items-center justify-end gap-1.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                          dia do aporte
                          <input
                            type="date"
                            aria-label={`Dia do aporte em ${asset.name}`}
                            max={date}
                            className={`${inputClass} w-36 py-1 text-xs`}
                            value={input.contributionDate || date}
                            onChange={(e) => edit(asset, { contributionDate: e.target.value === date ? "" : e.target.value })}
                          />
                        </label>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        aria-label={`Saldo atual de ${asset.name}`}
                        inputMode="decimal"
                        className={`${inputClass} tabular py-1.5 text-right`}
                        value={input.balance}
                        onChange={(e) => edit(asset, { balance: e.target.value, quote: "" })}
                      />
                      {parseQuantity(asset.quantity) !== null && (
                        <label className="mt-1 flex items-center justify-end gap-1.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                          {asset.quantity} × cotação
                          <input
                            aria-label={`Cotação de ${asset.name}`}
                            inputMode="decimal"
                            placeholder="R$"
                            className={`${inputClass} tabular w-24 py-1 text-right text-xs`}
                            value={input.quote ?? ""}
                            onChange={(e) => {
                              const cents = valueFromQuote(asset.quantity, e.target.value);
                              edit(asset, {
                                quote: e.target.value,
                                ...(cents !== null ? { balance: centsToInput(cents) } : {}),
                              });
                            }}
                          />
                        </label>
                      )}
                      {asset.class_key === "cripto" && asset.ticker && parseQuantity(asset.quantity) !== null && (
                        <FetchQuoteButton
                          ticker={asset.ticker}
                          assetName={asset.name}
                          className="mt-1 items-end"
                          onQuote={(price) => {
                            const cents = valueFromQuote(asset.quantity, price);
                            edit(asset, { quote: price, ...(cents !== null ? { balance: centsToInput(cents) } : {}) });
                          }}
                        />
                      )}
                    </td>
                    <td className="tabular py-1.5 pr-3 text-right">
                      {fixInvested ? (
                        <input
                          aria-label={`Valor investido em ${asset.name}`}
                          inputMode="decimal"
                          className={`${inputClass} tabular ml-auto w-32 py-1.5 text-right`}
                          value={input.investedOverride ?? ""}
                          onChange={(e) => edit(asset, { investedOverride: e.target.value })}
                        />
                      ) : (
                        preview.investedCents !== null && formatBRL(preview.investedCents)
                      )}
                    </td>
                    <td
                      className={cx(
                        "tabular py-1.5 text-right font-medium",
                        preview.gainCents !== null &&
                          (preview.gainCents >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"),
                      )}
                    >
                      {preview.gainCents === null ? "—" : formatBRL(preview.gainCents)}
                    </td>
                  </tr>
                  {link.kind !== "none" && preview.contributionCents > 0 && (
                    <tr>
                      <td colSpan={6} className="pb-3">
                        <CashContributionNote
                          link={link}
                          assetName={asset.name}
                          cents={preview.contributionCents}
                          useCash={Boolean(useCash[asset.id])}
                          onUseCashChange={(value) => setUseCash((current) => ({ ...current, [asset.id]: value }))}
                          problem={cashProblem}
                          problemId={`${reasonBase}-${asset.id}`}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <ErrorBox error={save.error} />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={changed.length === 0 || invalid || cashBlocked || save.isPending}
          aria-describedby={cashBlocked ? `${reasonBase}-caixa` : undefined}
          onClick={submit}
        >
          {changed.length > 0 ? `Salvar ${changed.length} ${changed.length === 1 ? "ativo" : "ativos"}` : "Salvar"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        {totalContribution > 0 && (
          <span className="tabular text-sm text-slate-600 dark:text-slate-400">Aportes neste fechamento: {formatBRL(totalContribution)}</span>
        )}
        {invalid && <span className="text-xs text-red-600 dark:text-red-400">Há valores inválidos.</span>}
        {cashBlocked && (
          <span id={`${reasonBase}-caixa`} className="text-xs text-red-600 dark:text-red-400">
            O caixa de uma conta não cobre os aportes marcados para usar o caixa. Veja o aviso no ativo.
          </span>
        )}
      </div>
    </div>
  );
}
