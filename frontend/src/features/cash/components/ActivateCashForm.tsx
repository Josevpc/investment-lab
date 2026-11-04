import { useState } from "react";
import { formatDate, parseMoneyToCents, todayISO } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { Field, inputClass } from "@/shared/ui";
import { useActivateCash } from "../hooks";
import { openingProblem } from "../lib/entries";
import type { Account } from "../types";
import { CashError, FormPanel, SubmitRow } from "./parts";

/** Primeiro passo de uma conta: o saldo de partida. Só vale uma vez, por isso explica antes. */
export function ActivateCashForm({ account, onDone }: { account: Account; onDone: (message: MoneyTextPart[]) => void }) {
  const activate = useActivateCash();
  const today = todayISO();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);

  const cents = amount.trim() === "" ? null : parseMoneyToCents(amount);
  const problem = openingProblem(cents, date, today);

  function submit() {
    if (problem !== null || cents === null) return;
    activate.mutate(
      { id: account.id, date, amountCents: cents },
      {
        onSuccess: () =>
          onDone([
            "Caixa ativado com ",
            { cents },
            ` em ${formatDate(date)}. A partir de agora, depósitos, compras, proventos e retiradas desta conta mexem no caixa. No fim do mês, use “Conferir com o extrato”.`,
          ]),
      },
    );
  }

  return (
    <FormPanel
      title={`Ativar o caixa de ${account.name}`}
      intro={
        <>
          <p>
            O caixa é o dinheiro parado nesta conta, esperando para ser investido. Informe quanto há de saldo disponível no extrato (fora
            dos investimentos) e a data desse saldo.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Vale uma vez só: nada pode ser lançado antes dessa data.</li>
            <li>
              Nada do que já está registrado na carteira entra no caixa, nem o que for de depois dessa data (aportes, compras, proventos).
              Se escolher uma data passada, lance à mão o que aconteceu desde então, ou use a data de hoje com o saldo de hoje.
            </li>
            <li>O caixa fica fora do patrimônio investido e da alocação; aparece à parte.</li>
          </ul>
        </>
      }
      onSubmit={submit}
      autoFocus={false}
    >
      <div className="flex flex-wrap items-start gap-4">
        <Field
          label="Saldo em caixa no extrato (R$)"
          hint="Pode ser 0,00 se a conta está zerada."
          error={amount.trim() !== "" && cents === null ? "Valor inválido. Use o formato 1.234,56." : null}
          className="w-full sm:w-56"
        >
          <input
            inputMode="decimal"
            className={`${inputClass} tabular min-h-10`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
          />
        </Field>
        <Field label="Data do saldo" hint="Use a data do extrato que você tem em mãos." className="w-full sm:w-52">
          <input type="date" max={today} className={`${inputClass} min-h-10`} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <CashError error={activate.error} />
      <SubmitRow label="Ativar caixa" problem={problem} pending={activate.isPending} />
    </FormPanel>
  );
}
