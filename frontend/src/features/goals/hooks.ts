import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { goalsApi } from "./api";
import type { GoalSettings } from "./types";

const PROGRESS_KEY = ["goals", "progress"] as const;

export function useGoalSettings() {
  return useQuery({ queryKey: ["goals", "settings"], queryFn: goalsApi.settings });
}

export function useGoalsProgress() {
  return useQuery({ queryKey: PROGRESS_KEY, queryFn: goalsApi.progress });
}

export function useProjection() {
  return useQuery({ queryKey: ["goals", "projection"], queryFn: goalsApi.projection });
}

export function useSaveGoalSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: GoalSettings) => goalsApi.saveSettings(input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["goals"] }),
  });
}

/** Progresso já atualizado, para quem acabou de mudar os dados (ex.: ao fechar o mês). */
export function fetchGoalsProgress(client: QueryClient) {
  return client.fetchQuery({ queryKey: PROGRESS_KEY, queryFn: goalsApi.progress, staleTime: 0 });
}
