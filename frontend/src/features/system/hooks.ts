import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/lib/api";
import type { SystemStatus } from "./types";

export function useSystemStatus() {
  return useQuery({ queryKey: ["system", "status"], queryFn: () => api.get<SystemStatus>("/system/status") });
}
