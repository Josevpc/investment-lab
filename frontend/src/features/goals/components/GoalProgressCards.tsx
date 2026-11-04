import { Link } from "react-router-dom";
import { joinNames } from "@/features/allocation";
import { estimatedContributionsText, isEstimated } from "@/shared/lib/estimate";
import { formatDate, formatPercent } from "@/shared/lib/format";
import { Card, Money, NewAssetsNote, Notice } from "@/shared/ui";
import { GoalBar } from "@/shared/ui/GoalBar";
import { milestoneStatus, monthsLeftInYear } from "../lib/progress";
import { plural } from "../lib/goals";
import type { NetWorthProgress, YearProgress } from "../types";

const SETTINGS_HREF = "#definir-metas";
const linkClass = "font-medium text-ink underline underline-offset-2";

function DefineGoal({ what }: { what: string }) {
  return (
    <p className="text-base text-ink-2">
      Defina {what} para acompanhar o quanto falta.{" "}
      <a href={SETTINGS_HREF} className={`${linkClass} inline-flex min-h-10 items-center`}>
        Definir meta
      </a>
    </p>
  );
}

/** O valor de hoje em destaque, com a meta ao lado ("de R$ ..."). */
function BigValue({ cents, goalCents }: { cents: number; goalCents: number }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="tabular break-words font-serif text-3xl sm:text-title">
        <Money cents={cents} />
      </span>
      {goalCents > 0 && (
        <span className="text-base text-ink-2">
          de <Money cents={goalCents} />
        </span>
      )}
    </p>
  );
}

/** "Marcos de 25% e 50% já alcançados." / "Nenhum marco alcançado ainda." */
function reachedText(reached: number[]): string {
  if (reached.length === 0) return "Nenhum marco alcançado ainda.";
  return `${reached.length === 1 ? "Marco de" : "Marcos de"} ${joinNames(reached.map((m) => `${m}%`))} ${reached.length === 1 ? "já alcançado" : "já alcançados"}.`;
}

/** Patrimônio total contra a meta de patrimônio. */
export function NetWorthGoalCard({ net }: { net: NetWorthProgress }) {
  const marks = milestoneStatus(net.progress_bps, net.current_cents, net.goal_cents);
  return (
    <Card title="Meta de patrimônio">
      <BigValue cents={net.current_cents} goalCents={net.goal_cents} />
      {net.goal_cents > 0 ? (
        <div className="mt-5 space-y-3">
          <GoalBar bps={net.progress_bps} label="Progresso da meta de patrimônio" markers />
          <p className="text-base text-ink-2">
            <span className="tabular">{formatPercent(net.progress_bps)}</span> da meta. {reachedText(marks.reached)}{" "}
            {net.reached ? (
              "Meta atingida. Que tal definir a próxima?"
            ) : (
              marks.next && (
                <>
                  Faltam <Money cents={marks.next.remainingCents} /> para os {marks.next.percent}%.
                </>
              )
            )}
          </p>
        </div>
      ) : (
        <div className="mt-3">
          <DefineGoal what="uma meta de patrimônio" />
        </div>
      )}
    </Card>
  );
}

/**
 * Quanto o patrimônio cresceu no ano, separando o que veio de aportes e de valorização. O total é o
 * acumulado (aportes + valorização), por isso o cartão não se chama só "aportes do ano".
 */
