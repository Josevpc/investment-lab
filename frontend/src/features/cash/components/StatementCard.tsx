import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatDate, todayISO } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { Badge, Button, Card, Empty, Loading, Money, Segmented, splitQuestion, useConfirm } from "@/shared/ui";
import { useDeleteEntry, useStatement } from "../hooks";
import { deleteMessage, describeEntry, KIND_LABEL, lockedReason, periodLabel, periodStart, PERIODS, type EntryNames, type PeriodKey } from "../lib/entries";
import type { Account, Entry, EntryKind } from "../types";
import { CashError, SignedMoney } from "./parts";

const TONE: Record<EntryKind, "neutral" | "gold" | "good"> = {
  saldo_inicial: "gold",
  deposito: "good",
  provento: "good",
  venda: "good",
  compra: "neutral",
  taxa: "neutral",
  retirada: "neutral",
  ajuste: "neutral",
  transferencia: "neutral",
};

function EntryRow({
  entry,
  account,
  names,
  onDelete,
  deleting,
}: {
  entry: Entry;
  account: Account;
  names: EntryNames;
  onDelete: (entry: Entry) => void;
  deleting: boolean;
}) {
  const description = describeEntry(entry, names);
  const locked = lockedReason(entry);
  const what = `${KIND_LABEL[entry.kind].toLowerCase()} de ${formatDate(entry.date)}`;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 py-3 md:grid-cols-[minmax(0,1fr)_9rem_10rem_8.5rem] md:items-center">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone={TONE[entry.kind]}>{KIND_LABEL[entry.kind]}</Badge>
          <span className="tabular text-xs text-slate-500 dark:text-slate-400">{formatDate(entry.date)}</span>
        </p>
        <p className="mt-1 break-words text-sm font-medium text-slate-800 dark:text-slate-200">{description}</p>
        {locked && entry.movement_id === null && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{locked}</p>}
      </div>
      <p className="text-right text-sm">
        <SignedMoney cents={entry.amount_cents} />
      </p>
      <p className="text-xs text-slate-500 md:text-right md:text-sm dark:text-slate-400">
        <span className="md:sr-only">Saldo depois: </span>
        <Money cents={entry.balance_cents} className="text-slate-700 dark:text-slate-300" />
      </p>
      <div className="text-right">
        {entry.deletable && !account.archived && (
          <Button
            variant="ghost" size="sm"
            aria-label={`Excluir ${what}`}
            disabled={deleting}
            onClick={() => onDelete(entry)}
          >
            Excluir
          </Button>
        )}
        {entry.movement_id !== null && (
          <Link
            to={`/carteira/movimentacoes?mes=${entry.date.slice(0, 7)}`}
            title={locked ?? undefined}
            aria-label={`Ver movimento: ${what}, em Movimentações`}
            aria-describedby={`motivo-${entry.id}`}
            className="inline-flex min-h-10 items-center px-2 text-xs font-medium text-blue-700 hover:underline dark:text-blue-300"
          >
            Ver movimento
            <span id={`motivo-${entry.id}`} className="sr-only">
              {locked}
            </span>
          </Link>
        )}
      </div>
    </li>
  );
}

/** Extrato da conta: do mais recente ao mais antigo, com o saldo depois de cada lançamento. */
export function StatementCard({
  account,
  names,
  onNotice,
}: {
  account: Account;
  names: EntryNames;
  onNotice: (message: MoneyTextPart[]) => void;
}) {
  const today = todayISO();
  const [period, setPeriod] = useState<PeriodKey>("3m");
  const start = periodStart(period, today);
  const statement = useStatement(account.id, start, account.cash_enabled);
  const remove = useDeleteEntry();
  const { confirm, dialog } = useConfirm();
  const listRef = useRef<HTMLUListElement>(null);
  const entries = statement.data?.entries ?? [];
  const fromMovements = entries.some((e) => e.movement_id !== null);

  async function onDelete(entry: Entry) {
    const ok = await confirm({ ...splitQuestion(deleteMessage(entry, account.name, names)), confirmLabel: "Excluir lançamento" });
    if (!ok) return;
    const after = entry.date <= today ? account.balance_cents - entry.amount_cents : account.balance_cents;
    remove.mutate(entry.id, {
      onSuccess: () => {
        // A linha excluída some; o foco fica na lista, em vez de cair no começo da página.
        listRef.current?.focus();
        onNotice(
          entry.kind === "saldo_inicial"
            ? ["Saldo inicial excluído. O caixa desta conta está desativado; ative de novo quando quiser."]
            : [`${KIND_LABEL[entry.kind]} de `, { cents: Math.abs(entry.amount_cents) }, ` (${formatDate(entry.date)}) excluído. Caixa de hoje: `, { cents: after }, "."],
        );
      },
    });
  }

  return (
    <Card
      title="Extrato do caixa"
      action={<Segmented label="Período do extrato" value={period} options={PERIODS} onChange={setPeriod} />}
    >
      {dialog}
      <p className="-mt-2 mb-3 text-xs text-slate-500 dark:text-slate-400">
        Lançamentos {periodLabel(period, today)}, do mais recente ao mais antigo. O saldo depois de cada um conta desde o saldo inicial.
      </p>
      {statement.isLoading && <Loading label="Carregando o extrato..." />}
      <CashError error={statement.error ?? remove.error} />
      {statement.data && entries.length === 0 && (
        <Empty>
          Nenhum lançamento {period === "tudo" ? "ainda" : "neste período"}.{" "}
          {period !== "tudo" ? "Veja “Tudo” para o extrato completo, ou registre um lançamento." : "Registre um depósito ou uma compra para começar."}
        </Empty>
      )}
      {entries.length > 0 && (
        <>
          <div
            aria-hidden
            className="hidden border-b border-slate-200 pb-2 text-xs font-medium uppercase tracking-wide text-slate-500 md:grid md:grid-cols-[minmax(0,1fr)_9rem_10rem_8.5rem] md:gap-x-3 dark:border-slate-800 dark:text-slate-400"
          >
            <span>Lançamento</span>
            <span className="text-right">Valor</span>
            <span className="text-right">Saldo depois</span>
            <span />
          </div>
          <ul
            ref={listRef}
            tabIndex={-1}
            aria-label={`Lançamentos de ${account.name}`}
            className="divide-y divide-slate-100 focus:outline-none dark:divide-slate-800"
          >
            {entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} account={account} names={names} onDelete={onDelete} deleting={remove.isPending} />
            ))}
          </ul>
          {statement.data && (
            <p className="mt-3 border-t border-slate-200 pt-3 text-right text-sm dark:border-slate-800">
              Caixa hoje: <strong className="font-serif text-base"><Money cents={statement.data.balance_cents} /></strong>
            </p>
          )}
          {fromMovements && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Compras, proventos e o dinheiro novo dos aportes vêm de movimentos da carteira. Para corrigi-los, use “Ver movimento” e edite
              ou desfaça lá; o caixa acompanha.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
