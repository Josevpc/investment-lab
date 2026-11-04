import { useState } from "react";
import { parseMoneyToCents, todayISO } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { Field, inputClass, Segmented } from "@/shared/ui";
import { useAddEntry } from "../hooks";
import { apiAmount, cashEffect, entryProblem, entrySuccess, MANUAL_KINDS, type Direction } from "../lib/entries";
import type { Account, ManualKind } from "../types";
import { BalancePreview, CashError, FormPanel, SubmitRow } from "./parts";

const KIND_OPTIONS = (Object.keys(MANUAL_KINDS) as ManualKind[]).map((value) => ({ value, label: MANUAL_KINDS[value].label }));
const DIRECTIONS = [
  { value: "in", label: "Somar ao caixa (+)" },
  { value: "out", label: "Tirar do caixa (−)" },
] as const;

/** Depósito, retirada, taxa ou ajuste: um formulário só, o tipo escolhido no topo. */
export function EntryForm({
  account,
  initialKind = "deposito",
  onDone,
  onCancel,
}: {
  account: Account;
  initialKind?: ManualKind;
  onDone: (message: MoneyTextPart[]) => void;
  onCancel: () => void;
}) {
  const add = useAddEntry();
  const today = todayISO();
  const [kind, setKind] = useState<ManualKind>(initialKind);
  const [direction, setDirection] = useState<Direction>("in");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);

  const cents = amount.trim() === "" ? null : parseMoneyToCents(amount);
  const problem = entryProblem({ kind, cents, direction, date, today, account });
  const info = MANUAL_KINDS[kind];
  const after = cents !== null && cents > 0 ? account.balance_cents + cashEffect(kind, cents, direction) : null;

  function submit() {
    if (problem !== null || cents === null || after === null) return;
    add.mutate(
      { id: account.id, kind, date, amountCents: apiAmount(kind, cents, direction) },
      { onSuccess: () => onDone(entrySuccess(kind, cents, date, after)) },
    );
  }

  return (
    <FormPanel title={`Novo lançamento em ${account.name}`} onSubmit={submit}>
      <div className="space-y-2">
        <Segmented label="Tipo de lançamento" value={kind} options={KIND_OPTIONS} onChange={setKind} size="md" grid />
        <p className="text-sm text-slate-600 dark:text-slate-400">{info.help}</p>
      </div>
      {kind === "ajuste" && <Segmented label="Sentido do ajuste" value={direction} options={DIRECTIONS} onChange={setDirection} grid />}
      <div className="flex flex-wrap items-start gap-4">
        <Field
          label={info.field}
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
      {after !== null && after >= 0 && <BalancePreview before={account.balance_cents} after={after} />}
      <CashError error={add.error} />
      <SubmitRow label={info.action} problem={problem} pending={add.isPending} onCancel={onCancel} />
    </FormPanel>
  );
}
