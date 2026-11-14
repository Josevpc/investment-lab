import { useRef, useState } from "react";
import { centsToInput, formatDate, parseMoneyToCents } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { Badge, Button, Card, Dialog, Empty, Field, inputClass, Loading, Money, Notice, splitQuestion, Swatch, useConfirm } from "@/shared/ui";
import { useDeleteReservation, useReleaseReservation, useReservations } from "../hooks";
import {
  deleteReservationQuestion,
  deleteReservationSuccess,
  groupReservations,
  releaseProblem,
  releaseSuccess,
  reservedMonth,
} from "../lib/reserve";
import { freeCents } from "../lib/split";
import type { Account, Reservation } from "../types";
import { CashError, SubmitRow } from "./parts";

/** Liberar tudo ou parte do que está separado: o valor volta ao caixa livre. A confirmação diz o efeito antes. */
function ReleaseDialog({
  reservation,
  accountName,
  onClose,
  onDone,
}: {
  reservation: Reservation;
  accountName: string;
  onClose: () => void;
  onDone: (cents: number) => void;
}) {
  const release = useReleaseReservation();
  const [amount, setAmount] = useState(centsToInput(reservation.remaining_cents));
  const cents = amount.trim() === "" ? null : parseMoneyToCents(amount);
  const problem = releaseProblem(cents, reservation.remaining_cents);
  const valid = cents !== null && problem === null;

  function submit() {
    if (!valid || cents === null) return;
    release.mutate({ id: reservation.id, amountCents: cents }, { onSuccess: () => onDone(cents) });
  }

  return (
    <Dialog
      title={`Liberar dinheiro separado para ${reservation.class_name}?`}
      onClose={onClose}
      description={
        <>
          O valor liberado volta ao caixa livre de {accountName}. O mês em que foi separado ({reservedMonth(reservation)}) continua contado.
        </>
      }
    >
      <form
        aria-label={`Liberar separado de ${reservation.class_name}`}
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field
          label="Valor a liberar (R$)"
          error={amount.trim() !== "" && cents === null ? "Valor inválido. Use o formato 1.234,56." : null}
        >
          <input inputMode="decimal" className={`${inputClass} tabular min-h-10`} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <p className="text-sm text-ink-3">
          Ainda separado nesta separação: <Money cents={reservation.remaining_cents} />
        </p>
        {valid && cents !== null && (
          <p className="text-sm text-ink-2">
            Voltam ao caixa livre <strong><Money cents={cents} /></strong>
            {cents < reservation.remaining_cents ? (
              <>
                {" "}e continuam separados <Money cents={reservation.remaining_cents - cents} />.
              </>
            ) : (
              "; nada mais fica separado nesta separação."
            )}
          </p>
        )}
        <CashError error={release.error} />
        <SubmitRow label="Liberar" pendingLabel="Liberando..." problem={problem} pending={release.isPending} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function ReservationRow({
  reservation,
  editable,
  busy,
  onRelease,
  onDelete,
}: {
  reservation: Reservation;
  editable: boolean;
  busy: boolean;
  onRelease: (r: Reservation) => void;
  onDelete: (r: Reservation) => void;
}) {
  const r = reservation;
  const closed = r.remaining_cents === 0;
  const what = `${r.class_name} de ${formatDate(r.date)}`;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          <span className="tabular">Separado em {formatDate(r.date)}</span>
          {closed && <Badge>Encerrada</Badge>}
        </p>
        <p className="mt-0.5 text-sm text-ink">
          Restante <strong className="tabular font-serif text-lg"><Money cents={r.remaining_cents} /></strong>
        </p>
        <p className="mt-0.5 text-xs text-ink-3">
          Valor separado <Money cents={r.amount_cents} /> · usado em compras <Money cents={r.used_cents} /> · liberado{" "}
          <Money cents={r.released_cents} />
        </p>
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-1">
          {!closed && (
            <Button variant="ghost" size="sm" disabled={busy} aria-label={`Liberar ${what}`} onClick={() => onRelease(r)}>
              Liberar
            </Button>
          )}
          {r.deletable && (
            <Button variant="ghost" size="sm" disabled={busy} aria-label={`Excluir ${what}`} onClick={() => onDelete(r)}>
              Excluir
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * "Separado nesta conta": o dinheiro do caixa que já tem categoria destino, agrupado por categoria. É daqui
 * que a pessoa devolve ao caixa livre (liberar) ou desfaz uma separação sem uso (excluir).
 */
export function ReservationsCard({ account, onNotice }: { account: Account; onNotice: (message: MoneyTextPart[]) => void }) {
  const [showClosed, setShowClosed] = useState(false);
  const [releasing, setReleasing] = useState<Reservation | null>(null);
  const overview = useReservations(account.id, account.cash_enabled, showClosed);
  const remove = useDeleteReservation();
  const { confirm, dialog } = useConfirm();
  const listRef = useRef<HTMLDivElement>(null);
  const editable = account.cash_enabled && !account.archived;

  if (!account.cash_enabled) {
    return (
      <Card title="Separado nesta conta">
        <Notice>Ative o caixa desta conta (informe o saldo do extrato) para poder separar dinheiro para comprar uma categoria.</Notice>
      </Card>
    );
  }

  const data = overview.data;
  const groups = data ? groupReservations(data) : [];
  const free = data ? data.free_cents : freeCents(account);
  // A linha sai da lista; o foco fica no bloco, em vez de cair no começo da página.
  const settle = (message: MoneyTextPart[]) => {
    setTimeout(() => listRef.current?.focus(), 0);
    onNotice(message);
  };

  async function onDelete(reservation: Reservation) {
    const ok = await confirm({ ...splitQuestion(deleteReservationQuestion(reservation)), confirmLabel: "Excluir separação" });
    if (!ok) return;
    remove.mutate(reservation.id, { onSuccess: () => settle(deleteReservationSuccess(reservation, free + reservation.remaining_cents)) });
  }

  return (
    <Card
      title="Separado nesta conta"
      action={
        <Button variant="ghost" size="sm" aria-pressed={showClosed} onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? "Esconder encerradas" : "Mostrar encerradas"}
        </Button>
      }
    >
      {dialog}
      {releasing && (
        <ReleaseDialog
          reservation={releasing}
          accountName={account.name}
          onClose={() => setReleasing(null)}
          onDone={(cents) => {
            const reservation = releasing;
            setReleasing(null);
            settle(releaseSuccess(reservation, cents, free + cents));
          }}
        />
      )}
      <div ref={listRef} tabIndex={-1} role="group" aria-label="Dinheiro separado por categoria" className="focus:outline-none">
        {overview.isLoading && <Loading label="Carregando o que está separado..." />}
        {overview.error && (
          <div className="space-y-2">
            <CashError error={overview.error} />
            <Button variant="secondary" size="sm" onClick={() => void overview.refetch()}>
              Tentar de novo
            </Button>
          </div>
        )}
        <CashError error={remove.error} />
        {data && (
          <>
            {data.reserved_cents > 0 && (
              <p className="mb-2 text-sm text-ink-2">
                Separado para comprar <strong><Money cents={data.reserved_cents} /></strong> (ainda não investido) · caixa livre{" "}
                <strong><Money cents={data.free_cents} /></strong>
              </p>
            )}
            {groups.length === 0 ? (
              <Empty>
                {showClosed
                  ? "Nenhuma separação ainda."
                  : "Nada separado. Separe parte do caixa para juntar a meta de uma categoria até poder comprar."}
              </Empty>
            ) : (
              <div className="space-y-5">
                {groups.map((group) => (
                  <section key={group.classId} aria-label={`Separado para ${group.className}`}>
                    <h3 className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-raise pb-1.5 text-sm font-medium text-ink">
                      <span className="flex items-center gap-2">
                        {group.color && <Swatch color={group.color} />}
                        {group.className}
                      </span>
                      <span className="text-ink-2">
                        Restante em {group.className}: <Money cents={group.remainingCents} />
                      </span>
                    </h3>
                    <ul aria-label={`Separações para ${group.className}`} className="divide-y divide-raise">
                      {group.items.map((r) => (
                        <ReservationRow
                          key={r.id}
                          reservation={r}
                          editable={editable}
                          busy={remove.isPending}
                          onRelease={setReleasing}
                          onDelete={onDelete}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
            {!editable && groups.length > 0 && (
              <p className="mt-3 text-xs text-ink-3">Esta conta está arquivada: o separado fica guardado, mas não dá para mexer nele.</p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
