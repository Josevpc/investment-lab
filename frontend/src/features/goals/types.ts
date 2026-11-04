import type { ContributionsSource } from "@/shared/lib/estimate";

export interface GoalSettings {
  net_worth_goal_cents: number;
  year_goal_cents: number;
  monthly_cents: number;
  horizon_years: number;
  inflation_bps: number;
  conservative_bps: number;
  base_bps: number;
  optimistic_bps: number;
}

export type StreakState = "met" | "missed" | "open";

export interface StreakMonth {
  month: string;
  state: StreakState;
}

export interface Streak {
  current: number;
  best: number;
  current_month_met: boolean;
  months: StreakMonth[];
}

export interface NetWorthProgress {
  current_cents: number;
  goal_cents: number;
  remaining_cents: number;
  progress_bps: number;
  reached: boolean;
}

export interface YearProgress {
  year: number;
  goal_cents: number;
  /** "sem_base": faltam saldos digitados em duas datas para medir o ano. */
  status: "ok" | "sem_base";
  /** Datas com saldo digitado (rotina "Atualizar saldos"): a base do ano e a mais recente. */
  baseline_date: string | null;
  last_date: string | null;
  accumulated_cents: number;
  contributions_cents: number;
  /** Dinheiro resgatado no ano (>= 0): diminui o acumulado, mas não é perda de valorização. */
  withdrawals_cents: number;
  /** Ativos arquivados com saldo no ano, sem resgate (>= 0): saíram da carteira, não é perda. Ausente = 0. */
  archived_out_cents?: number;
  /**
   * Valor inicial de ativos antigos cadastrados no ano (>= 0): já está em `contributions_cents`. Ausente = 0
   * (opcional só para tolerar uma API anterior ao campo).
   */
  new_assets_cents?: number;
  /** accumulated - contribuições + resgates + arquivados. */
  appreciation_cents: number;
  remaining_cents: number;
  progress_bps: number;
  reached: boolean;
  /** De onde vieram os aportes do ano. Versões antigas da API não mandam: a tela trata como "diario". */
  contributions_source: ContributionsSource;
  /** Meses em que o aporte planejado substituiu o lançado ("YYYY-MM"). */
  estimated_months: string[];
}

export interface PaceWindow {
  months: 3 | 6 | 12;
  /** Média por mês com aporte na janela; null sem nenhum mês com aporte. */
  average_cents: number | null;
  months_with_data: number;
}

/** Ritmo real de aportes (meses completos até `reference_month`) contra a meta de aporte mensal. */
export interface ContributionPace {
  reference_month: string;
  windows: PaceWindow[];
  /** Meta de aporte mensal (0 = automático, sem meta). */
  goal_cents: number;
  /** Só quando a média de 6 meses passa da meta. */
  suggestion: { window_months: 6; average_cents: number; suggested_cents: number } | null;
}

export interface GoalsProgress {
  month: string;
  streak: Streak;
  net_worth: NetWorthProgress;
  year: YearProgress;
  contribution_pace: ContributionPace;
}

export interface ProjectionPoint {
  month: string;
  nominal_cents: number;
  today_cents: number;
}

export type GoalBasis = "today" | "nominal";

export type ScenarioKey = "conservador" | "base" | "otimista";

export interface ProjectionScenario {
  key: ScenarioKey;
  name: string;
  annual_bps: number;
  final_nominal_cents: number;
  final_today_cents: number;
  goal_month: string | null;
  points: ProjectionPoint[];
}

export interface Projection {
  start_month: string;
  start_cents: number;
  monthly_cents: number;
  monthly_source: "manual" | "media" | "nenhum";
  monthly_considered: number;
  horizon_years: number;
  inflation_bps: number;
  net_worth_goal_cents: number;
  /**
   * Em que valores a data de chegada à meta (`goal_month`) é calculada. "today": o patrimônio já
   * descontada a inflação contra a meta em reais de hoje. Ausente (API antiga) = "nominal".
   */
  goal_basis?: GoalBasis;
  contributed_cents: number;
  scenarios: ProjectionScenario[];
}
