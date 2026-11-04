import { parseMoneyToCents, parsePercentToBps } from "@/shared/lib/format";

/**
 * Parte do aporte para a reserva, digitada em reais ("97,50") ou como % do aporte ("20%").
 * Vazio é zero; texto inválido é null (a tela avisa em vez de tratar como zero).
 * A porcentagem usa BigInt e arredonda meio para cima ao centavo, como o back-end.
 */
export function parseReserveInput(text: string, contributionCents: number): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  if (!trimmed.includes("%")) return parseMoneyToCents(trimmed);
  const bps = parsePercentToBps(trimmed);
  if (bps === null) return null;
  return Number((BigInt(contributionCents) * BigInt(bps) + 5_000n) / 10_000n);
}
