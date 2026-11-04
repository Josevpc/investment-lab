import { formatDate } from "@/shared/lib/format";

/** O que o aporte precisa saber da conta do ativo (vem do caixa, pelo index público dele). */
export interface CashAccountInfo {
  id: number;
  name: string;
  archived: boolean;
  cash_enabled: boolean;
  opening_date: string | null;
  balance_cents: number;
}

/**
 * Como um aporte toca o caixa da conta do ativo:
 * - "none": conta sem caixa ativado (ou arquivada); o aporte fica só na carteira.
 * - "before": o dia do aporte é anterior ao saldo inicial; fica só na carteira, e "usar o caixa" não vale.
 * - "ledger": entra no caixa. Padrão: dinheiro novo (depósito + compra, o caixa não muda e o capital
 *   aportado sobe). Com "usar o caixa", só a compra (o caixa cai e o capital não muda).
 */
export type CashLink = { kind: "none" } | { kind: "before" | "ledger"; account: CashAccountInfo };

export function cashLink(accountId: number | null, accounts: readonly CashAccountInfo[], contributionDate: string): CashLink {
  const account = accountId === null ? undefined : accounts.find((a) => a.id === accountId);
  if (!account || !account.cash_enabled || account.archived || !account.opening_date) return { kind: "none" };
  if (contributionDate !== "" && contributionDate < account.opening_date) return { kind: "before", account };
  return { kind: "ledger", account };
}

export function beforeOpeningText(account: CashAccountInfo): string {
  return `O dia do aporte é anterior ao saldo inicial do caixa de ${account.name} (${formatDate(account.opening_date ?? "")}): o aporte fica só na carteira, sem passar pelo caixa.`;
}

/**
 * Motivo para não deixar usar o caixa: a soma do que sai do caixa de cada conta (vários ativos podem usar a
 * mesma) não pode passar do caixa de hoje. Null quando cabe.
 */
export function cashUseProblem(accountName: string, takenCents: number, balanceCents: number): string | null {
  if (takenCents <= balanceCents) return null;
  return `O caixa de hoje de ${accountName} não cobre o aporte. Desmarque “Usar o dinheiro que já está no caixa” ou registre antes o depósito em Contas e caixa.`;
}
