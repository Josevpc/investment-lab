import { useState } from "react";
import { useAssetClasses, type Asset } from "@/features/portfolio";
import { ApiError } from "@/shared/lib/api";
import { parseMoneyToCents, todayISO } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { Button, ErrorBox, Field, inputClass, Money } from "@/shared/ui";
import { useCreateReservation } from "../hooks";
import { reserveEffect, reserveProblem, reserveSuccess, validReserveClasses } from "../lib/reserve";
import { freeCents, reservedCents } from "../lib/split";
import type { Account } from "../types";
import { BalancePreview, CashError, FormPanel, SubmitRow } from "./parts";

/** Faltou caixa livre no back-end: ele manda quanto falta ao lado da mensagem. */
function shortfallOf(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const value = error.extra.shortfall_cents;
  return typeof value === "number" ? value : null;
}

/**
 * Separar parte do caixa para comprar uma categoria. O dinheiro continua na conta (o total não muda), só
 * deixa de estar livre; a compra de um ativo da categoria gasta primeiro o separado.
 */
export function ReserveForm({
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
  const classes = useAssetClasses(false);
  const create = useCreateReservation();
  const today = todayISO();
  const options = validReserveClasses(classes.data ?? [], assets);
  const [classId, setClassId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [deposit, setDeposit] = useState(false);

  // Com uma única categoria possível, não há o que escolher.
  const chosen = options.find((c) => String(c.id) === classId) ?? (options.length === 1 ? options[0] : undefined);
  const free = freeCents(account);
  const cents = amount.trim() === "" ? null : parseMoneyToCents(amount);
  const valid = cents !== null && cents > 0;
  const shortfall = valid && cents > free ? cents - free : 0;
  const problem = reserveProblem({
    classId: chosen?.id ?? null,
    cents,
    date,
    today,
    openingDate: account.opening_date,
    freeCents: free,
    deposit,
  });
  const effect = valid
    ? reserveEffect({ cents, balanceCents: account.balance_cents, freeCents: free, reservedCents: reservedCents(account), deposit })
    : null;
  const apiShortfall = shortfallOf(create.error);

  function send(withDeposit: boolean) {
    if (!chosen || cents === null || cents <= 0) return;
    if (withDeposit !== deposit) setDeposit(withDeposit);
    const done = reserveEffect({ cents, balanceCents: account.balance_cents, freeCents: free, reservedCents: reservedCents(account), deposit: withDeposit });
    create.mutate(
      { accountId: account.id, input: { class_id: chosen.id, amount_cents: cents, date, ...(withDeposit && { deposit: true }) } },
      {
        onSuccess: () =>
          onDone(reserveSuccess({ cents, className: chosen.name, date, deposited: done.deposited, freeAfter: done.freeAfter })),
      },
    );
  }

  function submit() {
    if (problem !== null) return;
    send(deposit);
  }

  return (
    <FormPanel
      title={`Separar para comprar em ${account.name}`}
      intro="Guarde parte do caixa para juntar a meta de uma categoria até poder comprar. O dinheiro continua na conta, só deixa de estar livre; quando você comprar um ativo dessa categoria com o caixa, o separado é usado primeiro."
      onSubmit={submit}
    >
      <div className="flex flex-wrap items-start gap-4">
        <Field
          label="Categoria"
          hint={
            classes.isLoading
              ? "Carregando as categorias..."
              : classes.error
                ? "Não deu para carregar as categorias. Recarregue a página."
                : options.length === 0
                  ? "Nenhuma categoria aceita compras agora (arquivadas ou só com ativos em “manter posição”)."
                  : undefined
          }
          className="min-w-0 flex-1 basis-64"
        >
          <select className={`${inputClass} min-h-10`} value={chosen ? String(chosen.id) : ""} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Escolha a categoria</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <Field
          label="Valor a separar (R$)"
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

      <p className="text-sm text-ink-2">
        Caixa livre agora: <Money cents={free} />
        {reservedCents(account) > 0 && (
          <>
            {" "}· já separado: <Money cents={reservedCents(account)} />
          </>
        )}
      </p>
      {shortfall > 0 && !deposit && (
        <p className="rounded-field bg-clay-t px-4 py-3 text-sm text-ink">
          O caixa livre tem <Money cents={free} />: faltam <strong><Money cents={shortfall} /></strong> para separar esse valor.
        </p>
      )}
      <label className="flex min-h-10 cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          aria-labelledby="separar-deposito-rotulo"
          aria-describedby="separar-deposito"
          className="mt-0.5 size-4 accent-blue-600"
          checked={deposit}
          onChange={(e) => setDeposit(e.target.checked)}
        />
        <span>
          <span id="separar-deposito-rotulo">Depositar agora e separar</span>
          <span id="separar-deposito" className="block text-xs text-ink-3">
            {valid ? (
              <>
                Registra um depósito de <Money cents={cents} /> (dinheiro novo, soma ao capital aportado) na mesma data e separa o mesmo valor.
              </>
            ) : (
              "Use quando o dinheiro ainda não está no caixa. Registra um depósito (dinheiro novo, soma ao capital aportado) do mesmo valor e separa."
            )}
          </span>
        </span>
      </label>

      {effect && chosen && effect.freeAfter >= 0 && (
        <div className="space-y-1">
          <BalancePreview label="Caixa livre" before={free} after={effect.freeAfter} />
          <BalancePreview label="Separado para comprar" before={reservedCents(account)} after={effect.reservedAfter} />
          {effect.deposited > 0 && <BalancePreview label="Total na conta" before={account.balance_cents} after={effect.totalAfter} />}
        </div>
      )}

      {apiShortfall !== null ? (
        <div className="space-y-2">
          <ErrorBox error={create.error} />
          <p className="text-sm text-ink-2">
            Faltam <strong><Money cents={apiShortfall} /></strong> no caixa livre para separar esse valor.
          </p>
          {!deposit && (
            <Button size="sm" variant="secondary" disabled={create.isPending} onClick={() => send(true)}>
              Depositar e separar
            </Button>
          )}
        </div>
      ) : (
        <CashError error={create.error} />
      )}
      <SubmitRow label="Separar para comprar" problem={problem} pending={create.isPending} onCancel={onCancel} />
    </FormPanel>
  );
}
