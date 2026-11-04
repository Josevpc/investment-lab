import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { onCelebrate, type ActiveCelebration } from "@/shared/lib/celebrate";
import { cx } from "./primitives";
import { CheckIcon } from "./icons";

const DISMISS_AFTER_MS = 9_000;
const PIECES = 28;
const COLORS = ["bg-[var(--chart-cat-1)]", "bg-[var(--chart-cat-2)]", "bg-[var(--chart-cat-3)]", "bg-[var(--chart-cat-4)]", "bg-[var(--chart-cat-5)]", "bg-[var(--chart-cat-6)]"];

/** Confete decorativo. Posições fixas por peça (sem sorteio) para a animação ser previsível. */
function Confetti() {
  return (
    <div aria-hidden className="confetti pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {Array.from({ length: PIECES }, (_, i) => (
        <span
          key={i}
          className={cx("confetti-piece", COLORS[i % COLORS.length])}
          style={
            {
              left: `${(i * 37) % 100}%`,
              "--delay": `${(i % 7) * 70}ms`,
              "--dur": `${1500 + (i % 5) * 220}ms`,
              "--drift": `${((i % 9) - 4) * 18}px`,
              "--spin": `${(i % 2 ? 1 : -1) * (240 + i * 25)}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Aviso festivo ao concluir uma ação. Fica um tempo na tela, para se a pessoa passar o mouse ou focar. */
export function CelebrationHost() {
  const [current, setCurrent] = useState<ActiveCelebration | null>(null);
  const paused = useRef(false);

  useEffect(() => onCelebrate(setCurrent), []);

  useEffect(() => {
    if (!current) return;
    const id = current.id;
    const timer = window.setInterval(() => {
      if (!paused.current) setCurrent((now) => (now?.id === id ? null : now));
    }, DISMISS_AFTER_MS);
    return () => window.clearInterval(timer);
  }, [current]);

  if (!current) return null;

  return (
    <>
      <Confetti key={current.id} />
      <div
        role="status"
        aria-live="polite"
        onMouseEnter={() => (paused.current = true)}
        onMouseLeave={() => (paused.current = false)}
        onFocus={() => (paused.current = true)}
        onBlur={() => (paused.current = false)}
        className="rise fixed bottom-24 left-4 right-4 z-50 rounded-card bg-card p-5 shadow-soft ring-1 ring-raise sm:left-auto sm:right-6 sm:w-96 lg:bottom-6"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-jade-t text-jade"
          >
            <CheckIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-serif text-xl leading-snug">{current.title}</p>
            <p className="mt-1 text-sm text-ink-2">{current.text}</p>
            {current.highlight && (
              <p className="mt-3 rounded-field bg-gold-t px-3 py-2 text-sm font-semibold text-ink">
                {current.highlight}
              </p>
            )}
            {current.next?.to ? (
              <Link
                to={current.next.to}
                onClick={() => setCurrent(null)}
                className="mt-3 inline-block text-sm font-medium text-ink underline underline-offset-4"
              >
                {current.next.label}
              </Link>
            ) : (
              current.next && (
                <p className="mt-3 text-sm text-ink-2">
                  <strong>A seguir:</strong> {current.next.label}
                </p>
              )
            )}
          </div>
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={() => setCurrent(null)}
            className="-mr-2 -mt-2 inline-flex size-10 items-center justify-center rounded-full text-lg text-ink-3 transition-colors hover:bg-raise"
          >
            ×
          </button>
        </div>
      </div>
    </>
  );
}
