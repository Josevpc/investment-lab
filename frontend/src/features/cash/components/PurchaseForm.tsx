import { useState } from "react";
import { usePurchase, type Asset } from "@/features/portfolio";
import { formatDate, parseMoneyToCents, todayISO } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { Field, inputClass, Money } from "@/shared/ui";
import { purchaseProblem, purchaseShortfall } from "../lib/purchase";
import type { Account } from "../types";
import { BalancePreview, CashError, FormPanel, SubmitRow } from "./parts";

/**
 * Compra de um ativo desta conta com o dinheiro do caixa: o ativo ganha o valor no investido e no saldo,
 * o caixa perde. É o caminho para investir um depósito sem que o aporte conte duas vezes.
 */
export function PurchaseForm({
  account,
  assets,
  onDone,
  onCancel,
}: {
  account: Account;
  assets: Asset[];
  onDone: (message: MoneyTextPart[]) => void;
  onCancel: () => void;
}) {
  const purchase = usePurchase();
  const today = todayISO();
  const [assetId, setAssetId] = useState(assets.length === 1 ? String(assets[0].id) : "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [deposit, setDeposit] = useState(false);

  const asset = assets.find((a) => String(a.id) === assetId);
  const cents = amount.trim() === "" ? null : parseMoneyToCents(amount);
  const shortfall = purchaseShortfall(cents, account.balance_cents);
  const problem = purchaseProblem({
    asset,
    cents,
    date,
    today,
    openingDate: account.opening_date,
    balanceCents: account.balance_cents,
    depositShortfall: deposit,
  });

  function submit() {
    if (problem !== null || !asset || cents === null) return;
    const depositCents = shortfall > 0 && deposit ? shortfall : undefined;
    purchase.mutate(
      { asset_id: asset.id, amount_cents: cents, date, ...(depositCents && { deposit_cents: depositCents }) },
      {
        onSuccess: (result) =>
          onDone([
            "Compra registrada: ",
            { cents },
            ` em ${asset.name} (${formatDate(date)})`,
            ...(result.deposit_cents > 0 ? [", com depósito de ", { cents: result.deposit_cents }, " de dinheiro novo"] : []),
            ". O valor entrou no investido e no saldo do ativo e conta como aporte do mês. Caixa ao fim do dia: ",
            { cents: result.cash_balance_cents },
            ". Para desfazer, use Movimentações.",
          ]),
      },
    );
  }

  return (
    <FormPanel
      title={`Comprar ativo com o caixa de ${account.name}`}
      intro="Use quando o dinheiro já está no caixa (depósito, venda, provento). O ativo ganha o valor no investido e no saldo; o caixa perde. Não registre o mesmo valor de novo como aporte no fechamento."
      onSubmit={submit}
    >
      <div className="flex flex-wrap items-start gap-4">
        <Field
          label="Ativo comprado"
          hint={asset ? `Último saldo de ${asset.name}: ${formatDate(asset.valuation_date)}. A compra precisa ser nessa data ou depois.` : undefined}
          className="min-w-0 flex-1 basis-64"
        >
          <select className={`${inputClass} min-h-10`} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">Escolha um ativo desta conta</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <Field
          label="Valor da compra (R$)"
          error={amount.trim() !== "" && cents === null ? "Valor inválido. Use o formato 1.234,56." : null}
          className="w-full sm:w-52"
        >
          <input
            inputMode="decimal"
            className={`${inputClass} tabular min-h-10`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
          />
        </Field>
        <Field label="Data" className="w-full sm:w-52">
          <input
            type="date"
            min={account.opening_date ?? undefined}
            max={today}
            className={`${inputClass} min-h-10`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
      </div>

      {shortfall > 0 && (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-100">
          <p>
            O caixa de hoje tem <Money cents={account.balance_cents} />: faltam <strong><Money cents={shortfall} /></strong> para esta compra.
          </p>
          <label className="flex min-h-10 cursor-pointer items-center gap-2">
            <input type="checkbox" className="size-4 accent-blue-600" checked={deposit} onChange={(e) => setDeposit(e.target.checked)} />
            <span>
              Registrar também um depósito de <Money cents={shortfall} /> (dinheiro novo, soma ao capital aportado)
            </span>
          </label>
        </div>
      )}
      {cents !== null && cents > 0 && (shortfall === 0 || deposit) && (
        <BalancePreview before={account.balance_cents} after={account.balance_cents - cents + (deposit ? shortfall : 0)} />
      )}
      <CashError error={purchase.error} />
      <SubmitRow label="Registrar compra" problem={problem} pending={purchase.isPending} onCancel={onCancel} />
    </FormPanel>
  );
}
