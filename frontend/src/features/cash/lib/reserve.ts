import type { Asset, AssetClass } from "@/features/portfolio";
import { formatBRL, formatDate, formatMonth } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import type { Reservation, ReservationsOverview } from "../types";
import { dateProblem, MAX_CENTS, TOO_BIG } from "./entries";

// ---- separar ---------------------------------------------------------------------------------

/**
 * Categorias que aceitam dinheiro separado: não arquivadas e que ainda podem comprar. Uma categoria só com
 * ativos "manter posição" ou só com a reserva de emergência não recebe compras, então a API recusaria.
 * Sem ativos ainda, a categoria vale (o ativo pode vir depois).
 */
export function validReserveClasses(classes: readonly AssetClass[], assets: readonly Asset[]): AssetClass[] {
  return classes.filter((c) => {
    if (c.archived) return false;
    const mine = assets.filter((a) => a.class_key === c.key && !a.archived);
    return mine.length === 0 || mine.some((a) => !a.hold_only && a.purpose !== "reserva");
  });
}

/** Motivo para não deixar separar ainda (o botão fica desabilitado e o motivo aparece). Null: pode enviar. */
export function reserveProblem(input: {
  classId: number | null;
  cents: number | null;
  date: string;
  today: string;
  openingDate: string | null;
  freeCents: number;
  deposit: boolean;
}): string | null {
  const { classId, cents, date, today, openingDate, freeCents, deposit } = input;
  if (classId === null) return "Escolha a categoria.";
  if (cents === null || cents <= 0) return "Informe um valor maior que zero.";
  if (cents > MAX_CENTS) return TOO_BIG;
  const problem = dateProblem(date, today, openingDate);
  if (problem) return problem;
  if (cents > freeCents && !deposit) {
    return "O caixa livre não cobre esse valor. Marque “Depositar agora e separar” ou diminua o valor.";
  }
  return null;
}

/** Como ficam os números da conta depois de separar. Com depósito, o valor inteiro entra no caixa e é separado. */
export function reserveEffect(input: { cents: number; balanceCents: number; freeCents: number; reservedCents: number; deposit: boolean }) {
  const { cents, balanceCents, freeCents, reservedCents, deposit } = input;
  const deposited = deposit ? cents : 0;
  return {
    deposited,
    freeAfter: freeCents + deposited - cents,
    reservedAfter: reservedCents + cents,
    totalAfter: balanceCents + deposited,
  };
}

/** Frase de sucesso: o que foi feito, como ficou o caixa livre e o que vem a seguir. */
export function reserveSuccess(input: { cents: number; className: string; date: string; deposited: number; freeAfter: number }): MoneyTextPart[] {
  const { cents, className, date, deposited, freeAfter } = input;
  return [
    ...(deposited > 0 ? ["Depositados ", { cents: deposited }, " e separados "] : [{ cents }, " separados "]),
    `para ${className} (${formatDate(date)}). Caixa livre: `,
    { cents: freeAfter },
    `. O dinheiro continua na conta, ainda não investido. Quando comprar um ativo de ${className} com o caixa desta conta, o valor sai do separado primeiro.`,
  ];
}

// ---- compra com caixa ------------------------------------------------------------------------

/**
 * Quanto do separado para a categoria pode pagar uma compra naquela data. Separação datada depois da compra
 * não existia ainda e fica de fora (a API também as ignora).
 */
export function eligibleReserved(reservations: readonly Reservation[], className: string | undefined, date: string): number {
  if (!className) return 0;
  return reservations
    .filter((r) => r.class_name === className && r.date <= date)
    .reduce((sum, r) => sum + r.remaining_cents, 0);
}

/** A compra gasta primeiro o separado da categoria; o resto sai do caixa livre. */
export function purchaseSplit(cents: number, eligibleCents: number): { fromReserved: number; fromFree: number } {
  const fromReserved = Math.min(cents, Math.max(0, eligibleCents));
  return { fromReserved, fromFree: cents - fromReserved };
}

