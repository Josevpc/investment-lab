import { api } from "@/shared/lib/api";
import type { Evolution, Snapshot, SnapshotItemInput } from "./types";

export const historyApi = {
  snapshots: () => api.get<Snapshot[]>("/snapshots"),
  /** Sem `items`, registra uma foto da carteira atual; com `items`, um snapshot digitado. */
  // `reserveInvestedCents` só vai no corpo quando preenchido: sem ele a API mantém o investido do
  // fechamento (na edição) ou usa o valor atual da reserva (na criação).
  createSnapshot: (date?: string, items?: SnapshotItemInput[], reserveCents?: number, reserveInvestedCents?: number) =>
    api.post<Snapshot>("/snapshots", {
      ...(date ? { date } : {}),
      ...(items ? { items } : {}),
      ...(reserveCents !== undefined ? { reserve_cents: reserveCents } : {}),
      ...(reserveInvestedCents !== undefined ? { reserve_invested_cents: reserveInvestedCents } : {}),
    }),
  updateSnapshot: (id: number, date: string, items: SnapshotItemInput[], reserveCents: number, reserveInvestedCents?: number) =>
    api.put<Snapshot>(`/snapshots/${id}`, {
      date,
      items,
      reserve_cents: reserveCents,
      ...(reserveInvestedCents !== undefined ? { reserve_invested_cents: reserveInvestedCents } : {}),
    }),
  deleteSnapshot: (id: number) => api.delete(`/snapshots/${id}`),
  evolution: (from?: string) => api.get<Evolution>(`/history/evolution${from ? `?from=${from}` : ""}`),
};
