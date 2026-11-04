import { useQuery } from "@tanstack/react-query";
import { earningsApi } from "./api";

/** Quem muda saldos, proventos, aportes ou salário invalida esta chave (ver hooks de carteira, histórico e aporte). */
export function useEarnings() {
  return useQuery({ queryKey: ["earnings"], queryFn: earningsApi.get });
}
