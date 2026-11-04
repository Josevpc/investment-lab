export interface AllocationClass {
  key: string;
  name: string;
  color: string;
}

export interface PlanTarget {
  class_id: number;
  class_key: string;
  class_name: string;
  color: string;
  percent_bps: number;
}

export interface Plan {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string | null;
  targets: PlanTarget[];
}

export interface PlanInput {
  name: string;
  targets: { class_key: string; percent_bps: number }[];
}

export type SplitMode = "proportional" | "rebalance";

/**
 * Situação da categoria quanto aos ativos mantidos (marca no cadastro do ativo): "all" = tem ativos e
 * todos estão mantidos (a categoria não recebe aporte e a meta fica suspensa); "partial" = alguns.
 */
export type HoldStatus = "none" | "partial" | "all";

export interface AssetRef {
  asset_id: number;
  name: string;
}

export interface HeldAsset extends AssetRef {
  current_cents: number;
}

export interface SplitItem {
  class_id: number;
  class_key: string;
  class_name: string;
  color: string;
  /** Grupo da categoria (só informativo); ausente numa API anterior aos grupos. */
  group_id?: number | null;
  target_bps: number;
  current_cents: number;
  amount_cents: number;
  hold_status: HoldStatus;
  /** Igual a target_bps, salvo quando alguma categoria está toda mantida: aí as que recebem são
   * reescaladas para somar 100% e a mantida fica com 0. */
  effective_target_bps: number;
  /** Ativos da categoria que podem receber o aporte dela. */
  receiving_assets: AssetRef[];
  held_assets: HeldAsset[];
}

export interface Split {
  plan_id: number;
  plan_name: string;
  mode: SplitMode;
  amount_cents: number;
  items: SplitItem[];
}

export interface ComparisonItem {
  class_id: number;
  class_key: string;
  class_name: string;
  color: string;
  /** Grupo da categoria; ausente numa API anterior aos grupos. */
  group_id?: number | null;
  current_cents: number;
  /** Participação na carteira toda (sem a reserva). */
  current_bps: number;
  target_bps: number;
  /** Meta reescalada quando alguma categoria está toda mantida (ver SplitItem). */
  effective_target_bps: number;
  hold_status: HoldStatus;
  /** Falta (negativo) ou sobra (positivo) frente à meta; null na categoria toda mantida. */
  diff_cents: number | null;
  held_assets: HeldAsset[];
}

/** Subtotal de um grupo: soma das categorias dele (o grupo não tem meta própria). */
export interface ComparisonGroup {
  group_id: number;
  name: string;
  color: string;
  class_keys: string[];
  current_cents: number;
  /** Participação na carteira toda (sem a reserva). */
  current_bps: number;
  /** Soma das metas gravadas das categorias. */
  target_bps: number;
  /** Soma das metas efetivas (a categoria toda mantida conta 0 e as outras são reescaladas). */
  effective_target_bps: number;
  /** Soma do falta/sobra das categorias que têm meta; null se todas estão toda mantidas. */
  diff_cents: number | null;
  /** "all": todas as categorias do grupo estão todas mantidas; "partial": só algumas. */
  hold_status: HoldStatus;
}

export interface Comparison {
  plan_id: number;
  plan_name: string;
  /** Total da carteira (sem a reserva). */
  total_cents: number;
  /** Total sem as categorias todas mantidas: a base do falta/sobra. */
  base_cents: number;
  items: ComparisonItem[];
  /** Ausente numa API anterior aos grupos; vazio se não há grupos. */
  groups?: ComparisonGroup[];
}
