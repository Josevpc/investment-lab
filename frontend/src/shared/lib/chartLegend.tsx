import type { ReactNode } from "react";

/**
 * Texto da legenda do Recharts em tinta de texto, com a amostra colorida ao lado: por padrão a biblioteca pinta o
 * texto com a cor da série (Criptomoedas, Renda Fixa e Investido ficavam abaixo de 3:1). A cor identifica a série
 * na amostra; o nome é lido em `--ink-2`.
 */
export function legendText(value: unknown): ReactNode {
  return <span style={{ color: "var(--ink-2)" }}>{String(value)}</span>;
}
