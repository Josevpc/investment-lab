import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cashApi } from "./api";
import type { ManualKind } from "./types";

export function useAccounts(includeArchived = false) {
  return useQuery({ queryKey: ["cash", "accounts", includeArchived], queryFn: () => cashApi.accounts(includeArchived) });
}

export function useAccount(id: number) {
  return useQuery({ queryKey: ["cash", "account", id], queryFn: () => cashApi.account(id), enabled: Number.isInteger(id) && id > 0 });
}

export function useStatement(id: number, start: string | undefined, enabled = true) {
  return useQuery({ queryKey: ["cash", "statement", id, start ?? "all"], queryFn: () => cashApi.statement(id, start), enabled });
}

export function useCashBalance() {
  return useQuery({ queryKey: ["cash", "balance"], queryFn: cashApi.balance });
}

/** Sem `accountId`, o consolidado de todas as contas. */
export function useContributedCapital(accountId?: number, enabled = true) {
  return useQuery({
    queryKey: ["cash", "capital", accountId ?? "all"],
    queryFn: () => cashApi.contributedCapital(accountId),
    enabled,
  });
}

/** Comparação só de leitura entre o caixa calculado e o saldo do extrato. */
export function useReconcile(id: number, realCents: number | null, asOf: string, enabled: boolean) {
  return useQuery({
    queryKey: ["cash", "reconcile", id, realCents, asOf],
    queryFn: () => cashApi.reconcile(id, realCents ?? 0, asOf),
    enabled: enabled && realCents !== null,
    staleTime: 0,
  });
}

/**
 * Lançamento no caixa muda o extrato, os saldos e o capital aportado, e também o "caixa nas contas" do
 * resumo da carteira. Os ativos não mudam (a compra, que muda, passa pela carteira).
 */
function useInvalidateCash() {
  const client = useQueryClient();
  return () =>
    Promise.all([client.invalidateQueries({ queryKey: ["cash"] }), client.invalidateQueries({ queryKey: ["portfolio", "summary"] })]);
}

export function useCreateAccount() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: ({ name, institutionId }: { name: string; institutionId: number }) => cashApi.createAccount(name, institutionId),
    onSuccess: invalidate,
  });
}

export function useUpdateAccount() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: ({ id, name, archived }: { id: number; name: string; archived?: boolean }) =>
      cashApi.updateAccount(id, archived === undefined ? { name } : { name, archived }),
    onSuccess: invalidate,
  });
}

export function useActivateCash() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: ({ id, date, amountCents }: { id: number; date: string; amountCents: number }) =>
      cashApi.openingBalance(id, { date, amount_cents: amountCents }),
    onSuccess: invalidate,
  });
}

export function useAddEntry() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: ({ id, kind, date, amountCents }: { id: number; kind: ManualKind; date: string; amountCents: number }) =>
      cashApi.addEntry(id, kind, { date, amount_cents: amountCents }),
    onSuccess: invalidate,
  });
}

export function useCashTransfer() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: (input: { from_account_id: number; to_account_id: number; amount_cents: number; date: string }) => cashApi.transfer(input),
    onSuccess: invalidate,
  });
}

export function useApplyReconciliation() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: ({ id, realCents, asOf }: { id: number; realCents: number; asOf: string }) =>
      cashApi.applyReconciliation(id, realCents, asOf),
    onSuccess: invalidate,
  });
}

export function useDeleteEntry() {
  const invalidate = useInvalidateCash();
  return useMutation({ mutationFn: (entryId: number) => cashApi.deleteEntry(entryId), onSuccess: invalidate });
}
