import { api } from "@/shared/lib/api";
import type { AssetGroup, AssetGroupInput } from "./types";

export const groupsApi = {
  list: (includeArchived: boolean) => api.get<AssetGroup[]>(`/asset-groups${includeArchived ? "?include_archived=1" : ""}`),
  create: (name: string, color?: string) => api.post<AssetGroup>("/asset-groups", { name, ...(color ? { color } : {}) }),
  update: (id: number, input: AssetGroupInput) => api.put<AssetGroup>(`/asset-groups/${id}`, input),
};
