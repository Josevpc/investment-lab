export interface SystemStatus {
  version: string;
  /** "local": os dados ficam neste computador. */
  storage: string;
  database_file: string | null;
  database_size_bytes: number | null;
  schema_revision: string | null;
  expected_revision: string;
  backups_count: number;
  last_backup_at: string | null;
  benchmarks_updated_at: string | null;
  /** Modo demonstração: banco separado com dados fictícios. */
  demo: boolean;
}
