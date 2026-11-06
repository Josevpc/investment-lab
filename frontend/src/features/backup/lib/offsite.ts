import { ApiError } from "@/shared/lib/api";
import { addDaysISO } from "@/shared/lib/format";
import type { OffsiteStatus } from "../types";

/** A cópia é recomendada pelo menos uma vez por semana (o mesmo prazo do `stale` da API). */
export const OFFSITE_INTERVAL_DAYS = 7;

export type OffsiteSituation = "ok" | "stale" | "none" | "unavailable";

/**
 * Sem cópia, sem acesso à pasta, desatualizada ou em dia, nesta ordem de precedência. Só a API sabe o prazo
 * (`stale`); aqui ele vira palavra. Sem pasta nunca é "Em dia", mesmo que sobre um `last_copy_at` de antes.
 * "Em dia" exige poder chegar à pasta: se ela sumiu (`lostOnCopy` = falhou ao copiar agora há pouco), a
 * última cópia pode estar boa, mas a próxima não vai sair, e o selo não deve tranquilizar.
 */
export function offsiteSituation(
  status: Pick<OffsiteStatus, "folder" | "folder_available" | "last_copy_at" | "stale">,
  lostOnCopy = false,
): OffsiteSituation {
  if (status.folder === null || !status.last_copy_at) return "none";
  if (!status.folder_available || lostOnCopy) return "unavailable";
  return status.stale ? "stale" : "ok";
}

export const SITUATION_LABEL: Record<OffsiteSituation, string> = {
  ok: "Em dia",
  stale: "Desatualizada",
  none: "Sem cópia",
  unavailable: "Sem acesso à pasta",
};

/** 0 -> "hoje", 1 -> "há 1 dia", 5 -> "há 5 dias". */
export function formatDaysAgo(days: number): string {
  if (days <= 0) return "hoje";
  return days === 1 ? "há 1 dia" : `há ${days} dias`;
}

/** Data (YYYY-MM-DD) até a qual a próxima cópia é recomendada, contada a partir de uma cópia "YYYY-MM-DDTHH:MM:SS". */
export function nextCopyDue(copiedAt: string): string {
  return addDaysISO(copiedAt.slice(0, 10), OFFSITE_INTERVAL_DAYS);
}

/** Só o nome do arquivo, seja o caminho com "\" ou "/". */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * O caminho colado do Explorer ("Copiar como caminho") vem entre aspas; espaços nas pontas também sobram.
 * Tirar isso aqui evita mandar uma pasta que não existe só por causa da forma de copiar.
 */
export function normalizeFolder(input: string): string {
  return input.trim().replace(/^"(.*)"$/, "$1").trim();
}

export type OffsiteErrorCode =
  | "folder_not_found"
  | "folder_not_absolute"
  | "folder_not_writable"
  | "folder_inside_data"
  | "no_folder"
  | "folder_unavailable"
  | "copy_failed";

const MESSAGES: Record<OffsiteErrorCode, string> = {
  folder_not_found:
    "Não encontrei essa pasta e não consegui criá-la. Confira o caminho: a pasta de cima precisa existir. Se for pendrive ou Drive, confira se está conectado.",
  folder_not_absolute:
    "Informe o caminho completo da pasta, começando pela letra da unidade, por exemplo G:\\Meu Drive\\Investment Lab Backup.",
  folder_not_writable:
    "Não consigo gravar nessa pasta. Escolha outra pasta ou confira se você tem permissão para gravar nela.",
  folder_inside_data:
    "Essa pasta fica dentro da pasta de dados do app, no mesmo lugar do banco, e não protegeria nada. Escolha uma pasta fora dela: uma pasta sincronizada com a nuvem ou um pendrive.",
  no_folder: "Ainda não há uma pasta definida. Informe a pasta da cópia e salve antes de copiar.",
  folder_unavailable: "Não consegui acessar a pasta. Se for pendrive ou Drive, confira se está conectado.",
  copy_failed:
    "A cópia não foi gravada. A última cópia continua válida. Tente de novo; se repetir, confira se há espaço livre na pasta.",
};

const KNOWN = new Set<string>(Object.keys(MESSAGES));

/** Código estável que o back-end manda ao lado de `detail`; sem ele, deduz pelo status HTTP (só nos casos sem ambiguidade). */
export function offsiteErrorCode(error: unknown): OffsiteErrorCode | null {
  if (!(error instanceof ApiError)) return null;
  const code = error.extra?.code;
  if (typeof code === "string" && KNOWN.has(code)) return code as OffsiteErrorCode;
  if (error.status === 409) return "no_folder";
  if (error.status === 500) return "copy_failed";
  return null;
}

/** Mensagem em português que diz o que fazer; erros sem código conhecido mostram o texto da API. */
export function offsiteErrorMessage(error: unknown): string {
  const code = offsiteErrorCode(error);
  if (code) return MESSAGES[code];
  return error instanceof Error ? error.message : "Algo deu errado. Tente de novo.";
}
