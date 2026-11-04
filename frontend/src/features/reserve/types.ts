export interface ReserveAsset {
  id: number;
  name: string;
  institution_name: string;
  current_cents: number;
}

export interface Reserve {
  goal_cents: number;
  months: number;
  monthly_cents: number;
  balance_cents: number;
  remaining_cents: number;
  /** 0 a 10.000 (limitado a 100%). */
  progress_bps: number;
  reached: boolean;
  average_salary_cents: number | null;
  salaries_considered: number;
  /** meses x média dos salários registrados. */
  suggested_goal_cents: number | null;
  /** Saldo da reserva em meses de salário médio. */
  coverage_months: number | null;
  assets: ReserveAsset[];
  /** "fixed": valor em reais por mês; "percent": parte do aporte do mês. */
  monthly_mode: MonthlyMode;
  percent_bps: number;
}

export type MonthlyMode = "fixed" | "percent";

export interface ReserveInput {
  goal_cents: number;
  months: number;
  monthly_cents: number;
  monthly_mode: MonthlyMode;
  percent_bps: number;
}
