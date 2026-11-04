import type { ReactNode } from "react";
import { cx } from "./primitives";

/**
 * Número de destaque sem caixa: o rótulo em frase (apoio) e o valor em Fraunces. Vários em linha formam a faixa
 * de totais de uma tela. O tom só colore o valor; o sinal (▲, ▼) e as palavras do `hint` dizem o mesmo por escrito.
 */
export function Figure({
  label,
  value,
  hint,
  tone,
  size = "lg",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "good";
  size?: "lg" | "md";
}) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-ink-2">{label}</p>
      <p className={cx("tabular mt-1 break-words font-serif", size === "lg" ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl", tone === "good" && "text-jade")}>
        {value}
      </p>
      {/* ink-2 e não ink-3: o rótulo costuma estar sobre `soil`, onde ink-3 fica abaixo de 4,5:1. */}
      {hint && <p className="mt-1 text-sm text-ink-2">{hint}</p>}
    </div>
  );
}
