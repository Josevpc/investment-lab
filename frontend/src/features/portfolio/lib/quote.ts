/**
 * Valor de uma posição a partir da quantidade e da cotação: valor = quantidade × cotação.
 *
 * Usa inteiros grandes (BigInt) para não passar por ponto flutuante: a quantidade aceita até 8 casas
 * decimais (cripto) e a cotação até 6.
 */

const QTY_DECIMALS = 8;
const PRICE_DECIMALS = 6;

/** "1.234,56", "10,5", "0.0025", "R$ 12" -> número decimal normalizado, ou null se inválido. */
function normalize(input: string, maxDecimals: number): { digits: bigint; decimals: number } | null {
  const cleaned = input.replace(/[R$\s]/g, "");
  if (cleaned === "") return null;
  let text: string;
  if (cleaned.includes(",")) text = cleaned.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) text = cleaned.replace(/\./g, ""); // "1.000" é milhar
  else text = cleaned;
  const match = /^(\d+)(?:\.(\d{1,}))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > maxDecimals) return null;
  return { digits: BigInt(match[1] + fraction), decimals: fraction.length };
}

/** A quantidade vale como número positivo? (a do cadastro é texto livre) */
export function parseQuantity(input: string | null | undefined): { digits: bigint; decimals: number } | null {
  if (!input) return null;
  const parsed = normalize(input, QTY_DECIMALS);
  return parsed && parsed.digits > 0n ? parsed : null;
}

/** Centavos da posição, arredondando meio para cima, ou null se a quantidade ou a cotação forem inválidas. */
export function valueFromQuote(quantity: string | null | undefined, price: string): number | null {
  const q = parseQuantity(quantity);
  const p = normalize(price, PRICE_DECIMALS);
  if (!q || !p || p.digits === 0n) return null;
  // reais = (q.digits / 10^q.decimals) × (p.digits / 10^p.decimals); centavos = reais × 100.
  const numerator = q.digits * p.digits * 100n;
  const denominator = 10n ** BigInt(q.decimals + p.decimals);
  const cents = (2n * numerator + denominator) / (2n * denominator);
  return Number(cents);
}

/** Soma duas quantidades (a atual pode ser vazia) sem ponto flutuante; devolve "0.005", sem zeros à direita. */
export function addQuantities(current: string | null | undefined, added: string): string | null {
  const b = parseQuantity(added);
  if (!b) return null;
  const a = current?.trim() ? parseQuantity(current) : { digits: 0n, decimals: 0 };
  if (!a) return null;
  const scale = Math.max(a.decimals, b.decimals);
  const total = a.digits * 10n ** BigInt(scale - a.decimals) + b.digits * 10n ** BigInt(scale - b.decimals);
  const text = total.toString().padStart(scale + 1, "0");
  const whole = text.slice(0, text.length - scale);
  const fraction = text.slice(text.length - scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
