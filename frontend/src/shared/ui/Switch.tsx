import { useId, type ReactNode } from "react";
import { cx } from "./primitives";

/**
 * Interruptor liga/desliga (role="switch"). O rótulo também é clicável, o que amplia a área de toque.
 * `hint` explica o efeito; com `disabled`, `disabledReason` diz por que não dá para mudar.
 */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
  disabledReason,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const reasonId = `${id}-reason`;
  const showReason = disabled && disabledReason;
  const describedBy = [hint ? hintId : null, showReason ? reasonId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("flex min-h-10 items-start gap-3", className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-150",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-ink" : "bg-soil ring-1 ring-inset ring-ink-3",
        )}
      >
        <span
          aria-hidden
          className={cx(
            "inline-block size-5 rounded-full transition-transform duration-150",
            checked ? "translate-x-6 bg-card" : "translate-x-1 bg-ink-3",
          )}
        />
      </button>
      <div className="min-w-0 text-sm">
        <label htmlFor={id} className={cx("font-medium", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
          {label}
        </label>
        {hint && (
          <p id={hintId} className="text-xs text-ink-3">
            {hint}
          </p>
        )}
        {showReason && (
          <p id={reasonId} className="text-xs text-ink-2">
            {disabledReason}
          </p>
        )}
      </div>
    </div>
  );
}
