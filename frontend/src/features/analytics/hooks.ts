import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { analyticsApi } from "./api";
import { DEFAULT_IR_RATE_BPS, IR_RATE_KEY, parseIrRate } from "./lib/irRate";
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

/** A alíquota entra na chave: trocar de alíquota busca de novo o CDI líquido e o % do CDI líquido. */
export function useAssetVsCdi(assetId: number, from?: string, to?: string, irRateBps: number = DEFAULT_IR_RATE_BPS) {
  return useQuery({
    queryKey: ["analytics", "asset-vs-cdi", assetId, from ?? "total", to ?? "total", irRateBps],
    queryFn: () => analyticsApi.assetVsCdi(assetId, from, to, irRateBps),
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

export function useAssetsVsCdi(from?: string, irRateBps: number = DEFAULT_IR_RATE_BPS) {
  return useQuery({
    queryKey: ["analytics", "assets-vs-cdi", from ?? "total", irRateBps],
    queryFn: () => analyticsApi.assetsVsCdi(from, undefined, irRateBps),
    placeholderData: keepPreviousData,
  });
}

// A alíquota escolhida fica no navegador (não no banco) e é compartilhada entre as telas que a usam.
const irRateListeners = new Set<() => void>();
// Só entra em uso se o navegador não deixar gravar (armazenamento bloqueado): a escolha vale até recarregar a página.
let irRateInMemory: string | null = null;

function readIrRate(): string | null {
  try {
    return localStorage.getItem(IR_RATE_KEY) ?? irRateInMemory;
  } catch {
    return irRateInMemory;
  }
}

function subscribeIrRate(listener: () => void) {
  irRateListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    irRateListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Alíquota de IR escolhida para comparar isentos e tributados (padrão 15%) e como trocá-la. */
export function useIrRate(): [number, (bps: number) => void] {
  const raw = useSyncExternalStore(subscribeIrRate, readIrRate, () => null);
  const setIrRate = useCallback((bps: number) => {
    try {
      localStorage.setItem(IR_RATE_KEY, String(bps));
    } catch {
      irRateInMemory = String(bps);
    }
    irRateListeners.forEach((listener) => listener());
  }, []);
  return [parseIrRate(raw), setIrRate];
}
