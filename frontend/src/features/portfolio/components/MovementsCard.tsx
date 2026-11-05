import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAccounts } from "@/features/cash";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { centsToInput, currentMonth, formatBRL, formatDate, formatMonth, parseMoneyToCents, todayISO } from "@/shared/lib/format";
import { Badge, Button, Card, cx, Empty, ErrorBox, Field, inputClass, Loading, Money, MonthInput, ScrollRegion, splitQuestion, useConfirm } from "@/shared/ui";
import { MoneyText } from "@/shared/ui/MoneyText";
import {
  useAssets,
  useDeleteMovement,
  useMonthSummary,
  useMovements,
  useRegisterProvento,
  useSaveClosing,
  useSetOffGoal,
  useTransfer,
  useUncountInitial,
  useUndoMovement,
  useUpdateMovement,
} from "../hooks";
import { OFF_GOAL_HELP, OFF_GOAL_LABEL, canBeOffGoal, offGoalActionLabel, offGoalDone } from "../lib/offGoal";
import { uncountDone, uncountMessage } from "../lib/newInvestment";
import { cashLink, cashUseProblem } from "../lib/cashLink";
import { addQuantities, parseQuantity, valueFromQuote } from "../lib/quote";
import type { Asset, Movement, MovementKind } from "../types";
import { NOTE_MAX } from "../lib/redemption";
import { CashContributionNote } from "./CashContributionNote";
import { FetchQuoteButton } from "./FetchQuoteButton";
import { RedemptionForm, type RedemptionDone } from "./RedemptionForm";
import { RedemptionNotice } from "./RedemptionNotice";

const KIND_LABEL: Record<MovementKind, string> = {
  aporte: "Aporte",
  provento: "Provento",
  transferencia: "Transferência",
  resgate: "Resgate",
};

const KIND_STYLE: Record<MovementKind, string> = {
  aporte: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  provento: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  transferencia: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  // Resgate não é ganho nem perda: neutro e só com contorno, nunca o vermelho de alerta.
  resgate: "border border-slate-400 text-slate-800 dark:border-slate-500 dark:text-slate-200",
};

function describe(m: Movement): string {
  if (m.kind === "transferencia") return `${m.related_asset_name} → ${m.asset_name}`;
  if (m.kind === "provento") return m.related_asset_name ? `${m.asset_name} → creditado em ${m.related_asset_name}` : m.asset_name;
  return m.asset_name;
}

const SHIFTED_BALANCES = "Os saldos que você digitou depois dessa data mudam junto.";

/** O que acontece nos saldos ao desfazer, dito antes de confirmar. */
export function undoMessage(m: Movement): string {
  const value = formatBRL(m.amount_cents);
  const tail = " Os fechamentos já registrados no Histórico não mudam.";
  if (m.kind === "aporte") {
    // Com o caixa ativado na conta do ativo, o aporte (ou a compra) também tem lançamentos no extrato.
    return `Desfazer o aporte de ${value} em ${m.asset_name} (${formatDate(m.date)})? O valor sai do investido e do saldo do ativo. Se a conta do ativo tem caixa ativado, os lançamentos desse aporte saem do extrato (numa compra, o dinheiro volta ao caixa).${tail}`;
  }
  if (m.kind === "resgate") {
    const motivo = m.note ? ` (motivo: ${m.note})` : "";
    // No resgate normal o servidor desloca todos os saldos a partir da data, inclusive os digitados depois dela.
    const shifted = m.in_balance ? "" : ` ${SHIFTED_BALANCES}`;
    const effect = m.in_balance
      ? "O custo volta ao investido; o saldo registrado não muda, porque já estava sem esse dinheiro."
      : "O valor volta ao saldo do ativo e o custo volta ao investido.";
    return `Desfazer o resgate de ${value} de ${m.asset_name} (${formatDate(m.date)})${motivo}? ${effect} Se ele foi creditado no caixa da conta, a venda sai do extrato (não dá se o caixa ou algum saldo ficaria negativo). O acumulado do ano deixa de descontar esse resgate.${shifted}${tail}`;
  }
  if (m.kind === "transferencia") {
    return `Desfazer a transferência de ${value} de ${m.related_asset_name} para ${m.asset_name}? O dinheiro e o custo voltam para a origem.${tail}`;
  }
  return `Desfazer o provento de ${value} de ${m.asset_name}? O valor sai do saldo de ${m.related_asset_name}.${tail}`;
}

