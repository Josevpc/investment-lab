import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { allocationApi } from "./api";
import type { PlanInput, SplitMode } from "./types";

export const allocationKeys = {
  plans: ["allocation", "plans"] as const,
  split: (amountCents: number, mode: SplitMode, planId?: number, month?: string) =>
    ["allocation", "split", amountCents, mode, planId ?? "active", month ?? "now"] as const,
  comparison: ["allocation", "comparison"] as const,
};

export function usePlans() {
  return useQuery({ queryKey: allocationKeys.plans, queryFn: allocationApi.listPlans });
}

export function useActivePlan() {
  const query = usePlans();
  return { ...query, data: query.data?.find((plan) => plan.is_active) };
}

/**
 * Divisão do aporte entre as classes, calculada pelo back-end. Com `month`, parte da carteira de
 * antes dos aportes já feitos nesse mês, então a sugestão não muda conforme eles são lançados.
 */
export function useSplit(amountCents: number, mode: SplitMode, planId?: number, month?: string) {
  return useQuery({
    queryKey: allocationKeys.split(amountCents, mode, planId, month),
    queryFn: () => allocationApi.split(amountCents, mode, planId, month),
    placeholderData: keepPreviousData,
  });
}

export function useComparison() {
  return useQuery({ queryKey: allocationKeys.comparison, queryFn: allocationApi.comparison });
}

function useInvalidateAllocation() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["allocation"] });
}

export function useCreatePlan() {
  const invalidate = useInvalidateAllocation();
  return useMutation({ mutationFn: (input: PlanInput) => allocationApi.createPlan(input), onSuccess: invalidate });
}

export function useUpdatePlan() {
  const invalidate = useInvalidateAllocation();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: PlanInput }) => allocationApi.updatePlan(id, input),
    onSuccess: invalidate,
  });
}

export function useActivatePlan() {
  const invalidate = useInvalidateAllocation();
  return useMutation({ mutationFn: (id: number) => allocationApi.activatePlan(id), onSuccess: invalidate });
}

export function useDeletePlan() {
  const invalidate = useInvalidateAllocation();
  return useMutation({ mutationFn: (id: number) => allocationApi.deletePlan(id), onSuccess: invalidate });
}
