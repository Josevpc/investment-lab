export interface PlanItem {
  class_key: string;
  class_name: string;
  color: string;
  amount_cents: number;
}

export type ContributionMode = "rebalance" | "proportional";

export interface Contribution {
  id: number;
  month: string; // AAAA-MM
  salary_cents: number;
  percent_bps: number;
  calculated_cents: number;
  final_cents: number;
  overridden: boolean;
  /** Parte do aporte que foi para a reserva. */
  reserve_cents: number;
  mode: ContributionMode | null;
  plan_name: string | null;
  /** Divisão gravada ao salvar; vazia em aportes salvos antes do acompanhamento. */
  plan: PlanItem[];
  created_at: string | null;
}

export interface ContributionInput {
  salary_cents: number;
  percent_bps: number;
  final_cents: number | null;
  reserve_cents: number;
  mode: ContributionMode;
}
