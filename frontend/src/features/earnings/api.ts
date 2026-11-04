import { api } from "@/shared/lib/api";
import type { Earnings } from "./types";

export const earningsApi = {
  get: () => api.get<Earnings>("/earnings"),
};
