import { api } from "@/shared/lib/api";
import type { AssetVsCdi, Performance, PerformanceInput, Trajectory, TrajectoryInput } from "./types";

function period(from?: string, to?: string): string {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export const analyticsApi = {
  assetVsCdi: (assetId: number, from?: string, to?: string) =>
    api.get<AssetVsCdi>(`/analytics/assets/${assetId}/vs-cdi${period(from, to)}`),
  assetsVsCdi: (from?: string, to?: string) => api.get<AssetVsCdi[]>(`/analytics/assets-vs-cdi${period(from, to)}`),
  trajectory: (input: TrajectoryInput) => api.post<Trajectory>("/analytics/trajectory", input),
  performance: ({ scope, includeReserve, from }: PerformanceInput) => {
    const params = new URLSearchParams({ scope, include_reserve: String(includeReserve) });
    if (from) params.set("from", from);
    return api.get<Performance>(`/analytics/performance?${params.toString()}`);
  },
};
