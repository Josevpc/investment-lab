import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/lib/api";
import type { BackupFile, BackupInspection, DataChangeResult, OffsiteCopyResult, OffsiteStatus } from "./types";

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

const OFFSITE_KEY = ["backup", "offsite"] as const;

export function useOffsiteStatus() {
  return useQuery({ queryKey: OFFSITE_KEY, queryFn: () => api.get<OffsiteStatus>("/backup/offsite") });
}

/** Define a pasta da cópia (ou desliga, com `null`). A resposta já é a situação nova. */
export function useSaveOffsiteFolder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (folder: string | null) => api.put<OffsiteStatus>("/backup/offsite", { folder }),
    onSuccess: (status) => client.setQueryData(OFFSITE_KEY, status),
  });
}

/**
 * Grava uma cópia na pasta. Também depois de um erro a situação é relida: a pasta pode ter ficado
 * indisponível (pendrive solto), e a "Última cópia" continua valendo.
 */
export function useCopyOffsite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<OffsiteCopyResult>("/backup/offsite/copy"),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: OFFSITE_KEY }),
        client.invalidateQueries({ queryKey: ["system"] }),
      ]),
  });
}
