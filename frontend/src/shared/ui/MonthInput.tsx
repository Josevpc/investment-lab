import { useEffect, useId, useRef, useState } from "react";
import { formatMonthLong, isValidMonth } from "@/shared/lib/format";

const SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-10" + 1 -> "2026-11" (e vira o ano em dezembro). */
export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const index = year * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function currentYm(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** "outubro de 2026" -> "Outubro de 2026" (só a primeira letra). */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const arrow =
  "inline-flex size-10 items-center justify-center rounded-full bg-raise text-lg text-ink-2 transition-colors duration-150 hover:bg-soil";

/**
 * Seletor de mês sem digitação: setas para o mês anterior e o próximo e, ao clicar no mês, uma
 * grade com os 12 meses do ano e setas para trocar de ano.
 */
export function MonthInput({
  value,
  onChange,
  "aria-label": ariaLabel = "Mês",
}: {
  value: string;
  onChange: (month: string) => void;
  "aria-label"?: string;
}) {
  const safe = isValidMonth(value) ? value : currentYm();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(safe.slice(0, 4)));
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => setYear(Number(safe.slice(0, 4))), [safe]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const onClick = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const now = currentYm();
  const pick = (month: string) => {
    onChange(month);
    setOpen(false);
  };

  return (
    <div ref={box} role="group" aria-label={ariaLabel} className="relative inline-flex items-center gap-1.5">
      <button type="button" className={arrow} aria-label="Mês anterior" onClick={() => onChange(shiftMonth(safe, -1))}>
        ‹
      </button>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="min-h-10 min-w-44 rounded-full bg-raise px-4 text-sm font-medium text-ink transition-colors duration-150 hover:bg-soil"
      >
        {sentence(formatMonthLong(safe))} <span aria-hidden>▾</span>
      </button>
      <button type="button" className={arrow} aria-label="Próximo mês" onClick={() => onChange(shiftMonth(safe, 1))}>
        ›
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Escolher mês"
          className="rise absolute left-0 top-full z-30 mt-2 w-72 rounded-card bg-card p-4 shadow-soft ring-1 ring-raise"
        >
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className={arrow} aria-label="Ano anterior" onClick={() => setYear((y) => y - 1)}>
              ‹
            </button>
            <span className="tabular font-serif text-xl" aria-live="polite">
              {year}
            </span>
            <button type="button" className={arrow} aria-label="Próximo ano" onClick={() => setYear((y) => y + 1)}>
              ›
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {SHORT.map((name, index) => {
              const month = `${year}-${String(index + 1).padStart(2, "0")}`;
              const selected = month === safe;
              return (
                <button
                  key={month}
                  type="button"
                  aria-pressed={selected}
                  aria-label={formatMonthLong(month)}
                  onClick={() => pick(month)}
                  className={
                    "min-h-10 rounded-full px-2 text-sm font-medium capitalize transition-colors duration-150 " +
                    (selected
                      ? "bg-ink text-card"
                      : month === now
                        ? "bg-raise text-ink hover:bg-soil"
                        : "text-ink-2 hover:bg-raise")
                  }
                >
                  {name}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="mt-3 min-h-10 w-full rounded-full px-2 text-sm font-medium text-ink-2 transition-colors duration-150 hover:bg-raise"
            onClick={() => pick(now)}
          >
            Ir para o mês atual
          </button>
        </div>
      )}
    </div>
  );
}
