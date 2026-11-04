/**
 * Quanto do CDI a carteira rendeu, em % inteiro (arredonda meio para cima): carteira 6% e CDI 8% → 75.
 * null quando não há comparação honesta: sem um dos dois, ou CDI zerado ou negativo (dividir por ele não
 * diz nada). Carteira negativa vira 0, que a tela escreve como "não rendeu o CDI".
 */
export function shareOfCdi(portfolioBps: number | null, cdiBps: number | null): number | null {
  if (portfolioBps === null || cdiBps === null || cdiBps <= 0) return null;
  if (portfolioBps <= 0) return 0;
  return Math.floor((portfolioBps * 100 * 2 + cdiBps) / (cdiBps * 2));
}

/** Larguras das duas barras de uma comparação, em bps de 0 a 10.000: a maior ocupa a barra toda. */
export function comparisonBars(a: number | null, b: number | null): { a: number; b: number } {
  const top = Math.max(a ?? 0, b ?? 0);
  if (top <= 0) return { a: 0, b: 0 };
  const scale = (value: number | null) => Math.round((Math.max(value ?? 0, 0) * 10_000) / top);
  return { a: scale(a), b: scale(b) };
}
