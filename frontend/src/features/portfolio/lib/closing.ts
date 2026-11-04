import { parseMoneyToCents } from "@/shared/lib/format";
import type { Asset } from "../types";

export interface ClosingInput {
  /** Dinheiro novo depositado no mês ("" = nenhum). */
  contribution: string;
  /** Dia em que o aporte foi feito ("" = o mesmo dia do saldo). */
  contributionDate?: string;
  /** Saldo do extrato, já com o aporte. */
  balance: string;
  /** Cotação digitada (ativos com quantidade): o saldo passa a ser quantidade × cotação. */
  quote?: string;
  /** Correção manual do investido (null = não corrigir). */
  investedOverride: string | null;
}

export interface ClosingPreview {
  valid: boolean;
  changed: boolean;
  contributionCents: number;
  /** Dia do aporte já resolvido (o do saldo quando não foi informado outro). */
  contributionDate: string | null;
  balanceCents: number | null;
  /** Valor investido depois do fechamento (corrigido + aporte). */
  investedCents: number | null;
  /** Rendimento depois do fechamento: saldo - investido. */
  gainCents: number | null;
  /** Só quando o investido foi corrigido à mão. */
  investedOverrideCents: number | null;
}

/** Calcula, a partir do que foi digitado, o investido e o rendimento que o app vai gravar. */
export function previewClosing(asset: Asset, input: ClosingInput, closingDate?: string): ClosingPreview {
  const contribution = input.contribution.trim() === "" ? 0 : parseMoneyToCents(input.contribution);
  const balance = parseMoneyToCents(input.balance);
  const override = input.investedOverride === null ? null : parseMoneyToCents(input.investedOverride);

  // O aporte não pode ser depois do dia do saldo.
  const dateOk = !input.contributionDate || !closingDate || input.contributionDate <= closingDate;
  const valid =
    contribution !== null && balance !== null && dateOk && (input.investedOverride === null || override !== null);
  if (!valid) {
    return {
      valid: false,
      changed: false,
      contributionCents: contribution ?? 0,
      contributionDate: input.contributionDate || null,
      balanceCents: balance,
      investedCents: null,
      gainCents: null,
      investedOverrideCents: override,
    };
  }

  const baseInvested = override ?? asset.invested_cents;
  const invested = baseInvested + (contribution ?? 0);
  return {
    valid: true,
    changed: (contribution ?? 0) > 0 || balance !== asset.current_cents || (override !== null && override !== asset.invested_cents),
    contributionCents: contribution ?? 0,
    contributionDate: input.contributionDate || null,
    balanceCents: balance,
    investedCents: invested,
    gainCents: (balance as number) - invested,
    investedOverrideCents: override,
  };
}
