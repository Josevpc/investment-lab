export interface SeriesStatus {
  series: string;
  label: string;
  months: number;
  covered_from: string | null;
  covered_through: string | null;
}

export interface BenchmarkStatus {
  source: string;
  updated_at: string | null;
  stale: boolean;
  series: SeriesStatus[];
  /** CDI diário (usado no % do CDI por ativo): dias guardados e último dia. */
  daily_days: number;
  daily_through: string | null;
  /** Ibovespa (fechamentos diários, referência da renda variável): dias guardados (0 = nunca baixado) e último dia. */
  index_days: number;
  index_through: string | null;
}

export interface RefreshResult {
  ok: boolean;
  rows_saved: number;
  /** Pode trazer "Ibovespa: <motivo>" mesmo com ok=true (o CDI foi salvo e só o Ibovespa falhou). */
  errors: string[];
  status: BenchmarkStatus;
}
