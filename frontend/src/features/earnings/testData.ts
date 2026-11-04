// Dados de teste do "salário do seu dinheiro" (usados só pelos testes), na forma que o back-end gera:
// primeiro salário e % do salário só em meses completos (passados); o mês corrente só aparece nos acumulados.
// A saída real do back-end está em testData.realShape.json.
import type { Earnings, EarningsMonth, Milestone, MilestoneKey } from "./types";

export const month = (patch: Partial<EarningsMonth> = {}): EarningsMonth => ({
  month: "2026-10",
  earned_cents: 0,
  appreciation_cents: 0,
  proventos_cents: 0,
  partial: false,
  through: `${patch.month ?? "2026-10"}-28`,
  has_update: true,
  salary_share_bps: null,
  measured_through: null,
  per_day_cents: null,
  work_minutes: null,
  ...patch,
});

const SHARES = [100, 500, 1_000, 2_500, 5_000, 10_000];
const TOTALS = [10_000, 100_000, 1_000_000, 10_000_000];

/** Todos os marcos do contrato, com os meses de conquista informados por chave. */
export function milestones(achieved: Partial<Record<MilestoneKey, string>> = {}): Milestone[] {
  return [
    { key: "first_salary", kind: "first", threshold: null, achieved_month: achieved.first_salary ?? null },
    ...SHARES.map((bps): Milestone => {
      const key = `share_${bps / 100}` as MilestoneKey;
      return { key, kind: "monthly_share", threshold: bps, achieved_month: achieved[key] ?? null };
    }),
    ...TOTALS.map((cents): Milestone => {
      const key = `total_${cents / 100}` as MilestoneKey;
      return { key, kind: "total_amount", threshold: cents, achieved_month: achieved[key] ?? null };
    }),
  ];
}

/** O caso de hoje: carteira recém-cadastrada, ganho zero e nenhum mês completo. */
export function starting(patch: Partial<Earnings> = {}): Earnings {
  const current = month({ partial: true, through: "2026-10-17", has_update: false });
  return {
    as_of: "2026-10-17",
    tracking_since: "2026-10-03",
    total: { earned_cents: 0, before_tracking_cents: 0, since_tracking_cents: 0, uncredited_proventos_cents: 0 },
    current_month: current,
    last_complete_month: null,
    pace: null,
    salary: { salary_cents: 500_000, month: "2026-10" },
    vs_salary: null,
    months: [current],
    milestones: milestones(),
    next_milestone: { key: "first_salary", progress_bps: 0 },
    ...patch,
  };
}

/**
 * Uma carteira com alguns meses: julho (cadastro), agosto sem atualização, setembro completo e outubro em
 * andamento. Primeiro salário e 1%/5% do salário em julho; R$ 1.000 acumulados chegaram em outubro.
 */
export function established(patch: Partial<Earnings> = {}): Earnings {
  const september = month({ month: "2026-09", earned_cents: 45_000, appreciation_cents: 40_000, proventos_cents: 5_000, salary_share_bps: 900 });
  const august = month({ month: "2026-08", has_update: false });
  const current = month({
    partial: true,
    through: "2026-10-17",
    measured_through: "2026-10-17",
    earned_cents: 30_000,
    appreciation_cents: 30_000,
    salary_share_bps: 600,
    per_day_cents: 1_765, // R$ 300,00 em 17 dias
    work_minutes: 792, // 13 h 12 min
  });
  return {
    as_of: "2026-10-17",
    tracking_since: "2026-07-03",
    total: { earned_cents: 120_000, before_tracking_cents: 20_000, since_tracking_cents: 100_000, uncredited_proventos_cents: 5_000 },
    current_month: current,
    last_complete_month: september,
    pace: { per_day_cents: 1_500, basis_months: 3, from_month: "2026-07", to_month: "2026-09" },
    salary: { salary_cents: 500_000, month: "2026-10" },
    vs_salary: { month: "2026-09", earned_cents: 45_000, share_bps: 900, work_minutes: 200 },
    months: [month({ month: "2026-07", earned_cents: 25_000, appreciation_cents: 25_000, salary_share_bps: 500 }), august, september, current],
    milestones: milestones({ first_salary: "2026-07", share_1: "2026-07", share_5: "2026-07", total_100: "2026-07", total_1000: "2026-10" }),
    next_milestone: { key: "share_10", progress_bps: 6_000 },
    ...patch,
  };
}
