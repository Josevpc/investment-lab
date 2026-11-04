import type { HoldStatus } from "@/features/allocation";

export type TrajectoryMode = "proportional" | "rebalance";

export interface TrajectoryInput {
  months: number;
  monthly_contribution_cents: number | null;
  mode: TrajectoryMode;
  tolerance_bps: number;
}

export interface TrajectoryClass {
  key: string;
  name: string;
  color: string;
  /** Grupo da categoria (só informativo); ausente numa API anterior aos grupos. */
  group_id?: number | null;
  target_bps: number;
  /** Meta valendo: reescalada quando alguma categoria está toda mantida (0 na própria). */
  effective_target_bps: number;
  /** "all": todos os ativos mantidos, sem aporte e com a meta suspensa (ver allocation/types). */
  hold_status: HoldStatus;
}

export interface TrajectoryPoint {
  month: number; // 0 = hoje
  total_cents: number;
  values_cents: Record<string, number>;
  /** Participação na carteira toda (sem a reserva). */
  shares_bps: Record<string, number>;
  /** Participação na carteira sem as categorias todas mantidas (a base da meta efetiva); não traz as "all". */
  base_shares_bps: Record<string, number>;
}

export interface Trajectory {
  plan_id: number;
  plan_name: string;
  mode: TrajectoryMode;
  months: number;
  monthly_contribution_cents: number;
  contribution_source: "informed" | "last_contribution" | "none";
  tolerance_bps: number;
  /** Distâncias e prazo: base_shares_bps contra a meta efetiva, só nas categorias que não são "all". */
  months_to_target: number | null;
  start_gap_bps: number;
  end_gap_bps: number;
  /** Todas as categorias com todos os ativos mantidos: a simulação roda com aporte 0. */
  all_held: boolean;
  classes: TrajectoryClass[];
  points: TrajectoryPoint[];
}

/** Uma data com saldo digitado (rotina "Atualizar saldos"); os % são acumulados desde o primeiro ponto. */
export interface PerformancePoint {
  date: string;
  /** Valor do escopo nesta data. */
  value_cents: number;
  /** Fluxo externo líquido desde o ponto anterior: positivo entrou, negativo saiu. */
  flows_cents: number;
  portfolio_bps: number | null;
  cdi_bps: number | null;
  ibovespa_bps: number | null;
}

export interface PerformanceSummary {
  start_date: string | null;
  end_date: string | null;
  portfolio_bps: number | null;
  cdi_bps: number | null;
  /** Diferença em pontos-base de ponto percentual (100 = 1 p.p.). */
  vs_cdi_bps: number | null;
  ibovespa_bps: number | null;
  /** Carteira − Ibovespa, em pontos-base de ponto percentual. */
  vs_ibovespa_bps: number | null;
  /** Fluxo externo líquido do período todo (positivo entrou, negativo saiu). */
  flows_cents: number;
}

/** Ativo do escopo cujo último saldo digitado está velho: o desempenho dele pode estar defasado. */
export interface StaleAsset {
  asset_id: number;
  asset_name: string;
  last_observed_date: string;
  days: number;
}

export interface Performance {
  scope: string;
  scope_label: string;
  include_reserve: boolean;
  /** Quantas datas com saldo entraram no cálculo. */
  observations_count: number;
  points: PerformancePoint[];
  summary: PerformanceSummary;
  method: string;
  warnings: string[];
  stale_assets: StaleAsset[];
  benchmark_source: string;
  benchmark_updated_at: string | null;
  /** Último dia com CDI guardado (YYYY-MM-DD). */
  cdi_covered_through: string | null;
  /** Último dia com fechamento do Ibovespa guardado (YYYY-MM-DD). */
  ibovespa_covered_through: string | null;
  /** Fonte do Ibovespa (cita a B3); null enquanto não há dado. */
  ibovespa_source: string | null;
}

export interface PerformanceInput {
  scope: string;
  includeReserve: boolean;
  from?: string;
}

export interface AssetFlow {
  date: string;
  kind: "aporte" | "transferencia_entrada" | "transferencia_saida" | "provento_creditado" | "resgate";
  /** Positivo entrou, negativo saiu. */
  cents: number;
}

export interface AssetStep {
  start_date: string;
  end_date: string;
  start_cents: number;
  end_cents: number;
  flows_cents: number;
  yield_cents: number;
  return_bps: number | null;
  cdi_bps: number | null;
  /** 12000 = 120% do CDI. */
  pct_of_cdi_bps: number | null;
}

export interface AssetVsCdi {
  asset_id: number;
  asset_name: string;
  class_key: string;
  asset_type: string | null;
  indexer: string | null;
  /** Só para ativos "CDI": a taxa contratada, em % do CDI (12000 = 120%). */
  contracted_pct_bps: number | null;
  /** Os saldos digitados já vêm sem o IR: o % do CDI não é comparável ao de um ativo bruto. */
  balance_is_net: boolean;
  /** Datas com saldo digitado: as opções de início e fim do período. */
  dates: string[];
  start_date: string | null;
  end_date: string | null;
  start_cents: number | null;
  end_cents: number | null;
  flows: AssetFlow[];
  flows_cents: number;
  /** Proventos pagos pelo ativo no período; não entram no saldo. */
  proventos_cents: number;
  yield_cents: number | null;
  return_bps: number | null;
  cdi_bps: number | null;
  pct_of_cdi_bps: number | null;
  vs_contracted_bps: number | null;
  steps: AssetStep[];
  warnings: string[];
  method: string;
  cdi_covered_through: string | null;
  /** Variação do Ibovespa no mesmo período, ponto a ponto entre as datas; null para renda fixa ou sem dados. */
  ibovespa_bps: number | null;
  /** Variação do ativo − Ibovespa, em pontos-base de ponto percentual. */
  vs_ibovespa_bps: number | null;
  ibovespa_covered_through: string | null;
}
