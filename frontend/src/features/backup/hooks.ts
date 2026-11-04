import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/lib/api";
import type { BackupFile, BackupInspection, DataChangeResult } from "./types";

export const RESET_CONFIRMATION = "APAGAR";

export function useInspectBackup() {
  return useMutation({ mutationFn: (backup: BackupFile) => api.post<BackupInspection>("/backup/inspect", backup) });
}

/** Restaurar ou apagar muda tudo o que está na tela: recarrega todas as consultas. */
function useReloadAll() {
  const client = useQueryClient();
  return () => client.invalidateQueries();
}

export function useRestoreBackup() {
  const reload = useReloadAll();
  return useMutation({
    mutationFn: (backup: BackupFile) => api.post<DataChangeResult>("/backup/restore", { backup, confirm: true }),
    onSuccess: reload,
  });
}

export function useResetData() {
  const reload = useReloadAll();
  return useMutation({
    mutationFn: (confirm: string) => api.post<DataChangeResult>("/backup/reset", { confirm }),
    onSuccess: reload,
  });
}
