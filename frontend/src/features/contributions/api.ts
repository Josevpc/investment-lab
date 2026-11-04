import { api } from "@/shared/lib/api";
import type { Contribution, ContributionInput } from "./types";

export const contributionsApi = {
  list: () => api.get<Contribution[]>("/contributions"),
  save: (month: string, input: ContributionInput) => api.put<Contribution>(`/contributions/${month}`, input),
};
