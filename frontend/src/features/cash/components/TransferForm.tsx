import { useState } from "react";
import { centsToInput, formatDate, parseMoneyToCents, todayISO } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { Field, inputClass, Money } from "@/shared/ui";
import { useCashTransfer } from "../hooks";
import { transferProblem } from "../lib/entries";
import type { Account } from "../types";
import { BalancePreview, CashError, FormPanel, SubmitRow } from "./parts";

function AccountSelect({
  label,
  accounts,
  value,
  onChange,
}: {
  label: string;
  accounts: Account[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} className="min-w-0 flex-1 basis-56">
      <select className={`${inputClass} min-h-10`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Escolha uma conta</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Caixa de uma conta para outra. Só aparecem contas com caixa ativado. */
export function TransferForm({
  accounts,
  fromId,
  onDone,
  onCancel,
}: {
  accounts: Account[];
  fromId?: number;
  onDone: (message: MoneyTextPart[]) => void;
  onCancel: () => void;
}) {
  const transfer = useCashTransfer();
  const today = todayISO();
  const usable = accounts.filter((a) => a.cash_enabled && !a.archived);
  const [from, setFrom] = useState(fromId ? String(fromId) : "");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);

  const origin = usable.find((a) => String(a.id) === from);
  const target = usable.find((a) => String(a.id) === to);
  const cents = amount.trim() === "" ? null : parseMoneyToCents(amount);
  const problem = transferProblem({ from: origin, to: target, cents, date, today });
  const valid = cents !== null && cents > 0;

  function submit() {
    if (problem !== null || !origin || !target || cents === null) return;
    transfer.mutate(
      { from_account_id: origin.id, to_account_id: target.id, amount_cents: cents, date },
      {
        onSuccess: () =>
          onDone([
            "Transferência registrada: ",
            { cents },
            ` de ${origin.name} para ${target.name} em ${formatDate(date)}. O total em caixa e o capital aportado não mudam.`,
          ]),
      },
    );
  }

  return (
    <FormPanel
      title="Transferir entre contas"
      intro="Leva dinheiro do caixa de uma conta para o de outra (ex.: do banco para a corretora). O total em caixa e o capital aportado não mudam."
      onSubmit={submit}
    >
      <div className="flex flex-wrap items-start gap-4">
        <AccountSelect
          label="De (origem)"
          accounts={usable}
          value={from}
          onChange={(value) => {
            setFrom(value);
            if (value === to) setTo("");
          }}
        />
        <AccountSelect label="Para (destino)" accounts={usable.filter((a) => String(a.id) !== from)} value={to} onChange={setTo} />
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <Field
          label="Valor (R$)"
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
          <input type="date" max={today} className={`${inputClass} min-h-10`} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      {origin && origin.balance_cents > 0 && (
        <button
          type="button"
          className="min-h-10 text-sm font-medium text-blue-700 hover:underline dark:text-blue-300"
          onClick={() => setAmount(centsToInput(origin.balance_cents))}
        >
          Usar todo o caixa de {origin.name} (<Money cents={origin.balance_cents} />)
        </button>
      )}
      {valid && (origin || target) && (
        <div className="space-y-1">
          {origin && <BalancePreview label={`Caixa de ${origin.name}`} before={origin.balance_cents} after={origin.balance_cents - cents} />}
          {target && <BalancePreview label={`Caixa de ${target.name}`} before={target.balance_cents} after={target.balance_cents + cents} />}
        </div>
      )}
      <CashError error={transfer.error} />
      <SubmitRow label="Transferir" problem={problem} pending={transfer.isPending} onCancel={onCancel} />
    </FormPanel>
  );
}
