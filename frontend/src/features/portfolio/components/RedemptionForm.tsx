import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useAccounts } from "@/features/cash";
import { centsToInput, formatBRL, formatDate, parseMoneyToCents, todayISO } from "@/shared/lib/format";
import { Button, ErrorBox, Field, inputClass, Money } from "@/shared/ui";
import { MoneyText } from "@/shared/ui/MoneyText";
import { useRedemption } from "../hooks";
import { cashLink } from "../lib/cashLink";
import { checkRedemption, NOTE_MAX, redemptionPreview } from "../lib/redemption";
import type { Asset, Movement } from "../types";

/** Espera a pessoa parar de digitar antes de anunciar o resumo do resgate. */
const ANNOUNCE_DELAY_MS = 700;

export interface RedemptionDone {
  movement: Movement;
  /** Conta onde o valor entrou, quando a pessoa pediu para creditar no caixa. */
  creditedAccount: string | null;
  alreadyInBalance: boolean;
}

/**
 * Registrar um resgate: dinheiro que saiu de um ativo para uso (ex.: da reserva de emergência).
 * Não é prejuízo: o saldo e o investido caem na mesma proporção. O formulário mostra a conta antes de registrar.
 */
export function RedemptionForm({
  assets,
  initialAssetId,
  onDone,
  onCancel,
}: {
  assets: Asset[];
  initialAssetId?: number | null;
  onDone: (done: RedemptionDone) => void;
  onCancel: () => void;
}) {
  const register = useRedemption();
  const accounts = useAccounts();
  const [asset, setAsset] = useState(() =>
    initialAssetId != null && assets.some((a) => a.id === initialAssetId) ? String(initialAssetId) : "",
  );
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [creditCash, setCreditCash] = useState(false);
  const [alreadyInBalance, setAlreadyInBalance] = useState(false);
  const assetField = useRef<HTMLSelectElement>(null);
  const amountField = useRef<HTMLInputElement>(null);
  const blockerId = useId();
  const balanceHelpId = useId();
  const cashHelpId = useId();
  const noteCountId = useId();

  const selected = assets.find((a) => String(a.id) === asset);
  const cents = parseMoneyToCents(amount);
  const today = todayISO();
  const check = checkRedemption({ asset: selected, amountText: amount, cents, date, today, alreadyInBalance });
  const link = cashLink(selected?.account_id ?? null, accounts.data ?? [], date);
  const takesCash = creditCash && link.kind === "ledger";
  const preview =
    selected && cents !== null && cents > 0 && check.amountError === null ? redemptionPreview(selected, cents, alreadyInBalance) : [];
  const valid = check.blocker === null;
  const summary =
    selected && cents !== null && cents > 0 && check.amountError === null
      ? alreadyInBalance
        ? `Resgate de ${formatBRL(cents)} de ${selected.name}: o saldo fica como está e só o investido é reduzido.`
        : `Resgate de ${formatBRL(cents)} de ${selected.name}: o saldo vai para ${formatBRL(selected.current_cents - cents)}.`
      : "";
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setAnnounced(summary), summary === "" ? 0 : ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [summary]);

  // Ao abrir, o foco vai para o primeiro campo que falta (o valor, se o ativo veio escolhido pelo link da reserva).
  useEffect(() => {
    (asset === "" ? assetField : amountField).current?.focus();
    // Só na abertura: depois disso o foco é da pessoa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // O erro do servidor fala dos dados que foram enviados: ao mudar qualquer um, ele deixa de valer.
  const { isError, reset } = register;
  useEffect(() => {
    if (isError) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, amount, date, note, creditCash, alreadyInBalance]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || !selected || cents === null) return;
    register.mutate(
      {
        asset_id: selected.id,
        amount_cents: cents,
        date,
        note: note.trim() === "" ? null : note.trim(),
        credit_cash: takesCash,
        already_in_balance: alreadyInBalance,
      },
      {
        onSuccess: (movement) =>
          onDone({ movement, creditedAccount: takesCash && link.kind === "ledger" ? link.account.name : null, alreadyInBalance }),
      },
    );
  }

  return (
    <form onSubmit={submit} aria-label="Registrar resgate" className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Use quando tirou dinheiro de um ativo para gastar (ex.: da reserva de emergência). O resgate <strong>não é prejuízo</strong>: o
        saldo e o investido do ativo caem na mesma proporção, e o rendimento que já tinha continua dele.
      </p>

      <Field label="Ativo" className="max-w-xl">
        <select ref={assetField} className={inputClass} value={asset} onChange={(e) => setAsset(e.target.value)}>
          <option value="">Escolha o ativo resgatado</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.institution_name}
              {a.purpose === "reserva" ? " · reserva" : ""}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Valor resgatado (R$)" error={check.amountError} className="w-44">
          <input
            ref={amountField}
            inputMode="decimal"
            className={`${inputClass} tabular`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            aria-invalid={check.amountError ? true : undefined}
          />
        </Field>
        {selected && !alreadyInBalance && selected.current_cents > 0 && (
          <Button
            variant="ghost" size="sm"
            onClick={() => setAmount(centsToInput(selected.current_cents))}
            aria-label={`Resgatar tudo de ${selected.name}`}
          >
            <span>
              Tudo (<Money cents={selected.current_cents} />)
            </span>
          </Button>
        )}
        <Field label="Data do resgate" error={check.dateError} className="w-44">
          <input
            type="date"
            max={today}
            className={inputClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-invalid={check.dateError ? true : undefined}
          />
        </Field>
      </div>
      {selected && alreadyInBalance && check.dateError && date > selected.valuation_date && (
        <Button variant="secondary" onClick={() => setDate(selected.valuation_date)}>
          Usar {formatDate(selected.valuation_date)}, a data do saldo
        </Button>
      )}

      <div>
        <Field label="Motivo (opcional)" className="max-w-xl">
          <input
            className={inputClass}
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex.: conserto do carro"
            aria-describedby={noteCountId}
          />
        </Field>
        <p id={noteCountId} className="tabular mt-1 text-xs text-slate-500 dark:text-slate-400">
          {note.length}/{NOTE_MAX} caracteres. Só para você lembrar depois; aparece na lista de movimentações.
        </p>
      </div>

      {selected && link.kind === "ledger" && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-100/60 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-300">
          <label className="flex min-h-10 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-blue-600"
              checked={creditCash}
              onChange={(e) => setCreditCash(e.target.checked)}
              aria-describedby={cashHelpId}
            />
            <span>Creditar no caixa da conta {link.account.name}</span>
          </label>
          <p id={cashHelpId} className="text-xs text-slate-600 dark:text-slate-400">
            Marque se o dinheiro ficou na conta {link.account.name}: ele entra no caixa como venda de {selected.name} (hoje o caixa tem{" "}
            <Money cents={link.account.balance_cents} />
            ). Se foi para outra conta ou você já gastou, deixe desmarcado.
          </p>
        </div>
      )}
      {selected && link.kind === "before" && (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          A data do resgate é anterior ao saldo inicial do caixa de {link.account.name} ({formatDate(link.account.opening_date ?? "")}): o
          resgate fica só na carteira, sem passar pelo caixa.
        </p>
      )}

      {selected && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-100/60 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-300">
          <label className="flex min-h-10 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-blue-600"
              checked={alreadyInBalance}
              onChange={(e) => setAlreadyInBalance(e.target.checked)}
              aria-describedby={balanceHelpId}
            />
            <span>O saldo que já digitei já está sem esse dinheiro</span>
          </label>
          <div id={balanceHelpId} className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
            <p>
              Último valor registrado de {selected.name}: <Money cents={selected.current_cents} /> em {formatDate(selected.valuation_date)}.
            </p>
            <p>
              {alreadyInBalance
                ? "O app mantém esse valor e só reduz o investido, para o mesmo dinheiro não ser descontado duas vezes. Ao registrar, o servidor confere se existe um saldo digitado nessa data ou depois."
                : "Deixe desmarcado se o saldo ainda inclui esse dinheiro: o app tira o valor do saldo e a parte proporcional do investido. Marque se você já atualizou o saldo depois de tirar o dinheiro."}
            </p>
          </div>
        </div>
      )}

      {preview.length > 0 && (
        <p className="tabular rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300">
          <MoneyText parts={preview} />
        </p>
      )}
      {/* Resumo curto para leitor de tela: só depois que o valor para de mudar, para não ser lido a cada tecla. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announced}
      </p>

      <ErrorBox error={register.error} />
      {!valid && (
        <p id={blockerId} className="text-xs text-slate-600 dark:text-slate-400">
          Para registrar: {check.blocker}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!valid || register.isPending} aria-describedby={valid ? undefined : blockerId}>
          {register.isPending ? "Registrando…" : "Registrar resgate"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
