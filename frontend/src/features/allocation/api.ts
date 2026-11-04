import { api } from "@/shared/lib/api";
import type { Comparison, Plan, PlanInput, Split, SplitMode } from "./types";

export const allocationApi = {
  listPlans: () => api.get<Plan[]>("/allocation/plans"),
  createPlan: (input: PlanInput) => api.post<Plan>("/allocation/plans", input),
  updatePlan: (id: number, input: PlanInput) => api.put<Plan>(`/allocation/plans/${id}`, input),
  activatePlan: (id: number) => api.post<Plan>(`/allocation/plans/${id}/activate`),
  deletePlan: (id: number) => api.delete(`/allocation/plans/${id}`),
  split: (amountCents: number, mode: SplitMode, planId?: number, month?: string) =>
    api.post<Split>("/allocation/split", {
      amount_cents: amountCents,
      mode,
      plan_id: planId ?? null,
      month: month ?? null,
    }),
  comparison: () => api.get<Comparison>("/allocation/comparison"),
};
