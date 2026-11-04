import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/lib/api";
import type { BenchmarkStatus, RefreshResult } from "./types";

export function useBenchmarkStatus() {
  return useQuery({ queryKey: ["benchmarks", "status"], queryFn: () => api.get<BenchmarkStatus>("/benchmarks/status") });
}

/** Busca CDI, Selic e Ibovespa de novo (precisa de internet). */
export function useRefreshBenchmarks() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RefreshResult>("/benchmarks/refresh"),
    onSuccess: () =>
      Promise.all(
        ["benchmarks", "analytics", "system"].map((key) => client.invalidateQueries({ queryKey: [key] })),
      ),
  });
}