/** Frase de sucesso da compra quando a conta tem dinheiro separado. */
export function purchaseSuccessWithReserved(input: {
  cents: number;
  assetName: string;
  className: string;
  date: string;
  fromReserved: number;
  fromFree: number;
  reservedLeft: number;
  depositCents: number;
  cashBalance: number;
}): MoneyTextPart[] {
  const { cents, assetName, className, date, fromReserved, fromFree, reservedLeft, depositCents, cashBalance } = input;
  return [
    "Compra registrada. ",
    { cents: fromReserved },
    " saíram do separado e ",
    { cents: fromFree },
    " do caixa livre.",
    ...(reservedLeft > 0 ? [" Ainda há ", { cents: reservedLeft }, ` separados para ${className}.`] : []),
    " A compra de ",
    { cents },
    ` em ${assetName} (${formatDate(date)}) entrou no investido e conta como aporte do mês.`,
    ...(depositCents > 0 ? [" Inclui depósito de ", { cents: depositCents }, " de dinheiro novo."] : []),
    " Caixa ao fim do dia: ",
    { cents: cashBalance },
    ". Para desfazer, use Movimentações.",
  ];
}

// ---- liberar e excluir -----------------------------------------------------------------------

export function releaseProblem(cents: number | null, remainingCents: number): string | null {
  if (cents === null || cents <= 0) return "Informe um valor maior que zero.";
  if (cents > remainingCents) return `O máximo que dá para liberar é ${formatBRL(remainingCents)}, o que ainda está separado.`;
  return null;
}

/** Mês em que foi separado, para dizer que ele continua contado depois de liberar. */
export function reservedMonth(reservation: Pick<Reservation, "date">): string {
  return formatMonth(reservation.date.slice(0, 7));
}

export function releaseSuccess(reservation: Reservation, cents: number, freeAfter: number): MoneyTextPart[] {
  const all = cents === reservation.remaining_cents;
  return [
    { cents },
    ` liberados de ${reservation.class_name} (separado em ${formatDate(reservation.date)}): voltaram ao caixa livre, que agora tem `,
    { cents: freeAfter },
    `. O mês ${reservedMonth(reservation)} continua contado. `,
    all ? "Para separar de novo, use “Separar para comprar”." : "O resto continua separado.",
  ];
}

export function deleteReservationQuestion(reservation: Reservation): string {
  return `Excluir a separação de ${formatBRL(reservation.amount_cents)} para ${reservation.class_name} de ${formatDate(reservation.date)}? Ela sai da lista e o valor volta ao caixa livre.`;
}

export function deleteReservationSuccess(reservation: Reservation, freeAfter: number): MoneyTextPart[] {
  return [
    "Separação de ",
    { cents: reservation.amount_cents },
    ` para ${reservation.class_name} (${formatDate(reservation.date)}) excluída. O valor está no caixa livre, que agora tem `,
    { cents: freeAfter },
    ".",
  ];
}

// ---- lista agrupada --------------------------------------------------------------------------

export interface ReservationGroup {
  classId: number;
  className: string;
  /** Ausente quando a categoria só tem separações encerradas (a API só manda a cor das que têm restante). */
  color: string | null;
  remainingCents: number;
  items: Reservation[];
}

/** Separações por categoria: as categorias com restante primeiro (na ordem da API), depois as só encerradas. */
export function groupReservations(overview: Pick<ReservationsOverview, "by_class" | "reservations">): ReservationGroup[] {
  const groups = new Map<number, ReservationGroup>();
  for (const c of overview.by_class) {
    groups.set(c.class_id, { classId: c.class_id, className: c.class_name, color: c.color, remainingCents: c.remaining_cents, items: [] });
  }
  for (const r of overview.reservations) {
    let group = groups.get(r.class_id);
    if (!group) {
      group = { classId: r.class_id, className: r.class_name, color: null, remainingCents: 0, items: [] };
      groups.set(r.class_id, group);
    }
    group.items.push(r);
  }
  return [...groups.values()].filter((g) => g.items.length > 0);
}