export function YearGoalCard({ year, month }: { year: YearProgress; month?: string }) {
  // Sem aporte lançado em algum mês, o back-end usa o planejado: a divisão aporte/valorização vira estimativa.
  const estimated = isEstimated(year);
  const archivedOut = year.archived_out_cents ?? 0;
  const marks = milestoneStatus(year.progress_bps, year.accumulated_cents, year.goal_cents);
  // "em N meses" só vale se o mês em foco é do ano da meta.
  const monthsLeft = month && month.startsWith(`${year.year}-`) ? monthsLeftInYear(month) : null;
  return (
    <Card title={`Acumulado em ${year.year}`}>
      {year.status === "sem_base" ? (
        <p className="text-base text-ink-2">
          Ainda faltam saldos em duas datas para medir o ano: é preciso um saldo atualizado de {year.year - 1} (ou duas datas deste ano)
          para comparar.{" "}
          <Link to="/carteira/atualizar" className={`${linkClass} inline-flex min-h-10 items-center`}>
            Atualizar saldos
          </Link>
        </p>
      ) : (
        <>
          <BigValue cents={year.accumulated_cents} goalCents={year.goal_cents} />
          <p className="mt-1 text-sm text-ink-3">
            Aportes e valorização, dos saldos de {formatDate(year.baseline_date ?? "")} aos de {formatDate(year.last_date ?? "")}.
          </p>
          {year.goal_cents > 0 ? (
            <div className="mt-5 space-y-3">
              <GoalBar bps={year.progress_bps} label={`Progresso da meta de ${year.year}`} markers />
              <p className="text-base text-ink-2">
                <span className="tabular">{formatPercent(year.progress_bps)}</span> da meta do ano. {reachedText(marks.reached)}{" "}
                {year.reached ? (
                  "Meta do ano atingida."
                ) : (
                  <>
                    Faltam <Money cents={year.remaining_cents} />
                    {monthsLeft !== null ? ` em ${plural(monthsLeft, "mês", "meses")}` : ""}.
                  </>
                )}
              </p>
            </div>
          ) : (
            <div className="mt-3">
              <DefineGoal what="uma meta de acúmulo para o ano" />
            </div>
          )}
          <dl className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(min(9rem,100%),1fr))] gap-x-6 gap-y-4 text-sm">
            <div>
              <dt className="text-ink-3">Veio de aportes</dt>
              <dd className="tabular mt-0.5 text-base font-semibold">
                <Money cents={year.contributions_cents} />
              </dd>
            </div>
            {year.withdrawals_cents > 0 && (
              <div>
                <dt className="text-ink-3">Resgates</dt>
                <dd className="tabular mt-0.5 text-base font-semibold">
                  − <Money cents={year.withdrawals_cents} />
                </dd>
              </div>
            )}
            {archivedOut > 0 && (
              <div>
                <dt className="text-ink-3">Ativos arquivados</dt>
                <dd className="tabular mt-0.5 text-base font-semibold">
                  − <Money cents={archivedOut} />
                </dd>
              </div>
            )}
            <div>
              <dt className="text-ink-3">{estimated ? "Veio de valorização (estimada)" : "Veio de valorização"}</dt>
              <dd className="tabular mt-0.5 text-base font-semibold">
                <Money cents={year.appreciation_cents} />
              </dd>
            </div>
          </dl>
          {year.withdrawals_cents > 0 && (
            <p className="mt-4 text-sm text-ink-2">
              <strong className="font-semibold">Resgates diminuem o acumulado.</strong> Você resgatou <Money cents={year.withdrawals_cents} />{" "}
              neste ano: o dinheiro saiu da carteira e, por isso, o acumulado fica menor. Não é perda de valorização, que continua
              contando só o rendimento.
            </p>
          )}
          {archivedOut > 0 && (
            <p className="mt-4 text-sm text-ink-2">
              <strong className="font-semibold">Ativos arquivados diminuem o acumulado.</strong> <Money cents={archivedOut} /> saíram da
              carteira ao serem arquivados, sem resgate registrado. Não é perda: a valorização soma esse valor de volta.
            </p>
          )}
          <NewAssetsNote cents={year.new_assets_cents ?? 0} className="mt-4 text-sm text-ink-2" />
          {estimated && (
            <div className="mt-4">
              <Notice>
                <strong className="font-semibold">Aportes estimados.</strong> {estimatedContributionsText(year)}
              </Notice>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
