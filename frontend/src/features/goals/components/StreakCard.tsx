import { formatMonth, monthName } from "@/shared/lib/format";
import { cx, Money } from "@/shared/ui";
import { plural, streakHeadline } from "../lib/goals";
import { streakRange } from "../lib/progress";
import { useMonthRemaining } from "../remaining";
import type { GoalsProgress, StreakState } from "../types";

const STATE_LABEL: Record<StreakState, string> = { met: "cumprido", missed: "não cumprido", open: "em andamento" };

/** Broto ilustrativo, parado: acompanha a sequência sem animação. */
function Sprout() {
  return (
    <svg aria-hidden viewBox="0 0 64 64" className="size-16 shrink-0 text-jade sm:size-20" fill="none">
      <ellipse cx="32" cy="55" rx="16" ry="4" className="fill-card" />
      <path d="M32 54V30" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M32 35C21 35 14 28 13 17c11 0 18 6 19 18Z" className="fill-card" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M32 29c0-9 5-14 16-16 0 9-5 16-16 16Z" className="fill-card" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
    </svg>
  );
}

function Dot({ state }: { state: StreakState }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold",
        state === "met" && "bg-jade text-card",
        state === "open" && "ring-[3px] ring-inset ring-gold",
        state === "missed" && "bg-ink-3/30",
      )}
    >
      {state === "met" ? "✓" : ""}
    </span>
  );
}

/** Sequência de meses cumpridos: o hábito que o app quer fortalecer. */
export function StreakCard({ progress }: { progress: GoalsProgress }) {
  const { streak, month } = progress;
  const remaining = useMonthRemaining(month);
  const range = streakRange(streak, month);
  const headline = streakHeadline(streak, month);
  const name = monthName(month);

  return (
    <section className="rise rounded-card bg-jade-t p-5 sm:p-7">
      <h2 className="font-serif text-xl sm:text-section">Sequência de aportes</h2>

      <div className="mt-5 flex items-center gap-4 sm:gap-5">
        <Sprout />
        <div className="min-w-0">
          {streak.current === 0 ? (
            <p className="font-serif text-3xl leading-tight sm:text-4xl">{headline.title}</p>
          ) : (
            <p className="tabular font-serif text-4xl leading-none sm:text-display">{plural(streak.current, "mês", "meses")}</p>
          )}
          {range && (
            <p className="mt-2 text-base text-ink-2">
              {range.start === range.end
                ? `em ${formatMonth(range.end)}, sem faltar nenhum`
                : `de ${formatMonth(range.start)} a ${formatMonth(range.end)}, sem faltar nenhum`}
            </p>
          )}
        </div>
      </div>

      <p className="mt-5 text-base">
        {streak.current > 0 && !streak.current_month_met && remaining !== null && remaining > 0 ? (
          <>
            Faltam <Money cents={remaining} /> para {name} contar e a sequência chegar a {plural(streak.current + 1, "mês", "meses")}.
          </>
        ) : (
          headline.text
        )}
      </p>

      {streak.months.length > 0 && (
        <div className="mt-6">
          <ol className="grid grid-cols-6 gap-x-2 gap-y-3 sm:grid-cols-12" aria-label="Últimos meses">
            {streak.months.map((m) => (
              <li
                key={m.month}
                aria-label={`${monthName(m.month)}: ${STATE_LABEL[m.state]}`}
                className="flex flex-col items-center gap-1 text-center"
              >
                <Dot state={m.state} />
                <span aria-hidden className="text-xs text-ink-2">
                  {formatMonth(m.month).slice(0, 3)}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
            <span className="inline-flex items-center gap-2">
              <Dot state="met" /> cumprido
            </span>
            <span className="inline-flex items-center gap-2">
              <Dot state="open" /> em andamento
            </span>
            <span className="inline-flex items-center gap-2">
              <Dot state="missed" /> sem aporte
            </span>
          </p>
        </div>
      )}

      <p className="mt-4 text-sm text-ink-2">
        Recorde: {plural(streak.best, "mês", "meses")}.
      </p>
      <details className="mt-2 text-sm text-ink-2">
        <summary className="inline-flex min-h-10 cursor-pointer items-center font-medium text-ink underline underline-offset-2">
          Como a sequência conta
        </summary>
        <p className="mt-1">
          Um mês conta quando o aporte está definido e todo o planejado foi lançado nos ativos (em meses antigos, sem plano gravado,
          vale o fechamento). Perder um mês zera a sequência; o recorde fica guardado.
        </p>
      </details>
    </section>
  );
}
