import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { closingCelebration, fetchGoalsProgress } from "@/features/goals";
import { celebrate } from "@/shared/lib/celebrate";
import { currentMonth } from "@/shared/lib/format";
import { historyApi } from "./api";
import type { SnapshotItemInput } from "./types";

export function useSnapshots() {
  return useQuery({ queryKey: ["history", "snapshots"], queryFn: historyApi.snapshots });
}

export function useEvolution(from?: string) {
  return useQuery({ queryKey: ["history", "evolution", from ?? "all"], queryFn: () => historyApi.evolution(from) });
}

/** O fechamento mexe no histórico e na sequência de meses das metas. */
function useInvalidateHistory() {
  const client = useQueryClient();
  return () => Promise.all(["history", "goals", "earnings"].map((key) => client.invalidateQueries({ queryKey: [key] })));
}

export function useCreateSnapshot() {
  const client = useQueryClient();
  const invalidate = useInvalidateHistory();
  return useMutation({
    mutationFn: ({
      date,
      items,
      reserveCents,
      reserveInvestedCents,
    }: {
      date?: string;
      items?: SnapshotItemInput[];
      reserveCents?: number;
      reserveInvestedCents?: number;
    }) => historyApi.createSnapshot(date, items, reserveCents, reserveInvestedCents),
    onSuccess: async (_snapshot, { date, items }) => {
      await invalidate();
      // Só o fechamento do mês corrente, tirado da carteira atual, é comemorado: registrar um
      // fechamento antigo à mão não é uma conquista do mês.
      if (items !== undefined || (date !== undefined && !date.startsWith(currentMonth()))) return;
      const progress = await fetchGoalsProgress(client).catch(() => null);
      const detail = progress ? closingCelebration(progress) : { text: "Fechamento do mês registrado.", highlight: undefined };
      celebrate({
        title: "Mês fechado!",
        text: detail.text,
        highlight: detail.highlight,
        next: { label: "Veja como a carteira se saiu frente ao mercado.", to: "/historico?aba=desempenho" },
      });
    },
  });
}

export function useUpdateSnapshot() {
  const invalidate = useInvalidateHistory();
  return useMutation({
    mutationFn: ({
      id,
      date,
      items,
      reserveCents,
      reserveInvestedCents,
    }: {
      id: number;
      date: string;
      items: SnapshotItemInput[];
      reserveCents: number;
      reserveInvestedCents?: number;
    }) => historyApi.updateSnapshot(id, date, items, reserveCents, reserveInvestedCents),
    onSuccess: invalidate,
  });
}

export function useDeleteSnapshot() {
  const invalidate = useInvalidateHistory();
  return useMutation({ mutationFn: (id: number) => historyApi.deleteSnapshot(id), onSuccess: invalidate });
}
