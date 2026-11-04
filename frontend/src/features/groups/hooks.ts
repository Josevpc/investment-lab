import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { groupsApi } from "./api";
import type { AssetGroup, AssetGroupInput } from "./types";

/**
 * Grupos de categorias. Uma API anterior à funcionalidade (ou uma resposta fora do formato) vira lista
 * vazia: sem grupos, as telas ficam como sempre foram.
 */
export function useAssetGroups(includeArchived = false) {
  const query = useQuery({
    queryKey: ["groups", includeArchived],
    queryFn: () => groupsApi.list(includeArchived),
    retry: false,
  });
  const data: AssetGroup[] = Array.isArray(query.data) ? query.data : [];
  return { ...query, data };
}

/** Grupo mexe em categorias, metas, resumo, histórico e desempenho, então tudo é recarregado. */
function useInvalidateGroups() {
  const client = useQueryClient();
  return () =>
    Promise.all(["groups", "portfolio", "allocation", "history", "analytics"].map((key) => client.invalidateQueries({ queryKey: [key] })));
}

export function useCreateGroup() {
  const invalidate = useInvalidateGroups();
  return useMutation({
    mutationFn: ({ name, color }: { name: string; color?: string }) => groupsApi.create(name, color),
    onSuccess: invalidate,
  });
}

export function useUpdateGroup() {
  const invalidate = useInvalidateGroups();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: AssetGroupInput }) => groupsApi.update(id, input),
    onSuccess: invalidate,
  });
}
