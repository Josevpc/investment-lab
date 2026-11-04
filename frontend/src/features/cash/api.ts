import { api } from "@/shared/lib/api";
import type { Account, CashBalance, ContributedCapital, Entry, ManualKind, Reconciliation, Statement, TransferResult } from "./types";

const PATHS: Record<ManualKind, string> = {
  deposito: "deposits",
  retirada: "withdrawals",
  taxa: "fees",
  ajuste: "adjustments",
};

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const cashApi = {
  accounts: (includeArchived: boolean) => api.get<Account[]>(`/accounts?include_archived=${includeArchived}`),
  account: (id: number) => api.get<Account>(`/accounts/${id}`),
  createAccount: (name: string, institutionId: number) => api.post<Account>("/accounts", { name, institution_id: institutionId }),
  updateAccount: (id: number, input: { name: string; archived?: boolean }) => api.put<Account>(`/accounts/${id}`, input),
  openingBalance: (id: number, input: { date: string; amount_cents: number }) =>
    api.post<Entry>(`/accounts/${id}/opening-balance`, input),
  statement: (id: number, start?: string) => api.get<Statement>(`/accounts/${id}/entries${query({ start })}`),
  /** Depósito, retirada e taxa vão sempre positivos (o tipo decide o sentido); ajuste vai com sinal. */
  addEntry: (id: number, kind: ManualKind, input: { date: string; amount_cents: number }) =>
    api.post<Entry>(`/accounts/${id}/${PATHS[kind]}`, input),
  reconcile: (id: number, realCents: number, asOf: string) =>
    api.get<Reconciliation>(`/accounts/${id}/reconcile${query({ real_cents: realCents, as_of: asOf })}`),
  applyReconciliation: (id: number, realCents: number, asOf: string) =>
    api.post<Entry>(`/accounts/${id}/reconcile/adjustment`, { real_cents: realCents, as_of: asOf, confirm: true }),
  deleteEntry: (entryId: number) => api.delete(`/cash/entries/${entryId}`),
  transfer: (input: { from_account_id: number; to_account_id: number; amount_cents: number; date: string }) =>
    api.post<TransferResult>("/cash/transfers", input),
  balance: () => api.get<CashBalance>("/cash/balance"),
  contributedCapital: (accountId?: number) => api.get<ContributedCapital>(`/cash/contributed-capital${query({ account_id: accountId })}`),
};
