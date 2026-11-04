import { useState } from "react";
import { Link } from "react-router-dom";
import { bpsToInput, centsToInput, formatPercent, parseMoneyToCents, parsePercentToBps } from "@/shared/lib/format";
import { Button, Card, ErrorBox, Field, inputClass, Loading, Money, Segmented } from "@/shared/ui";
import { EnergyBar } from "@/shared/ui/EnergyBar";
import { useReserve, useSaveReserve } from "./hooks";
import type { MonthlyMode, Reserve } from "./types";

function Settings({ reserve, onClose }: { reserve: Reserve; onClose: () => void }) {
  const save = useSaveReserve();
  const [months, setMonths] = useState(String(reserve.months));
  const [goal, setGoal] = useState(reserve.goal_cents > 0 ? centsToInput(reserve.goal_cents) : "");
  const [monthly, setMonthly] = useState(reserve.monthly_cents > 0 ? centsToInput(reserve.monthly_cents) : "");
  const [mode, setMode] = useState<MonthlyMode>(reserve.monthly_mode);
  const [percent, setPercent] = useState(reserve.percent_bps > 0 ? bpsToInput(reserve.percent_bps) : "");

  const monthsNumber = Number(months);
  const monthsValid = Number.isInteger(monthsNumber) && monthsNumber >= 1 && monthsNumber <= 60;
  const goalCents = goal.trim() === "" ? 0 : parseMoneyToCents(goal);
  const monthlyCents = monthly.trim() === "" ? 0 : parseMoneyToCents(monthly);
  const percentBps = percent.trim() === "" ? 0 : parsePercentToBps(percent);
  const percentValid = percentBps !== null && percentBps <= 10_000;
  const valid = monthsValid && goalCents !== null && monthlyCents !== null && percentValid;

  // A sugestão acompanha o número de meses digitado, usando a média dos salários registrados.
  const suggestion =
    reserve.average_salary_cents !== null && monthsValid ? monthsNumber * reserve.average_salary_cents : null;

  return (
    <form
      className="space-y-4 rounded-field bg-raise p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        save.mutate(
          {
            goal_cents: goalCents ?? 0,
            months: monthsNumber,
            monthly_cents: monthlyCents ?? 0,
            monthly_mode: mode,
            percent_bps: percentBps ?? 0,
          },
          { onSuccess: onClose },
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Meses de salário" error={monthsValid ? null : "Use de 1 a 60."}>
          <input inputMode="numeric" className={inputClass} value={months} onChange={(e) => setMonths(e.target.value)} />
        </Field>
        <Field label="Meta da reserva (R$)" error={goalCents === null ? "Valor inválido." : null}>
          <input inputMode="decimal" className={`${inputClass} tabular`} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="0,00" />
        </Field>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink-2">Quanto do aporte vai para a reserva</span>
          <Segmented<MonthlyMode>
            label="Forma de definir a parte da reserva"
            size="md"
            value={mode}
            onChange={setMode}
            options={[
              { value: "percent", label: "% do aporte" },
              { value: "fixed", label: "Valor fixo" },
            ]}
          />
        </div>
      </div>
      {mode === "percent" ? (
        <Field
          label="Percentual do aporte do mês (%)"
          error={percentValid ? null : "Use de 0 a 100."}
          hint="Pré-preenche a tela de aporte com essa parte do valor do mês, limitada ao que falta para a meta."
          className="max-w-xs"
        >
          <input inputMode="decimal" className={`${inputClass} tabular`} value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="Ex.: 20" />
        </Field>
      ) : (
        <Field
          label="Valor mensal na reserva (R$)"
          error={monthlyCents === null ? "Valor inválido." : null}
          hint="Pré-preenche a tela de aporte do mês, limitado ao que falta para a meta."
          className="max-w-xs"
        >
          <input inputMode="decimal" className={`${inputClass} tabular`} value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="0,00" />
        </Field>
      )}

      {suggestion !== null && reserve.average_salary_cents !== null && (
        <p className="text-sm text-ink-2">
          Sugestão: {monthsNumber} × média de {reserve.salaries_considered}{" "}
          {reserve.salaries_considered === 1 ? "salário registrado" : "salários registrados"} (
          <Money cents={reserve.average_salary_cents} />) = <strong><Money cents={suggestion} /></strong>.{" "}
          <button
            type="button"
            className="inline-flex min-h-10 items-center font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink"
            onClick={() => setGoal(centsToInput(suggestion))}
          >
            Usar como meta
          </button>
        </p>
      )}
      {reserve.average_salary_cents === null && (
        <p className="text-sm text-ink-2">
          Registre seus salários na tela &quot;Aporte do mês&quot; para o app sugerir a meta pela média.
        </p>
      )}

      <ErrorBox error={save.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid || save.isPending}>
          Salvar meta
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** Progresso da reserva de emergência e configuração da meta. */
export function ReserveCard() {
  const reserve = useReserve();
  const [editing, setEditing] = useState(false);
  const r = reserve.data;

  return (
    <Card
      title="Reserva de emergência"
      action={
        r && !editing ? (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {r.goal_cents > 0 ? "Configurar meta" : "Definir meta"}
          </Button>
        ) : undefined
      }
    >
      {reserve.isLoading && <Loading />}
      <ErrorBox error={reserve.error} />

      {r && (
        <div className="space-y-4">
          {r.goal_cents > 0 ? (
            <>
              <div>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-serif text-3xl">
                    <Money cents={r.balance_cents} />{" "}
                    <span className="font-sans text-base text-ink-3">
                      de <Money cents={r.goal_cents} />
                    </span>
                  </p>
                  <p className="tabular text-sm font-medium">{formatPercent(r.progress_bps)}</p>
                </div>
                <EnergyBar bps={r.progress_bps} label="Progresso da reserva de emergência" />
              </div>
              <p className="text-sm text-ink-2">
                {r.reached ? (
                  "Reserva completa: energia total! "
                ) : (
                  <>
                    Faltam <Money cents={r.remaining_cents} />.{" "}
                  </>
                )}
                {r.coverage_months !== null && `Você tem ${String(r.coverage_months).replace(".", ",")} meses de salário guardados. `}
                {!r.reached && r.monthly_mode === "percent" && r.percent_bps > 0 && (
                  <>Cada aporte destina {formatPercent(r.percent_bps)} à reserva.</>
                )}
                {!r.reached && r.monthly_mode === "fixed" && r.monthly_cents > 0 && r.remaining_cents > 0 && (
                  <>No ritmo de <Money cents={r.monthly_cents} /> por mês, são {Math.ceil(r.remaining_cents / r.monthly_cents)} meses.</>
                )}
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-2">
              Defina a meta da sua reserva
              {r.suggested_goal_cents !== null && (
                <>
                  : {r.months} × a média dos seus salários dá <strong><Money cents={r.suggested_goal_cents} /></strong>
                </>
              )}
              .
            </p>
          )}

          {r.assets.length > 0 ? (
            <div>
              <ul className="space-y-1.5 text-sm">
                {r.assets.map((asset) => (
                  <li key={asset.id} className="flex flex-wrap items-center justify-between gap-x-3 rounded-field bg-raise px-4 py-1">
                    <span>
                      {asset.name} <span className="text-ink-3">· {asset.institution_name}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular font-medium">
                        <Money cents={asset.current_cents} />
                      </span>
                      {/* Leva ao formulário de resgate já com este ativo; o app não adivinha o valor. */}
                      <Link
                        to={`/carteira/movimentacoes?novo=resgate&ativo=${asset.id}`}
                        aria-label={`Usei a reserva: registrar resgate de ${asset.name}`}
                        className="inline-flex min-h-10 items-center px-1 font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink"
                      >
                        Usei a reserva
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-ink-3">
                Tirou dinheiro da reserva? Registre o resgate: o saldo e o investido caem na mesma proporção e nada aparece como prejuízo.
                Com a meta definida, o próximo aporte já sugere repor.
              </p>
            </div>
          ) : (
            <p className="rounded-field bg-raise px-4 py-3 text-sm text-ink-2">
              Nenhum ativo na reserva. Ao cadastrar ou editar um ativo, marque &quot;Faz parte da reserva de emergência&quot;.
              A reserva fica fora do rebalanceamento da carteira.
            </p>
          )}

          <p className="text-sm">
            <Link
              to="/carteira/retiradas"
              className="inline-flex min-h-10 items-center font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink"
            >
              Ver todas as retiradas
            </Link>
          </p>

          {editing && <Settings reserve={r} onClose={() => setEditing(false)} />}
        </div>
      )}
    </Card>
  );
}
