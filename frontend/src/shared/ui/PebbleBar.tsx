import { useId, type CSSProperties } from "react";
import { SEPARATED } from "@/shared/lib/chart";
import { cx } from "./primitives";
import { SeparatedPattern } from "./SeparatedMark";

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
  separatedBps = 0,
  valueText,
}: {
  /**
   * Trecho "separado" (dinheiro guardado, ainda não investido) logo depois do valor: hachurado e com contorno tracejado.
   * `valueBps` passa a ser só o trecho cheio; quem usa escreve os dois valores por extenso ao lado.
   */
  separatedBps?: number;
  /** Texto para leitor de tela com os valores por extenso (`aria-valuetext`); só em "progressbar". */
  valueText?: string;
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
  const patternId = `sep-${useId().replace(/:/g, "")}`;
  const value = Math.min(Math.max(valueBps, 0), 10_000);
  const separated = Math.min(Math.max(separatedBps, 0), 10_000 - value);
  // Quem lê a barra ouve a soma dos dois trechos: é o quanto da meta já está coberto.
  const covered = value + separated;
  const progress =
    role === "progressbar"
      ? {
          "aria-valuenow": Math.round(covered / 100),
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuetext": valueText,
        }
      : {};
  return (
    <div
      role={role}
      aria-label={label}
      {...progress}
      className={cx("relative h-3.5 rounded-full bg-[var(--pebble-track,var(--raise))]", className)}
      style={track ? ({ "--pebble-track": track } as CSSProperties) : undefined}
    >
      {separated > 0 ? (
        // Dois trechos lado a lado dentro da pílula: o cheio (comprado) e o hachurado (separado).
        <div className="flex h-full overflow-hidden rounded-full">
          {value > 0 && (
            <div data-fill className="h-full shrink-0" style={{ width: `${value / 100}%`, minWidth: "0.875rem", backgroundColor: color }} />
          )}
          <svg
            data-separated
            aria-hidden
            className="h-full min-w-3.5 shrink-0"
            style={{ width: `${separated / 100}%` }}
          >
            <defs>
              <SeparatedPattern id={patternId} />
            </defs>
            <rect
              x="1"
              y="1"
              // Largura em CSS (calc) para o contorno caber inteiro no trecho, qualquer que seja o tamanho dele.
              style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }}
              rx="4"
              fill={`url(#${patternId})`}
              stroke={SEPARATED}
              strokeWidth="1.5"
              strokeDasharray="4 2"
            />
          </svg>
        </div>
      ) : (
        <div
          data-fill
          className="h-full rounded-full"
          style={{ width: `${value / 100}%`, minWidth: value > 0 ? "0.875rem" : undefined, backgroundColor: color }}
        />
      )}
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
