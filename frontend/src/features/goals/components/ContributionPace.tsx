import { useEffect, useId, useRef, useState } from "react";
import { useSystemStatus } from "@/features/system";
import { formatMonth } from "@/shared/lib/format";
import { Button, ErrorBox, Money } from "@/shared/ui";
import { useSaveGoalSettings } from "../hooks";
import { hasAnyPace, PACE_DISMISSED_DEMO_KEY, PACE_DISMISSED_KEY, readDismissed, visibleSuggestion, writeDismissed } from "../lib/pace";
import { plural } from "../lib/goals";
import type { ContributionPace as Pace, GoalSettings } from "../types";

/**
 * Quanto a pessoa tem aportado de fato, nas médias de 3, 6 e 12 meses, e, se o ritmo passou da meta,
 * uma sugestão discreta de subir a meta. Nada muda sem clique.
 */
export function ContributionPace({ pace, settings }: { pace: Pace; settings: GoalSettings | undefined }) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const save = useSaveGoalSettings();
  const status = useSystemStatus();
  const key = status.data?.demo === true ? PACE_DISMISSED_DEMO_KEY : PACE_DISMISSED_KEY;
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [accepted, setAccepted] = useState<number | null>(null);

  // Espera saber se é demonstração, para ler a chave certa.
  useEffect(() => {
    if (!status.isLoading) setDismissed(readDismissed(key));
  }, [key, status.isLoading]);

  useEffect(() => {
    if (accepted !== null) doneRef.current?.focus();
  }, [accepted]);

  const suggestion = status.isLoading || accepted !== null ? null : visibleSuggestion(pace, dismissed);
  const windows = [...pace.windows].sort((a, b) => a.months - b.months);

  function accept(cents: number) {
    if (!settings) return;
    save.mutate({ ...settings, monthly_cents: cents }, { onSuccess: () => setAccepted(cents) });
  }

  function notNow(cents: number) {
    writeDismissed(key, cents);
    setDismissed(cents);
    headingRef.current?.focus();
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div>
        <h3 id={headingId} ref={headingRef} tabIndex={-1} className="text-base font-medium focus:outline-none">
          Seu ritmo de aportes
        </h3>
        <p className="text-sm text-ink-3">
          Média por mês com aporte, em meses completos até {formatMonth(pace.reference_month)} (o mês atual fica de fora).
        </p>
      </div>

      {hasAnyPace(pace) ? (
        <dl className="grid gap-2 sm:grid-cols-3 sm:gap-3">
          {windows.map((w) => (
            // No celular, uma linha por janela: em três colunas de 360 px o valor quebrava no meio.
            <div
              key={w.months}
              className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 rounded-field bg-raise px-4 py-3 sm:block"
            >
              <dt className="text-sm text-ink-3">Últimos {w.months} meses</dt>
              <dd className="tabular whitespace-nowrap font-serif text-lg sm:mt-0.5 sm:text-xl">
                {w.average_cents === null ? "—" : <Money cents={w.average_cents} />}
                {w.average_cents !== null && <span className="font-sans text-sm text-ink-3"> /mês</span>}
              </dd>
              <dd className="w-full text-sm text-ink-3">
                ({plural(w.months_with_data, "mês com aporte", "meses com aporte")})
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-base text-ink-2">Ainda sem meses completos com aporte.</p>
      )}

      <p className="text-sm text-ink-2">
        {pace.goal_cents > 0 ? (
          <>
            Meta de aporte mensal: <Money cents={pace.goal_cents} />.
          </>
        ) : (
          "Meta de aporte mensal: automática (a projeção usa a média dos últimos aportes)."
        )}
      </p>

      {suggestion && settings && (
        <div className="rounded-field bg-gold-t p-4 text-base">
          <p>
            Você tem aportado em média <Money cents={suggestion.average_cents} />, acima da meta de <Money cents={pace.goal_cents} />.
          </p>
          <p className="mt-0.5 text-sm text-ink-2">
            Média dos últimos {suggestion.window_months} meses. Com a meta no seu ritmo, a projeção fica mais perto do que você faz.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={save.isPending} onClick={() => accept(suggestion.suggested_cents)}>
              {/* Num span só: o gap do botão separaria o texto do valor. */}
              <span>
                Aumentar meta para <Money cents={suggestion.suggested_cents} />
              </span>
            </Button>
            <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => notNow(suggestion.suggested_cents)}>
              Agora não
            </Button>
          </div>
          {save.error && (
            <div className="mt-2">
              <ErrorBox error={save.error} />
            </div>
          )}
        </div>
      )}

      {accepted !== null && (
        <p
          ref={doneRef}
          tabIndex={-1}
          role="status"
          className="rounded-field bg-jade-t px-4 py-3 text-sm text-ink focus:outline-none"
        >
          Meta de aporte mensal agora é <Money cents={accepted} />. A projeção já usa o novo valor.
        </p>
      )}
    </section>
  );
}
