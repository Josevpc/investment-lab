import { useId } from "react";
import { formatPercent } from "@/shared/lib/format";
import { cx, inputClass } from "@/shared/ui";
import { IR_RATES } from "../lib/irRate";

/**
 * Alíquota de IR usada para comparar ativos isentos e tributados. Fica no navegador (ver `useIrRate`).
 * É uma simulação: o imposto devido de verdade depende do prazo de cada aplicação.
 */
export function IrRateSelect({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (bps: number) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx("text-sm", className)}>
      <label htmlFor={id} className="mb-1.5 block font-medium text-ink-2">
        Alíquota de IR para comparar
      </label>
      <select
        id={id}
        aria-describedby={`${id}-hint`}
        className={cx(inputClass, "tabular w-auto!")}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {IR_RATES.map((rate) => (
          <option key={rate.bps} value={rate.bps}>
            {formatPercent(rate.bps)} ({rate.hint})
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-3">
        Simulação: prazos maiores pagam menos IR. A escolha fica neste navegador.
      </p>
    </div>
  );
}