/** O que muda nos saldos ao salvar uma correção, dito antes de salvar. */
export function editHint(m: Movement): string {
  const tail = " Os fechamentos já registrados no Histórico não mudam.";
  if (m.kind === "aporte") {
    return `O valor do aporte no investido e no saldo de ${m.asset_name} é refeito. Se a nova data passar por um fechamento, o aporte passa a pertencer a ele.${tail}`;
  }
  if (m.kind === "resgate") {
    const base = "Só o motivo muda. O valor, a data e os saldos ficam como estão; para corrigir o valor ou a data, desfaça o resgate e registre de novo.";
    return m.in_balance ? base : `${base} ${SHIFTED_BALANCES}`;
  }
  if (m.kind === "transferencia") {
    return `O dinheiro é refeito entre ${m.related_asset_name} e ${m.asset_name}. O custo que acompanha o dinheiro é recalculado pelo saldo do dia, então o total investido da carteira não muda.${tail}`;
  }
  if (m.related_asset_name) {
    return `O valor creditado em ${m.related_asset_name} é ajustado; o investido dele não muda.${tail}`;
  }
  return "Só o registro do provento muda; nenhum saldo é alterado.";
}

/** O resgate só aceita corrigir o motivo; valor e data mexem em saldos e custo, então se desfaz e registra de novo. */
function EditRedemptionNote({ movement, onDone, onCancel }: { movement: Movement; onDone: (message: string) => void; onCancel: () => void }) {
  const update = useUpdateMovement();
  const [note, setNote] = useState(movement.note ?? "");
  const countId = useId();
  const trimmed = note.trim();
  const changed = trimmed !== (movement.note ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!changed) return;
    update.mutate(
      { id: movement.id, input: { note: trimmed === "" ? null : trimmed } },
      {
        onSuccess: () =>
          onDone(
            trimmed === ""
              ? `Motivo removido do resgate de ${movement.asset_name}.`
              : `Motivo do resgate de ${movement.asset_name} atualizado: ${trimmed}.`,
          ),
      },
    );
  }

  return (
    <form onSubmit={submit} aria-label={`Editar resgate de ${movement.asset_name}`} className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
        Editar resgate de {movement.asset_name} (<Money cents={movement.amount_cents} /> em {formatDate(movement.date)})
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-400">{editHint(movement)}</p>
      <div>
        <Field label="Motivo (opcional)" className="max-w-xl">
          <input
            className={inputClass}
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex.: conserto do carro"
            aria-describedby={countId}
          />
        </Field>
        <p id={countId} className="tabular mt-1 text-xs text-slate-500 dark:text-slate-400">
          {note.length}/{NOTE_MAX} caracteres.
        </p>
      </div>
      <ErrorBox error={update.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={!changed || update.isPending}>
          Salvar alterações
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function EditMovementForm({ movement, onDone, onCancel }: { movement: Movement; onDone: (message: string) => void; onCancel: () => void }) {
  const update = useUpdateMovement();
  const [amount, setAmount] = useState(centsToInput(movement.amount_cents));
  const [date, setDate] = useState(movement.date);

  const cents = parseMoneyToCents(amount);
  const changed = cents !== movement.amount_cents || date !== movement.date;
  const valid = cents !== null && cents > 0 && date !== "" && date <= todayISO() && changed;
  const label = `${KIND_LABEL[movement.kind].toLowerCase()} de ${movement.asset_name}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || cents === null) return;
    const input = {
      ...(cents !== movement.amount_cents && { amount_cents: cents }),
      ...(date !== movement.date && { date }),
    };
    update.mutate(
      { id: movement.id, input },
      {
        onSuccess: () =>
          onDone(
            `${KIND_LABEL[movement.kind]} atualizado: ${formatBRL(cents)} em ${formatDate(date)} (${movement.asset_name}). Os saldos foram refeitos com os novos dados.`,
          ),
      },
    );
  }

  return (
    <form onSubmit={submit} aria-label={`Editar ${label}`} className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
        Editar {label} ({formatBRL(movement.amount_cents)} em {formatDate(movement.date)})
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-400">{editHint(movement)}</p>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Valor (R$)" error={amount !== "" && cents === null ? "Valor inválido." : null} className="w-44">
          <input inputMode="decimal" className={`${inputClass} tabular`} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Data" className="w-44" error={date > todayISO() ? "Não pode ser no futuro." : null}>
          <input type="date" max={todayISO()} className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <ErrorBox error={update.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid || update.isPending}>
          Salvar alterações
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function AssetSelect({
  label,
  assets,
  value,
  onChange,
  allowEmpty,
  hint,
}: {
  label: string;
  assets: Asset[];
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint} className="min-w-52 flex-1">
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allowEmpty ?? "Escolha um ativo"}</option>
        {assets.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · {a.institution_name}
          </option>
        ))}
      </select>
    </Field>
  );
}

function TransferForm({ assets, onDone }: { assets: Asset[]; onDone: () => void }) {
  const transfer = useTransfer();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());

  const origin = assets.find((a) => String(a.id) === from);
  const cents = parseMoneyToCents(amount);
  const valid = from !== "" && to !== "" && from !== to && cents !== null && cents > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || cents === null) return;
    transfer.mutate({ from_asset_id: Number(from), to_asset_id: Number(to), amount_cents: cents, date }, { onSuccess: onDone });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Leva dinheiro de um ativo para outro (ex.: da Midway para o Mercado Pago). O rendimento acumulado acompanha o dinheiro, então
        o total investido da carteira não muda.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <AssetSelect label="De" assets={assets} value={from} onChange={setFrom} />
        <AssetSelect label="Para" assets={assets.filter((a) => String(a.id) !== from)} value={to} onChange={setTo} />
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Valor (R$)" error={amount !== "" && cents === null ? "Valor inválido." : null} className="w-44">
          <input inputMode="decimal" className={`${inputClass} tabular`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </Field>
        {origin && (
          <button
            type="button"
            className="pb-2 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
            onClick={() => setAmount(centsToInput(origin.current_cents))}
          >
            Tudo ({formatBRL(origin.current_cents)})
          </button>
        )}
        <Field label="Data" className="w-44">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <ErrorBox error={transfer.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid || transfer.isPending}>
          Transferir
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/**
 * Provento sem "Creditar em" entra no rendimento à parte. Se o dinheiro já está no saldo de outro ativo
 * e esse saldo for atualizado depois, o mesmo valor seria contado duas vezes: a dica avisa antes.
 */
export function proventoCreditHint(credited: boolean): string {
  if (credited) return "O valor entra no saldo do ativo escolhido e conta uma vez só no rendimento.";
  return "Se o dinheiro já está no saldo de outro ativo (ex.: conta da corretora), escolha-o aqui. Sem isso, o provento soma ao rendimento à parte e, se você atualizar o saldo daquele ativo, pode ser contado duas vezes.";
}

function ProventoForm({ assets, onDone }: { assets: Asset[]; onDone: () => void }) {
  const register = useRegisterProvento();
  const [asset, setAsset] = useState("");
  const [credited, setCredited] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());

  const cents = parseMoneyToCents(amount);
  const valid = asset !== "" && cents !== null && cents > 0 && asset !== credited;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || cents === null) return;
    register.mutate(
      { asset_id: Number(asset), amount_cents: cents, date, credited_asset_id: credited === "" ? null : Number(credited) },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Registre dividendos, rendimentos de FIIs ou JCP recebidos. Se o dinheiro ficou na conta da corretora, escolha o ativo de saldo em
        conta para creditá-lo; depois, ao reinvestir, use <strong>Transferir</strong> desse saldo para o ativo comprado.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <AssetSelect label="Ativo que pagou" assets={assets} value={asset} onChange={setAsset} />
        <AssetSelect
          label="Creditar em (opcional)"
          assets={assets.filter((a) => String(a.id) !== asset)}
          value={credited}
          onChange={setCredited}
          allowEmpty="Só registrar, sem creditar"
          hint={proventoCreditHint(credited !== "")}
        />
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Valor recebido (R$)" error={amount !== "" && cents === null ? "Valor inválido." : null} className="w-44">
          <input inputMode="decimal" className={`${inputClass} tabular`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Data" className="w-44">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <ErrorBox error={register.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid || register.isPending}>
          Registrar provento
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function AporteForm({ assets, onDone }: { assets: Asset[]; onDone: () => void }) {
  const save = useSaveClosing();
  const [asset, setAsset] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(todayISO());
  const [balance, setBalance] = useState("");
  const [useCash, setUseCash] = useState(false);
  const [bought, setBought] = useState("");
  const [quote, setQuote] = useState("");
  const [offGoal, setOffGoal] = useState(false);
  const accounts = useAccounts();
  const reasonId = useId();
  const offGoalHelpId = useId();

  const selected = assets.find((a) => String(a.id) === asset);
  const isCrypto = selected?.class_key === "cripto";
  // Cripto com quantidade cadastrada: o aporte é "quantas moedas, a que cotação" e o app faz as contas.
  const byQuantity = isCrypto && parseQuantity(selected?.quantity) !== null;
  const boughtOk = parseQuantity(bought) !== null;
  const cents = byQuantity ? valueFromQuote(bought, quote) : parseMoneyToCents(amount);
  const newQuantity = byQuantity && boughtOk ? addQuantities(selected?.quantity, bought) : null;
  const newBalance = newQuantity ? valueFromQuote(newQuantity, quote) : null;
  const link = cashLink(selected?.account_id ?? null, accounts.data ?? [], day);
  const takesCash = useCash && link.kind === "ledger";
  const cashProblem = takesCash && cents !== null ? cashUseProblem(link.account.name, cents, link.account.balance_cents) : null;
  const balanceCents = balance.trim() === "" ? null : parseMoneyToCents(balance);
  // Sem saldo informado, o app assume o saldo registrado mais o aporte.
  const assumed = selected && cents !== null ? selected.current_cents + cents : null;
  const valid =
    selected !== undefined &&
    cents !== null &&
    cents > 0 &&
    day !== "" &&
    day <= todayISO() &&
    (byQuantity ? newBalance !== null : balance.trim() === "" || balanceCents !== null) &&
    cashProblem === null;

  function submit(event: FormEvent) {
    event.preventDefault();
    const final = byQuantity ? newBalance : (balanceCents ?? assumed);
    if (!valid || !selected || cents === null || final === null) return;
    const today = todayISO();
    save.mutate(
      [
        {
          id: selected.id,
          input: {
            date: today,
            balance_cents: final,
            contribution_cents: cents,
            contribution_date: day === today ? undefined : day,
            ...(takesCash && { use_cash: true }),
            ...(offGoal && { off_goal: true }),
            ...(byQuantity && { quantity_added: addQuantities(null, bought) ?? undefined }),
          },
        },
      ],
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Registre dinheiro novo colocado em um ativo. O valor soma ao investido e o saldo do ativo é atualizado: informe o saldo do extrato
        já com o aporte ou deixe em branco para o app somar o aporte ao saldo registrado. O <strong>dia do aporte</strong> precisa ser
        depois do último saldo do ativo; é ele que permite medir quantos % do CDI o ativo rendeu.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <AssetSelect label="Ativo" assets={assets} value={asset} onChange={setAsset} />
        {!byQuantity && (
          <Field label="Valor do aporte (R$)" error={amount !== "" && cents === null ? "Valor inválido." : null} className="w-44">
            <input inputMode="decimal" className={`${inputClass} tabular`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
          </Field>
        )}
        <Field label="Dia do aporte" className="w-44" error={day > todayISO() ? "Não pode ser no futuro." : null}>
          <input type="date" max={todayISO()} className={inputClass} value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
      </div>
      {isCrypto && !byQuantity && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {selected?.name} não tem a quantidade de moedas cadastrada. Informe o valor em R$ abaixo, ou edite o ativo e preencha a quantidade para
          aportar por quantidade e cotação.
        </p>
      )}
      {byQuantity && selected && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-4">
            <Field
              label="Quantidade comprada"
              error={bought !== "" && !boughtOk ? "Quantidade inválida (até 8 casas decimais)." : null}
              hint={`Você tem ${selected.quantity} em ${selected.name}.`}
              className="w-56"
            >
              <input inputMode="decimal" className={`${inputClass} tabular`} value={bought} onChange={(e) => setBought(e.target.value)} placeholder="Ex.: 0,0012" />
            </Field>
            <Field
              label="Cotação (R$ por moeda)"
              error={quote.trim() !== "" && valueFromQuote("1", quote) === null ? "Cotação inválida." : null}
              className="w-56"
            >
              <input inputMode="decimal" className={`${inputClass} tabular`} value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="Ex.: 350.000,00" />
            </Field>
            {selected.ticker ? (
              <FetchQuoteButton ticker={selected.ticker} assetName={selected.name} className="pb-2" onQuote={setQuote} />
            ) : (
              <p className="pb-2 text-xs text-slate-500 dark:text-slate-400">Preencha o ticker no cadastro (ex.: BTC) para buscar a cotação.</p>
            )}
          </div>
          {cents !== null && newQuantity && newBalance !== null && (
            <p role="status" className="tabular text-sm text-slate-700 dark:text-slate-300">
              Aporte de <strong>{formatBRL(cents)}</strong>. Depois dele você terá <strong>{newQuantity}</strong> moedas, no saldo de{" "}
              <strong>{formatBRL(newBalance)}</strong> pela cotação informada.
            </p>
          )}
        </div>
      )}
      {!byQuantity && (
      <div className="flex flex-wrap items-end gap-4">
        <Field
          label="Saldo atual do ativo, com o aporte (R$) — opcional"
          error={balance.trim() !== "" && balanceCents === null ? "Valor inválido." : null}
          hint={
            selected
              ? assumed !== null && balance.trim() === ""
                ? `Em branco: o saldo passa de ${formatBRL(selected.current_cents)} para ${formatBRL(assumed)}. Último saldo em ${formatDate(selected.valuation_date)}.`
                : `Último saldo registrado: ${formatBRL(selected.current_cents)} em ${formatDate(selected.valuation_date)}.`
              : undefined
          }
          className="w-96 max-w-full"
        >
          <input inputMode="decimal" className={`${inputClass} tabular`} value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="Ex.: 803,91" />
        </Field>
      </div>
      )}
      {selected && cents !== null && (
        <CashContributionNote
          link={link}
          assetName={selected.name}
          cents={cents}
          useCash={useCash}
          onUseCashChange={setUseCash}
          problem={cashProblem}
          problemId={reasonId}
        />
      )}
      <div>
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            className="size-4 accent-blue-600"
            checked={offGoal}
            onChange={(e) => setOffGoal(e.target.checked)}
            aria-describedby={offGoalHelpId}
          />
          {OFF_GOAL_LABEL}
        </label>
        <p id={offGoalHelpId} className="ml-6 text-xs text-slate-600 dark:text-slate-400">
          {OFF_GOAL_HELP}
        </p>
      </div>
      <ErrorBox error={save.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid || save.isPending} aria-describedby={cashProblem ? reasonId : undefined}>
          Registrar aporte
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export type MovementForm = "aporte" | "transfer" | "provento" | "resgate";

/**
 * Aportes, proventos e transferências do mês, com os formulários para registrá-los.
 * `requestedForm` abre um formulário a pedido de fora (os botões da Carteira); `onRequestHandled` avisa que já abriu.
 * `requestedAssetId` chega com o pedido de resgate (ex.: "Usei a reserva") e já escolhe o ativo.
 */
export function MovementsCard({
  requestedForm = null,
  requestedAssetId = null,
  onRequestHandled,
  initialMonth,
}: {
  requestedForm?: MovementForm | null;
  requestedAssetId?: number | null;
  onRequestHandled?: () => void;
  /** Mês aberto de início (ex.: vindo de "Ver movimento" no extrato do caixa). */
  initialMonth?: string;
}) {
  const [month, setMonth] = useState(initialMonth ?? currentMonth());
  const [form, setForm] = useState<MovementForm | null>(null);
  const [editing, setEditing] = useState<Movement | null>(null);
  const [notice, setNotice] = useState<string | MoneyTextPart[] | null>(null);
  const [redeemed, setRedeemed] = useState<RedemptionDone | null>(null);
  const [redeemAsset, setRedeemAsset] = useState<number | null>(null);
  // Ao fechar um formulário ou uma edição, o foco volta ao botão que o abriu (que some enquanto ele está aberto).
  const triggers = useRef<Partial<Record<MovementForm, HTMLButtonElement | null>>>({});
  const editButtons = useRef(new Map<number, HTMLButtonElement | null>());
  const [focusBack, setFocusBack] = useState<{ form: MovementForm } | { edit: number } | null>(null);
  const assets = useAssets(false);
  const movements = useMovements({ month });
  const remove = useDeleteMovement();
  const undo = useUndoMovement();
  const uncount = useUncountInitial();
  const setOffGoalFlag = useSetOffGoal();
  const { confirm, dialog } = useConfirm();
  const summary = useMonthSummary(month);

  function open(next: MovementForm, assetId: number | null = null) {
    setNotice(null);
    setRedeemed(null);
    setEditing(null);
    setRedeemAsset(assetId);
    setForm(next);
  }

  function closeForm() {
    if (form) setFocusBack({ form });
    setForm(null);
  }

  function closeEdit() {
    if (editing) setFocusBack({ edit: editing.id });
    setEditing(null);
  }

  useEffect(() => {
    if (!requestedForm) return;
    open(requestedForm, requestedForm === "resgate" ? requestedAssetId : null);
    onRequestHandled?.();
    // `open` só mexe em estado: não precisa ser dependência.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedForm, requestedAssetId, onRequestHandled]);

  useEffect(() => {
    if (!focusBack || form !== null || editing !== null) return;
    const target = "form" in focusBack ? triggers.current[focusBack.form] : editButtons.current.get(focusBack.edit);
    // Se o gatilho não existe mais (ex.: o movimento foi desfeito), o foco fica onde está.
    target?.focus();
    setFocusBack(null);
  }, [focusBack, form, editing]);

  const list = movements.data ?? [];
  const totals = summary.data;

  return (
    <Card
      title="Movimentações"
      action={
        form === null &&
        editing === null && (
          <div className="flex flex-wrap gap-2">
            <Button
              ref={(el) => {
                triggers.current.aporte = el;
              }}
              variant="secondary"
              disabled={(assets.data ?? []).length === 0}
              onClick={() => open("aporte")}
            >
              Registrar aporte
            </Button>
            <Button
              ref={(el) => {
                triggers.current.transfer = el;
              }}
              variant="secondary"
              disabled={(assets.data ?? []).length < 2}
              onClick={() => open("transfer")}
            >
              Transferir entre ativos
            </Button>
            <Button
              ref={(el) => {
                triggers.current.provento = el;
              }}
              variant="secondary"
              disabled={(assets.data ?? []).length === 0}
              onClick={() => open("provento")}
            >
              Registrar provento
            </Button>
            <Button
              ref={(el) => {
                triggers.current.resgate = el;
              }}
              variant="secondary"
              disabled={(assets.data ?? []).length === 0}
              onClick={() => open("resgate")}
            >
              Resgatar
            </Button>
          </div>
        )
      }
    >
      {dialog}
      {form === "aporte" && <AporteForm assets={assets.data ?? []} onDone={closeForm} />}
      {form === "transfer" && <TransferForm assets={assets.data ?? []} onDone={closeForm} />}
      {form === "provento" && <ProventoForm assets={assets.data ?? []} onDone={closeForm} />}
      {/* Espera os ativos chegarem: o link da reserva (?ativo=) já abre com o ativo escolhido. */}
      {form === "resgate" && !assets.data && <Loading label="Carregando os ativos…" />}
      {form === "resgate" && assets.data && (
        <RedemptionForm
          assets={assets.data}
          initialAssetId={redeemAsset}
          onCancel={closeForm}
          onDone={(done) => {
            closeForm();
            setRedeemed(done);
          }}
        />
      )}
      {editing &&
        (editing.kind === "resgate" ? (
          <EditRedemptionNote
            key={editing.id}
            movement={editing}
            onCancel={closeEdit}
            onDone={(message) => {
              closeEdit();
              setNotice(message);
            }}
          />
        ) : (
          <EditMovementForm
            key={editing.id}
            movement={editing}
            onCancel={closeEdit}
            onDone={(message) => {
              closeEdit();
              setNotice(message);
            }}
          />
        ))}
      {notice && form === null && editing === null && (
        <p role="status" className="mb-3 text-sm text-emerald-700 dark:text-emerald-400">
          {typeof notice === "string" ? notice : <MoneyText parts={notice} />}
        </p>
      )}
      {redeemed && form === null && editing === null && (
        <RedemptionNotice done={redeemed} asset={(assets.data ?? []).find((a) => a.id === redeemed.movement.asset_id)} />
      )}

      <div className={cx("flex flex-wrap items-end gap-4", (form !== null || editing !== null) && "mt-4")}>
        <div className="shrink-0">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Mês</span>
          <MonthInput value={month} onChange={setMonth} aria-label="Mês das movimentações" />
        </div>
        {/* O total do mês soma os aportes lançados e os investimentos novos cadastrados no mês. */}
        {totals ? (
          <p className="tabular pb-2 text-sm text-slate-600 dark:text-slate-400">
            Aportes: <strong><Money cents={totals.registered_cents} /></strong> · Ativos novos:{" "}
            <strong><Money cents={totals.new_assets_cents} /></strong> · Total investido no mês:{" "}
            <strong className="text-slate-900 dark:text-slate-100"><Money cents={totals.total_cents} /></strong> · Proventos:{" "}
            <strong><Money cents={totals.proventos_cents} /></strong>
            {totals.off_goal_cents > 0 && (
              <>
                {" "}
                · Fora da meta: <strong><Money cents={totals.off_goal_cents} /></strong>
              </>
            )}
            {totals.redemptions_cents > 0 && (
              <>
                {" "}
                · Resgates: <strong><Money cents={totals.redemptions_cents} /></strong> ·{" "}
                <Link
                  to="/carteira/retiradas"
                  className="rounded font-medium text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:text-blue-300"
                >
                  Ver todas as retiradas
                </Link>
              </>
            )}
          </p>
        ) : (
          <p className="pb-2 text-sm text-slate-500 dark:text-slate-400">
            {summary.isError ? "Não foi possível carregar os totais do mês. Recarregue a página para tentar de novo." : "Somando o mês…"}
          </p>
        )}
      </div>

      {movements.isLoading && <Loading />}
      <ErrorBox error={movements.error ?? remove.error ?? undo.error ?? uncount.error ?? setOffGoalFlag.error} />
      {!movements.isLoading && list.length === 0 && (
        <div className="mt-3">
          <Empty>Nenhuma movimentação em {formatMonth(month)}. Use &quot;Registrar aporte&quot; ou &quot;Atualizar saldos&quot; para lançar aportes, ou &quot;Resgatar&quot; se tirou dinheiro de um ativo.</Empty>
        </div>
      )}
      {list.length > 0 && (
        <>
          <p className="mt-3 text-xs text-slate-600 md:hidden dark:text-slate-400">
            No celular, arraste a lista para o lado para ver as ações de cada linha (Tirar da meta, Editar, Desfazer).
          </p>
          {/* `relative`: o texto só para leitor de tela (sr-only) é absoluto e, sem isso, escapava do overflow e alargava a página. */}
          <ScrollRegion
            label="Movimentações do mês"
            className="relative mt-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 md:mt-3"
          >
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="pb-2 font-medium">Data</th>
                  <th className="pb-2 font-medium">Tipo</th>
                  <th className="pb-2 font-medium">Ativo</th>
                  <th className="pb-2 text-right font-medium">Valor</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {list.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2">{formatDate(m.date)}</td>
                    <td className="py-2">
                      <span className="flex flex-wrap items-center gap-1">
                        <span className={cx("rounded px-1.5 py-0.5 text-xs font-medium", KIND_STYLE[m.kind])}>{KIND_LABEL[m.kind]}</span>
                        {m.initial && <Badge tone="gold">Ativo novo</Badge>}
                        {m.kind === "aporte" && m.off_goal && <Badge>Fora da meta</Badge>}
                      </span>
                    </td>
                    <td className="py-2">
                      {describe(m)}
                      {m.kind === "resgate" && m.note && (
                        <span className="block text-xs text-slate-600 dark:text-slate-400">Motivo: {m.note}</span>
                      )}
                      {m.kind === "resgate" && m.in_balance && (
                        <span className="block text-xs text-slate-600 dark:text-slate-400">O saldo registrado já estava sem esse dinheiro</span>
                      )}
                    </td>
                    <td className="tabular whitespace-nowrap py-2 text-right font-semibold">
                      {m.kind === "resgate" && "− "}
                      <Money cents={m.amount_cents} />
                    </td>
                    <td className="whitespace-nowrap py-2 text-right">
                      {canBeOffGoal(m) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={setOffGoalFlag.isPending}
                          onClick={() => {
                            setNotice(null);
                            setRedeemed(null);
                            setOffGoalFlag.mutate(
                              { id: m.id, offGoal: !m.off_goal },
                              { onSuccess: () => setNotice(offGoalDone(m, !m.off_goal)) },
                            );
                          }}
                        >
                          {offGoalActionLabel(m)}
                          <span className="sr-only">
                            : aporte de <Money cents={m.amount_cents} /> em {m.asset_name}
                          </span>
                        </Button>
                      )}
                      {/* O aporte do cadastro não se edita nem se desfaz: o valor é o saldo inicial do ativo. Só pode deixar de contar. */}
                      {m.initial ? (
                        <Button
                          variant="ghost"
                          // Quebra em duas linhas no celular, para a tabela não alargar.
                          size="sm" className="whitespace-normal text-right"
                          aria-label={`Não contar como aporte: ${m.asset_name}`}
                          disabled={uncount.isPending}
                          onClick={async () => {
                            if (!(await confirm({ ...splitQuestion(uncountMessage(m)), confirmLabel: "Não contar como aporte", tone: "primary" }))) return;
                            setNotice(null);
                            uncount.mutate(m, { onSuccess: () => setNotice(uncountDone(m)) });
                          }}
                        >
                          Não contar como aporte
                        </Button>
                      ) : (
                        <>
                          <Button
                            ref={(el) => {
                              editButtons.current.set(m.id, el);
                            }}
                            variant="ghost"
                            className="px-2 py-1 text-xs"
                            aria-label={`Editar ${KIND_LABEL[m.kind].toLowerCase()} de ${m.asset_name}`}
                            onClick={() => {
                              setForm(null);
                              setNotice(null);
                              setRedeemed(null);
                              setEditing(m);
                            }}
                          >
                            Editar
                          </Button>
                          {m.kind === "provento" && m.related_asset_id === null ? (
                            <Button
                              variant="ghost" size="sm"
                              aria-label={`Excluir provento de ${m.asset_name}`}
                              onClick={() => remove.mutate(m.id)}
                            >
                              Excluir
                            </Button>
                          ) : (
                            <Button
                              variant="ghost" size="sm"
                              aria-label={`Desfazer ${KIND_LABEL[m.kind].toLowerCase()} de ${m.asset_name}`}
                              disabled={undo.isPending}
                              onClick={async () => {
                                if (await confirm({ ...splitQuestion(undoMessage(m)), confirmLabel: "Desfazer movimento" })) {
                                  setRedeemed(null);
                                  undo.mutate(m.id);
                                }
                              }}
                            >
                              Desfazer
                            </Button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </>
      )}
    </Card>
  );
}
