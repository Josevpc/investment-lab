import { Link } from "react-router-dom";
import { useGoalsProgress } from "@/features/goals";
import { formatMonth } from "@/shared/lib/format";
import { Card, cx, ErrorBox, Loading } from "@/shared/ui";
import { streakDots, streakSummary } from "../lib/streak";

/** Broto parado, em jade: acompanha a sequência sem animação. */
function Sprout() {
  return (
    <svg aria-hidden viewBox="0 0 64 64" className="size-16 shrink-0 text-jade" fill="none">
      <ellipse cx="32" cy="55" rx="16" ry="4" className="fill-raise" />
      <path d="M32 54V30" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M32 35C21 35 14 28 13 17c11 0 18 6 19 18Z" className="fill-jade-t" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M32 29c0-9 5-14 16-16 0 9-5 16-16 16Z" className="fill-jade-t" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
    </svg>
  );
}

const linkClass = "inline-flex min-h-10 items-center font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink";

/** Sequência de meses com o aporte cumprido: o número, os últimos 12 meses em pontos e a legenda escrita. */
export function StreakSummary() {
  const progress = useGoalsProgress();
  const streak = progress.data?.streak;
  const dots = streak ? streakDots(streak.months) : [];

  return (
    <Card title="Sequência">
      {progress.isLoading && <Loading />}
      <ErrorBox error={progress.error} />
      {streak && (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <Sprout />
            <div className="min-w-0">
              {streak.current === 0 ? (
                <p className="font-serif text-3xl leading-tight">Comece sua sequência</p>
              ) : (
                <p className="font-serif text-4xl leading-none sm:text-5xl">
                  <span className="tabular">{streak.current}</span> {streak.current === 1 ? "mês seguido" : "meses seguidos"}
                </p>
              )}
              <p className="mt-2 text-base text-ink-2">
                {streak.current === 0
                  ? "Lance todo o aporte planejado do mês para acender o primeiro ponto."
                  : streak.current_month_met
                    ? `${formatMonth(progress.data!.month)} cumprido.`
                    : `Falta cumprir ${formatMonth(progress.data!.month)} para continuar.`}
                {streak.best > streak.current && ` Seu recorde é de ${streak.best} meses.`}
              </p>
            </div>
          </div>

          <ul aria-label={streakSummary(dots)} className="flex flex-wrap gap-2.5">
            {dots.map((dot) => (
              <li
                key={dot.month}
                aria-label={dot.label}
                title={dot.label}
                className={cx(
                  "size-5 rounded-full",
                  dot.state === "met" && "bg-jade",
                  dot.state === "open" && "bg-card ring-[3px] ring-inset ring-gold",
                  dot.state === "missed" && "bg-ink-3/30",
                )}
              />
            ))}
          </ul>
          <p className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-2">
            <span className="flex items-center gap-2">
              <span aria-hidden className="size-3.5 rounded-full bg-jade" /> Mês cumprido
            </span>
            <span className="flex items-center gap-2">
              <span aria-hidden className="size-3.5 rounded-full bg-card ring-[3px] ring-inset ring-gold" /> Mês em andamento
            </span>
            <span className="flex items-center gap-2">
              <span aria-hidden className="size-3.5 rounded-full bg-ink-3/30" /> Sem aporte
            </span>
          </p>
          <Link to="/metas" className={linkClass}>
            Ver metas e projeção
          </Link>
        </div>
      )}
    </Card>
  );
}
