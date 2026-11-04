import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { analyticsApi } from "./api";
import type { PerformanceInput, TrajectoryInput } from "./types";

export function useTrajectory(input: TrajectoryInput) {
  return useQuery({
    queryKey: ["analytics", "trajectory", input],
    queryFn: () => analyticsApi.trajectory(input),
    placeholderData: keepPreviousData,
  });
}

export function usePerformance(input: PerformanceInput) {
  return useQuery({
    queryKey: ["analytics", "performance", input],
    queryFn: () => analyticsApi.performance(input),
    placeholderData: keepPreviousData,
  });
}

export function useAssetVsCdi(assetId: number, from?: string, to?: string) {
  return useQuery({
    queryKey: ["analytics", "asset-vs-cdi", assetId, from ?? "total", to ?? "total"],
    queryFn: () => analyticsApi.assetVsCdi(assetId, from, to),
    placeholderData: keepPreviousData,
  });
}

/** Desempenho de vários ativos, cada um no seu período (ex.: do saldo anterior ao de hoje). */
export function useAssetsPeriodVsCdi(periods: readonly { assetId: number; from: string; to: string }[]) {
  return useQueries({
    queries: periods.map(({ assetId, from, to }) => ({
      queryKey: ["analytics", "asset-vs-cdi", assetId, from, to],
      queryFn: () => analyticsApi.assetVsCdi(assetId, from, to),
    })),
  });
}

export function useAssetsVsCdi(from?: string) {
  return useQuery({
    queryKey: ["analytics", "assets-vs-cdi", from ?? "total"],
    queryFn: () => analyticsApi.assetsVsCdi(from),
    placeholderData: keepPreviousData,
  });
}
