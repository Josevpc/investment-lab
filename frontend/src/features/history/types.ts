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
  /** change_cents - contributions_cents + withdrawals_cents + archived_out_cents. */
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
