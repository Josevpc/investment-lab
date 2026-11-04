/** Um mês do "salário do seu dinheiro": quanto os investimentos renderam, sem contar os aportes. */
export interface EarningsMonth {
  /** AAAA-MM */
  month: string;
  /** valorização + proventos não creditados, em centavos (pode ser negativo). */
  earned_cents: number;
  appreciation_cents: number;
  proventos_cents: number;
  /** Mês corrente, ainda em andamento. */
  partial: boolean;
  /** Até que dia o mês foi considerado (AAAA-MM-DD). */
  through: string;
  /** Se houve atualização de saldo no mês. Sem ela o rendimento não é conhecido (não é zero). */
  has_update: boolean;
  /** Quanto o ganho representa do salário daquele mês, em pontos-base (null sem salário). */
  salary_share_bps: number | null;
  /** Data do último saldo digitado ou provento do mês: o rendimento só vale até ela (null sem atualização). */
  measured_through: string | null;
  /** Rendimento por dia: no mês corrente, até `measured_through`; null sem atualização. */
  per_day_cents: number | null;
  /** Minutos de trabalho equivalentes ao rendimento do mês; null sem salário ou sem ganho. */
  work_minutes: number | null;
}

export interface EarningsTotal {
  earned_cents: number;
  /** Ganho que os ativos já traziam quando foram cadastrados. */
  before_tracking_cents: number;
  since_tracking_cents: number;
  uncredited_proventos_cents: number;
}

export interface EarningsPace {
  per_day_cents: number;
  basis_months: number;
  from_month: string;
  to_month: string;
}

export interface EarningsVsSalary {
  month: string;
  earned_cents: number;
  share_bps: number;
  /** Minutos de trabalho equivalentes; null quando o ganho não é positivo. */
  work_minutes: number | null;
}

export type MilestoneKind = "first" | "monthly_share" | "total_amount";

export type MilestoneKey =
  | "first_salary"
  | "share_1"
  | "share_5"
  | "share_10"
  | "share_25"
  | "share_50"
  | "share_100"
  | "total_100"
  | "total_1000"
  | "total_10000"
  | "total_100000";

export interface Milestone {
  key: MilestoneKey;
  kind: MilestoneKind;
  /** bps do salário (monthly_share) ou centavos acumulados (total_amount); null em "first". */
  threshold: number | null;
  /** AAAA-MM em que foi atingido, ou null. */
  achieved_month: string | null;
}

export interface Earnings {
  as_of: string;
  /** Desde quando há ativos cadastrados; null sem ativos. */
  tracking_since: string | null;
  total: EarningsTotal;
  current_month: EarningsMonth;
  last_complete_month: EarningsMonth | null;
  pace: EarningsPace | null;
  salary: { salary_cents: number; month: string } | null;
  vs_salary: EarningsVsSalary | null;
  /** Até 12 meses, do mais antigo ao mais novo, incluindo o corrente. */
  months: EarningsMonth[];
  milestones: Milestone[];
  next_milestone: { key: MilestoneKey; progress_bps: number } | null;
}
