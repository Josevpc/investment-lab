import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reserveApi } from "./api";
import type { ReserveInput } from "./types";

export function useReserve() {
  return useQuery({ queryKey: ["reserve"], queryFn: reserveApi.get });
}

export function useSaveReserve() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ReserveInput) => reserveApi.save(input),
    // Retiradas compara o saldo de cada resgate com a meta atual da reserva.
    onSuccess: () => Promise.all(["reserve", "withdrawals"].map((key) => client.invalidateQueries({ queryKey: [key] }))),
  });
}
