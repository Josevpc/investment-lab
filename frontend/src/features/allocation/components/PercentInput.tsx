import { useEffect, useState } from "react";
import { bpsToInput, parsePercentToBps } from "@/shared/lib/format";
import { inputClass } from "@/shared/ui";

interface PercentInputProps {
  bps: number;
  onCommit: (bps: number) => void;
  disabled?: boolean;
  label: string;
  className?: string;
}

/** Campo de percentual: aceita "7,5" e só aplica ao sair do campo ou apertar Enter. */
export function PercentInput({ bps, onCommit, disabled, label, className }: PercentInputProps) {
  const [text, setText] = useState(bpsToInput(bps));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(bpsToInput(bps));
  }, [bps, focused]);

  function commit() {
    const parsed = parsePercentToBps(text);
    if (parsed === null) {
      setText(bpsToInput(bps));
      return;
    }
    onCommit(parsed);
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <input
        aria-label={label}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        className={`${inputClass} tabular pr-7 text-right`}
        onFocus={() => setFocused(true)}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-slate-400">
        %
      </span>
    </div>
  );
}
