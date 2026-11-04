import { centsToInput, parseMoneyToCents } from "@/shared/lib/format";
import type { Asset } from "../types";
import { previewClosing, type ClosingPreview } from "./closing";
import { valueFromQuote } from "./quote";

/** O que a pessoa digitou numa linha da atualização rápida. Campo em branco = não mexeu. */
export interface Draft {
  balance: string;
  /** Cotação (ativos com quantidade): quando preenchida, o saldo passa a ser quantidade × cotação. */
  quote: string;
  contribution: string;
  /** Dia do aporte. Ausente (ou "") = o mesmo dia do saldo; a tela guarda o que foi digitado, mesmo vazio. */
  contributionDate?: string;
}

export interface InstitutionGroup {
  id: number;
  name: string;
  assets: Asset[];
}

/** Uma instituição por vez: a pessoa abre o app do banco e atualiza tudo o que está nele. */
export function groupByInstitution(assets: readonly Asset[]): InstitutionGroup[] {
  const groups = new Map<number, InstitutionGroup>();
  for (const asset of assets) {
    const group = groups.get(asset.institution_id) ?? { id: asset.institution_id, name: asset.institution_name, assets: [] };
    group.assets.push(asset);
    groups.set(asset.institution_id, group);
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pt-BR");
  return [...groups.values()].map((g) => ({ ...g, assets: [...g.assets].sort(byName) })).sort(byName);
}

const DAY_MS = 86_400_000;

// Data sem fuso: nada de `new Date("2026-10-31")`, que desloca o dia.
function dayNumber(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

export function daysSince(iso: string, today: string): number {
  return Math.max(0, dayNumber(today) - dayNumber(iso));
}

/** Quem atualiza toda semana quer ver o que passou de uma semana sem atualização. */
export const STALE_AFTER_DAYS = 7;

export const isStale = (days: number): boolean => days > STALE_AFTER_DAYS;

export function updatedLabel(days: number): string {
  if (days === 0) return "atualizado hoje";
  if (days === 1) return "atualizado ontem";
  return `atualizado há ${days} dias`;
}

export interface PeriodResult {
  /** Quanto o ativo rendeu desde o saldo anterior, sem contar o aporte. */
  gainCents: number;
  /** Rendimento sobre o saldo anterior, em pontos-base; null sem saldo anterior. */
  returnBps: number | null;
}

/** Divisão inteira arredondando meio para cima (inclusive para negativos). */
function roundedBps(numerator: number, denominator: number): number {
  const n = BigInt(numerator) * 10_000n;
  const d = BigInt(denominator);
  const scaled = 2n * n + d; // (n/d + 1/2), com o piso feito abaixo
  const twice = 2n * d;
  const floor = scaled >= 0n ? scaled / twice : -((-scaled + twice - 1n) / twice);
  return Number(floor);
}

/** O aporte é dinheiro que entrou, não rendimento: sai da conta, como no fechamento do mês. */
export function periodResult(previousCents: number, balanceCents: number, contributionCents: number): PeriodResult {
  const gainCents = balanceCents - previousCents - contributionCents;
  return { gainCents, returnBps: previousCents > 0 ? roundedBps(gainCents, previousCents) : null };
}

export type RowState =
  | { kind: "skip" }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; preview: ClosingPreview; result: PeriodResult };

/** O que vai acontecer com um ativo, a partir do que foi digitado nele. */
export function evaluateRow(asset: Asset, draft: Draft, date: string): RowState {
  const quoted = draft.quote.trim() !== "";
  const blankBalance = !quoted && draft.balance.trim() === "";
  const blankContribution = draft.contribution.trim() === "";
  if (blankBalance && blankContribution) return { kind: "skip" };
  if (blankBalance) return { kind: "invalid", message: "Informe o saldo atual, já com o aporte." };

  let balance = draft.balance;
  if (quoted) {
    const cents = valueFromQuote(asset.quantity, draft.quote);
    if (cents === null) return { kind: "invalid", message: "Cotação inválida." };
    balance = centsToInput(cents);
  }
  if (parseMoneyToCents(balance) === null || (!blankContribution && parseMoneyToCents(draft.contribution) === null)) {
    return { kind: "invalid", message: "Valor inválido." };
  }

  const preview = previewClosing(asset, { contribution: draft.contribution, contributionDate: draft.contributionDate ?? "", balance, investedOverride: null }, date);
  if (!preview.valid) return { kind: "invalid", message: "O dia do aporte não pode ser depois do dia do saldo." };
  if (!preview.changed) return { kind: "skip" };
  return { kind: "ready", preview, result: periodResult(asset.current_cents, preview.balanceCents ?? 0, preview.contributionCents) };
}

export interface TotalResult {
  gainCents: number;
  returnBps: number | null;
  /** Soma dos saldos anteriores dos ativos que entram na variação em %. */
  previousCents: number;
}

/** Total dos ativos atualizados. Ativo sem saldo anterior conta no rendimento em R$, mas não na base do %. */
export function totalResult(items: readonly { previousCents: number; gainCents: number }[]): TotalResult | null {
  if (items.length === 0) return null;
  const measurable = items.filter((i) => i.previousCents > 0);
  const previousCents = measurable.reduce((sum, i) => sum + i.previousCents, 0);
  const measuredGain = measurable.reduce((sum, i) => sum + i.gainCents, 0);
  return {
    gainCents: items.reduce((sum, i) => sum + i.gainCents, 0),
    returnBps: previousCents > 0 ? roundedBps(measuredGain, previousCents) : null,
    previousCents,
  };
}
