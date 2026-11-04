import type { CSSProperties } from "react";
import { cx } from "./primitives";

/**
 * Barra "seixo": a única barra do produto (participação, meta, reserva). Trilho de 14px em pílula e
 * marcador de meta em círculo com anel de mel. O valor nunca depende da forma: quem usa a barra escreve
 * o número ao lado, e `label` o descreve para leitores de tela.
 */
export function PebbleBar({
  valueBps,
  targetBps,
  color = "var(--jade)",
  label,
  role,
  className,
  marks,
  track,
}: {
  /** Cor do trilho (CSS), para barras sobre um fundo que já é `raise`. */
  track?: string;
  valueBps: number;
  targetBps?: number;
  /** Marcos no trilho (em pontos-base): círculo de mel quando o valor já os alcançou, cinza quando não. */
  marks?: readonly number[];
  color?: string;
  label: string;
  /** "progressbar" quando é progresso até uma meta; "img" quando é só uma participação. */
  role: "progressbar" | "img";
  className?: string;
}) {
  const value = Math.min(Math.max(valueBps, 0), 10_000);
  const progress =
    role === "progressbar" ? { "aria-valuenow": Math.round(value / 100), "aria-valuemin": 0, "aria-valuemax": 100 } : {};
  return (
    <div
      role={role}
      aria-label={label}
      {...progress}
      className={cx("relative h-3.5 rounded-full bg-[var(--pebble-track,var(--raise))]", className)}
      style={track ? ({ "--pebble-track": track } as CSSProperties) : undefined}
    >
      <div
        data-fill
        className="h-full rounded-full"
        style={{ width: `${value / 100}%`, minWidth: value > 0 ? "0.875rem" : undefined, backgroundColor: color }}
      />
      {marks?.map((mark) => (
        <span
          key={mark}
          data-mark={value >= mark ? "reached" : "pending"}
          aria-hidden
          className={cx(
            "absolute top-1/2 size-[1.125rem] -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-card",
            value >= mark ? "bg-gold" : "bg-ink-3/40",
          )}
          style={{ left: `${Math.min(Math.max(mark / 100, 0), 100)}%` }}
        />
      ))}
      {targetBps !== undefined && (
        <span
          data-target
          aria-hidden
          className="absolute top-1/2 size-[1.125rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-card ring-[3px] ring-gold"
          style={{ left: `${Math.min(Math.max(targetBps / 100, 0), 100)}%` }}
        />
      )}
    </div>
  );
}
