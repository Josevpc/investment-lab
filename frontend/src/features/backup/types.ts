export interface BackupFile {
  app: string;
  format_version: number;
  schema_revision: string;
  exported_at: string;
  tables: Record<string, unknown[]>;
  [key: string]: unknown;
}

export interface BackupInspection {
  valid: boolean;
  compatible: boolean;
  /** Com `valid`, o que vier aqui é aviso (ex.: backup de versão anterior), não bloqueio. */
  problems: string[];
  /** O arquivo é de uma revisão anterior e será convertido ao restaurar. */
  needs_conversion?: boolean;
  exported_at: string | null;
  schema_revision: string | null;
  current_revision: string;
  counts: Record<string, number>;
  snapshots_from: string | null;
  snapshots_to: string | null;
}

export interface DataChangeResult {
  safety_backup: string | null;
  /** Revisão de origem quando o backup foi convertido ao restaurar; null/ausente se não houve conversão. */
  converted_from_revision?: string | null;
  counts: Record<string, number>;
}

/** Situação da cópia fora deste computador (GET/PUT /backup/offsite). Datas sem fuso: "YYYY-MM-DDTHH:MM:SS". */
export interface OffsiteStatus {
  folder: string | null;
  folder_available: boolean;
  /** A pasta está no mesmo disco do banco: não protege contra falha do disco. */
  same_drive: boolean;
  last_copy_at: string | null;
  last_copy_file: string | null;
  days_since_last_copy: number | null;
  /** Sem cópia ou cópia com mais de 7 dias. */
  stale: boolean;
}

export interface OffsiteCopyResult {
  file: string;
  size_bytes: number;
  copied_at: string;
  /** Quantas cópias o app mantém na pasta depois desta. */
  kept: number;
}
