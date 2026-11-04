import type { ReactNode } from "react";
import { ringArcs } from "@/shared/lib/ring";
import { cx } from "./primitives";

/**
 * Rosca de pontas arredondadas e lacunas entre as fatias. É só uma imagem do que vem escrito ao lado (nomes e
 * valores nas linhas): `label` resume a distribuição para leitores de tela e `children` é o texto do centro.
 */
export function Ring({
  slices,
  label,
  children,
  className,
}: {
  slices: readonly { key: string; value: number; color: string }[];
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  const size = 220;
  const thickness = 26;
  const arcs = ringArcs(slices, { size, thickness });
  const color = new Map(slices.map((s) => [s.key, s.color]));
  return (
    <div role="img" aria-label={label} className={cx("relative mx-auto aspect-square w-full max-w-60", className)}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden className="size-full">
        {arcs.map((arc) => (
          <path
            key={arc.key}
            d={arc.d}
            fill="none"
            strokeWidth={thickness}
            strokeLinecap="round"
            style={{ stroke: color.get(arc.key) }}
          />
        ))}
      </svg>
      {children && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          {children}
        </div>
      )}
    </div>
  );
}
