import { api } from "@/shared/lib/api";
import type { Reserve, ReserveInput } from "./types";

export const reserveApi = {
  get: () => api.get<Reserve>("/reserve"),
  save: (input: ReserveInput) => api.put<Reserve>("/reserve", input),
};
