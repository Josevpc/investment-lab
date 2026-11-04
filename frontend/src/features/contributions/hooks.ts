import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { contributionsApi } from "./api";
import type { ContributionInput } from "./types";

const KEY = ["contributions"] as const;

export function useContributions() {
  return useQuery({ queryKey: KEY, queryFn: contributionsApi.list });
}

export function useSaveContribution() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ month, input }: { month: string; input: ContributionInput }) =>
      contributionsApi.save(month, input),
    // O histórico usa os aportes para separar aporte de valorização; as metas, para a sequência;
    // o salário do mês entra na comparação do "salário do seu dinheiro".
    onSuccess: () =>
      Promise.all(
        [KEY, ["history"], ["goals"], ["earnings"]].map((queryKey) => client.invalidateQueries({ queryKey })),
      ),
  });
}
