// Estilos comuns dos gráficos. As cores vêm de variáveis CSS (index.css) e acompanham o tema.
export const AXIS = "var(--chart-axis)";
export const GRID = "var(--chart-grid)";
export const GOLD = "var(--chart-gold)";
export const MUTED = "var(--chart-muted)";
/** Índice de bolsa (Ibovespa): matiz frio, longe do dourado da carteira e do verde do CDI. */
export const INDEX = "var(--chart-index)";

/**
 * Categóricas na ordem fixa: seis tons de terra (musgo, argila, ocre, pedra azul, ameixa, areia), iguais nos dois temas.
 * A 7ª posição não existe: o que passar de 6 vira "Outros" (em `MUTED`), porque uma cor gerada a mais não
 * se distinguiria das demais. Sempre aparecem com nome ou valor junto.
 */
export const CATEGORICAL = [1, 2, 3, 4, 5, 6].map((n) => `var(--chart-cat-${n})`);

/** A reserva de emergência tem meta própria: leva o mel, fora das seis categorias. */
export const RESERVE_COLOR = "var(--gold)";

export const tooltipStyle = {
  borderRadius: 16,
  border: "none",
  boxShadow: "var(--tooltip-shadow)",
  backgroundColor: "var(--tooltip-bg)",
  color: "var(--tooltip-fg)",
  fontSize: 13,
};

export const percentLabel = (value: number) => `${value.toFixed(1).replace(".", ",")}%`;
