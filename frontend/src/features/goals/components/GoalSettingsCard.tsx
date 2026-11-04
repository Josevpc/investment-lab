import { useState, type FormEvent } from "react";
import { bpsToInput, centsToInput, parseMoneyToCents, parsePercentToBps } from "@/shared/lib/format";
import { Button, Card, ErrorBox, Field, inputClass, Notice } from "@/shared/ui";
import { useSaveGoalSettings } from "../hooks";
import type { GoalSettings } from "../types";

function moneyOrEmpty(cents: number): string {
  return cents > 0 ? centsToInput(cents) : "";
}

/** Metas e premissas da projeção. Campos de meta vazios significam "sem meta". */
export function GoalSettingsCard({ settings }: { settings: GoalSettings }) {
  const save = useSaveGoalSettings();
  const [saved, setSaved] = useState(false);
  const [netWorth, setNetWorth] = useState(moneyOrEmpty(settings.net_worth_goal_cents));
  const [yearGoal, setYearGoal] = useState(moneyOrEmpty(settings.year_goal_cents));
  const [monthly, setMonthly] = useState(moneyOrEmpty(settings.monthly_cents));
  // A meta de aporte também muda pela sugestão do "ritmo de aportes": o campo acompanha o valor salvo.
  const [savedMonthly, setSavedMonthly] = useState(settings.monthly_cents);
  if (settings.monthly_cents !== savedMonthly) {
    setSavedMonthly(settings.monthly_cents);
    setMonthly(moneyOrEmpty(settings.monthly_cents));
  }
  const [horizon, setHorizon] = useState(String(settings.horizon_years));
  const [inflation, setInflation] = useState(bpsToInput(settings.inflation_bps));
  const [conservative, setConservative] = useState(bpsToInput(settings.conservative_bps));
  const [base, setBase] = useState(bpsToInput(settings.base_bps));
  const [optimistic, setOptimistic] = useState(bpsToInput(settings.optimistic_bps));

  const money = (text: string) => (text.trim() === "" ? 0 : parseMoneyToCents(text));
  const parsed = {
    netWorth: money(netWorth),
    yearGoal: money(yearGoal),
    monthly: money(monthly),
    inflation: parsePercentToBps(inflation),
    conservative: parsePercentToBps(conservative),
    base: parsePercentToBps(base),
    optimistic: parsePercentToBps(optimistic),
  };
  const years = Number(horizon);
  const yearsValid = Number.isInteger(years) && years >= 1 && years <= 50;
  const inRange = (bps: number | null, max: number) => bps !== null && bps >= 0 && bps <= max;
  const ordered =
    parsed.conservative !== null &&
    parsed.base !== null &&
    parsed.optimistic !== null &&
    parsed.conservative <= parsed.base &&
    parsed.base <= parsed.optimistic;
  const valid =
    parsed.netWorth !== null &&
    parsed.yearGoal !== null &&
    parsed.monthly !== null &&
    yearsValid &&
    inRange(parsed.inflation, 3_000) &&
    inRange(parsed.conservative, 5_000) &&
    inRange(parsed.base, 5_000) &&
    inRange(parsed.optimistic, 5_000) &&
    ordered;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setSaved(false);
    save.mutate(
      {
        net_worth_goal_cents: parsed.netWorth ?? 0,
        year_goal_cents: parsed.yearGoal ?? 0,
        monthly_cents: parsed.monthly ?? 0,
        horizon_years: years,
        inflation_bps: parsed.inflation ?? 0,
        conservative_bps: parsed.conservative ?? 0,
        base_bps: parsed.base ?? 0,
        optimistic_bps: parsed.optimistic ?? 0,
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  const bad = (text: string, bps: number | null, max: number) =>
    text.trim() !== "" && !inRange(bps, max) ? `Use de 0 a ${max / 100}.` : null;

  return (
    <div id="definir-metas" className="scroll-mt-24">
      <Card title="Definir metas">
        <form onSubmit={submit} className="space-y-5">
          <fieldset className="space-y-3">
            <legend className="text-base font-medium text-ink">Metas</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Meta de patrimônio total (R$)"
                error={parsed.netWorth === null ? "Valor inválido." : null}
                hint="Deixe em branco para não ter meta."
              >
                <input id="meta-patrimonio" inputMode="decimal" className={`${inputClass} tabular`} value={netWorth} onChange={(e) => setNetWorth(e.target.value)} placeholder="Ex.: 1.000.000,00" />
              </Field>
              <Field
                label="Meta de acúmulo no ano (R$)"
                error={parsed.yearGoal === null ? "Valor inválido." : null}
                hint="Quanto o patrimônio deve crescer neste ano, entre aportes e valorização."
              >
                <input inputMode="decimal" className={`${inputClass} tabular`} value={yearGoal} onChange={(e) => setYearGoal(e.target.value)} placeholder="Ex.: 60.000,00" />
              </Field>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-base font-medium text-ink">Projeção do futuro</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Meta de aporte mensal (R$)"
                error={parsed.monthly === null ? "Valor inválido." : null}
                hint="A projeção usa este valor. Em branco: média dos últimos aportes."
              >
                <input inputMode="decimal" className={`${inputClass} tabular`} value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="Automático" />
              </Field>
              <Field label="Horizonte (anos)" error={yearsValid ? null : "Use de 1 a 50."}>
                <input inputMode="numeric" className={inputClass} value={horizon} onChange={(e) => setHorizon(e.target.value)} />
              </Field>
              <Field label="Inflação (% ao ano)" error={bad(inflation, parsed.inflation, 3_000)} hint="Usada para mostrar em valores de hoje.">
                <input inputMode="decimal" className={`${inputClass} tabular`} value={inflation} onChange={(e) => setInflation(e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Retorno conservador (% ao ano)" error={bad(conservative, parsed.conservative, 5_000)}>
                <input inputMode="decimal" className={`${inputClass} tabular`} value={conservative} onChange={(e) => setConservative(e.target.value)} />
              </Field>
              <Field label="Retorno base (% ao ano)" error={bad(base, parsed.base, 5_000)}>
                <input inputMode="decimal" className={`${inputClass} tabular`} value={base} onChange={(e) => setBase(e.target.value)} />
              </Field>
              <Field label="Retorno otimista (% ao ano)" error={bad(optimistic, parsed.optimistic, 5_000)}>
                <input inputMode="decimal" className={`${inputClass} tabular`} value={optimistic} onChange={(e) => setOptimistic(e.target.value)} />
              </Field>
            </div>
            {!ordered && parsed.conservative !== null && parsed.base !== null && parsed.optimistic !== null && (
              <p className="text-sm text-clay">Os retornos devem ir do conservador ao otimista, em ordem crescente.</p>
            )}
            <p className="text-sm text-ink-3">
              Retornos nominais, antes da inflação. Os valores iniciais (6%, 9% e 12%) são só um ponto de partida: ajuste ao que você espera
              da sua carteira.
            </p>
          </fieldset>

          <ErrorBox error={save.error} />
          {saved && (
            <Notice tone="success" role="status">
              Metas salvas. O progresso e a projeção acima já usam os novos valores.
            </Notice>
          )}
          <div className="space-y-2">
            <Button type="submit" disabled={!valid || save.isPending} aria-describedby={valid ? undefined : "metas-blocked-reason"}>
              Salvar metas
            </Button>
            {!valid && (
              <p id="metas-blocked-reason" className="text-sm text-ink-2">
                Corrija os campos marcados para salvar.
              </p>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}
