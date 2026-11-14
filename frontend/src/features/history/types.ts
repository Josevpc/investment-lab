import type { ContributionsSource } from "@/shared/lib/estimate";

export interface SnapshotClassValue {
  class_id: number;
  class_key: string;
  class_name: string;
  color: string;
  archived: boolean;
  current_cents: number;
  invested_cents: number;
}

export interface Snapshot {
  id: number;
  date: string;
  total_cents: number;
  invested_cents: number;
  assets_count: number;
  manual: boolean;
  /** Parte do patrimônio que estava na reserva de emergência (já incluída no total). */
  reserve_cents: number;
  /** Quanto da reserva foi aporte (investido). 0 sem reserva. */
  reserve_invested_cents: number;
  by_class: SnapshotClassValue[];
}

export interface EvolutionPoint {
  date: string;
  total_cents: number;
  invested_cents: number;
  by_class: Record<string, number>;
  reserve_cents: number;
  /**
   * Dinheiro separado para comprar naquela data (ainda não investido), fora de `total_cents`. Ausentes numa API
   * anterior ao separado: a tela trata como 0.
   */
  reserved_cents?: number;
  reserved_by_class?: Record<string, number>;
  /** `total_cents + reserved_cents`. */
  net_worth_cents?: number;
}

export interface EvolutionSummary {
  start_date: string;
  end_date: string;
  start_total_cents: number;
  end_total_cents: number;
  change_cents: number;
  /** Já inclui `new_assets_cents`. */
  contributions_cents: number;
  /** Dinheiro resgatado no período (>= 0): saiu da carteira, não é perda. */
  withdrawals_cents: number;
  /**
   * Valor de ativos arquivados com saldo, sem resgate (>= 0): saiu do patrimônio, não é perda. Versões antigas da API
   * não mandam: a tela trata como 0.
   */
  archived_out_cents?: number;
  /**
   * Separado liberado de volta ao caixa livre no período (>= 0): saiu do patrimônio sem comprar, não é perda. Ausente
   * numa API anterior ao separado: a tela trata como 0.
   */
  released_cents?: number;
  /** change_cents - contributions_cents + withdrawals_cents + archived_out_cents + released_cents. */
  appreciation_cents: number;
  /**
   * De onde vieram os aportes: "diario" = todos lançados nos ativos (exato);
   * "misto" = parte dos meses estimada pelo aporte planejado; "planejado" = todos estimados.
   */
  contributions_source: ContributionsSource;
  /** Meses "YYYY-MM" (crescente) estimados pelo plano; vazio quando exato. */
  estimated_months: string[];
  /** Valor dos ativos antigos trazidos para o app no período (entra como aporte, para não virar valorização). */
  new_assets_cents: number;
}

export interface Evolution {
  classes: { key: string; name: string; color: string; archived: boolean }[];
  points: EvolutionPoint[];
  summary: EvolutionSummary | null;
}

export interface SnapshotItemInput {
  class_key: string;
  invested_cents: number;
  current_cents: number;
}

export interface ContributionsMonth {
  /** "YYYY-MM". */
  month: string;
  /** Aporte do mês, já com o que ficou fora da meta (`goal_cents + off_goal_cents`). */
  contributed_cents: number;
  goal_cents: number;
  off_goal_cents: number;
  /** Saldo de ativo antigo trazido para o app. Fica fora de `contributed_cents`. */
  carried_in_cents: number;
  /** Aporte planejado do mês; null quando o mês não tem plano (não é zero). */
  planned_cents: number | null;
  /** Só o mês atual. */
  in_progress: boolean;
}

export interface ContributionsByMonth {
  from_month: string;
  to_month: string;
  current_month: string;
  /** Crescente, um item por mês do intervalo. Vazio quando não há dados e o início não foi pedido. */
  months: ContributionsMonth[];
}
