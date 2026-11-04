import { formatDate } from "@/shared/lib/format";
import { MAX_CENTS, TOO_BIG } from "./entries";

/** Quanto falta no caixa de hoje para a compra (0 se cobre). */
export function purchaseShortfall(cents: number | null, balanceCents: number): number {
  return cents !== null && cents > balanceCents ? cents - balanceCents : 0;
}

/**
 * Motivo para não deixar comprar ainda; null quando pode enviar. A data precisa ser a partir do saldo
 * inicial da conta e do último saldo do ativo (o back-end recusa antes disso).
 */
export function purchaseProblem(input: {
  asset: { valuation_date: string; name: string } | undefined;
  cents: number | null;
  date: string;
  today: string;
  openingDate: string | null;
  balanceCents: number;
  depositShortfall: boolean;
}): string | null {
  const { asset, cents, date, today, openingDate, balanceCents, depositShortfall } = input;
  if (!asset) return "Escolha o ativo comprado.";
  if (cents === null || cents <= 0) return "Informe um valor maior que zero.";
  if (cents > MAX_CENTS) return TOO_BIG;
  if (date === "") return "Informe a data.";
  if (date > today) return "A data não pode ser no futuro.";
  if (openingDate && date < openingDate) return `A data precisa ser a partir de ${formatDate(openingDate)}, quando o caixa foi ativado.`;
  if (date < asset.valuation_date) {
    return `A data precisa ser a partir de ${formatDate(asset.valuation_date)}, o último saldo registrado de ${asset.name}.`;
  }
  if (purchaseShortfall(cents, balanceCents) > 0 && !depositShortfall) {
    return "O caixa de hoje não cobre a compra. Marque o depósito da diferença ou diminua o valor.";
  }
  return null;
}
