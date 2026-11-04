/**
 * Paleta de terra para categorias e grupos novos (musgo, argila, ocre, pedra azul, ameixa, areia): os mesmos
 * seis tons dos gráficos (`--chart-cat-*` em index.css). Fica em hexadecimal porque o seletor de cor do
 * navegador (`<input type="color">`) e a API guardam `#rrggbb`. Quem já escolheu outra cor mantém a sua.
 */
export const EARTH_PALETTE = ["#5e8a57", "#c46f4e", "#d6a84b", "#5b7c93", "#8b5e7d", "#a99b80"] as const;

/** Primeiro tom de terra que ainda não está em uso; com todos usados, volta a percorrer a paleta. */
export function nextEarthColor(used: readonly string[]): string {
  const taken = new Set(used.map((color) => color.toLowerCase()));
  return EARTH_PALETTE.find((color) => !taken.has(color)) ?? EARTH_PALETTE[used.length % EARTH_PALETTE.length];
}
