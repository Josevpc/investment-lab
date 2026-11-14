import type { ReactNode } from "react";

export interface LegendItem {
  key: string;
  label: string;
  /** Amostra (SVG decorativo): o nome ao lado é quem identifica a série. */
  swatch: ReactNode;
}

/** Legenda em HTML, sob o gráfico: texto legível por leitores de tela e testável, com a amostra de cada série. */
export function ChartLegend({ items, label = "Legenda do gráfico" }: { items: readonly LegendItem[]; label?: string }) {
  return (
    <ul aria-label={label} className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-ink-2">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-2">
          {item.swatch}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Amostra de linha (cheia ou tracejada) ou de área, nas cores do gráfico. */
export function LegendLine({ color, dash, width = 3 }: { color: string; dash?: string; width?: number }) {
  return (
    <svg aria-hidden width="30" height="8" className="shrink-0">
      <line x1="3" x2="27" y1="4" y2="4" stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={dash} />
    </svg>
  );
}

export function LegendBox({ color, opacity = 0.6 }: { color: string; opacity?: number }) {
  return (
    <svg aria-hidden width="14" height="14" className="shrink-0">
      <rect width="14" height="14" rx="3" fill={color} fillOpacity={opacity} stroke={color} />
    </svg>
  );
}
