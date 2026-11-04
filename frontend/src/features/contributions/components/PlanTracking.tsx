import { joinNames, useComparison, useSplit, type HoldStatus } from "@/features/allocation";
import { formatPercent, monthName } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { Badge, ButtonLink, Card, cx, Money, Swatch } from "@/shared/ui";
import { MoneyText } from "@/shared/ui/MoneyText";
import { PebbleBar } from "@/shared/ui/PebbleBar";
import { planProgress, type PlanRow } from "../lib/planProgress";
import type { Contribution } from "../types";

interface Props {
  contribution: Contribution;
  executed: { byClass: { class_key: string; amount_cents: number }[]; reserveCents: number };
  /** "R$ A em aportes + R$ B em ativos novos (...)", quando houve ativo novo no mês. */
  investedDetail?: MoneyTextPart[] | null;
}

/** Situação da linha em partes, para os valores saírem em <Money> (respeita "ocultar valores"). */
function status(row: PlanRow): MoneyTextPart[] {
  if (row.plannedCents === 0 && row.doneCents === 0) return ["sem aporte previsto"];
  if (row.overCents > 0) return ["acima do plano em ", { cents: row.overCents }];
  if (row.remainingCents === 0) return ["concluído"];
  return ["faltam ", { cents: row.remainingCents }];
}

/** Sugere onde colocar o dinheiro que passou do planejado, pela carteira de hoje. Não altera o plano. */
function ExtraSplit({ extraCents, mode }: { extraCents: number; mode: "rebalance" | "proportional" }) {
  const split = useSplit(extraCents, mode);
  const items = (split.data?.items ?? []).filter((item) => item.amount_cents > 0);
  if (items.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className="text-base font-medium">
        Onde colocar o extra de <Money cents={extraCents} />
      </h3>
      <p className="mt-0.5 text-sm text-ink-3">
        Sugestão pela carteira de hoje ({mode === "rebalance" ? "priorizando o que está abaixo da meta" : "na proporção das metas"}). Não
        muda o plano gravado.
      </p>
      <ul className="mt-3 space-y-1.5">
        {items.map((item) => (
          <li key={item.class_key} className="flex items-center justify-between gap-3 rounded-field bg-raise px-4 py-3 text-sm">
            <span className="flex items-center gap-2">
              <Swatch color={item.color} />
              {item.class_name}
            </span>
            <span className="tabular font-medium">
              <Money cents={item.amount_cents} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Plano gravado do mês contra o que já foi aportado: o total na faixa de cima e, abaixo, categoria por categoria. */
export function PlanTracking({ contribution, executed, investedDetail }: Props) {
  // O plano gravado no mês não diz quais ativos estavam mantidos; a comparação diz como está hoje.
  const comparison = useComparison();
  const comparisonItems = comparison.data?.items ?? [];
  const holdStatus: Record<string, HoldStatus> = Object.fromEntries(comparisonItems.map((i) => [i.class_key, i.hold_status]));
  const heldAssetsOf = (key: string) => comparisonItems.find((i) => i.class_key === key)?.held_assets ?? [];
  const progress = planProgress(contribution, executed, holdStatus);
  // Sem a situação dos mantidos (carregando ou com erro), planejado e falta podem incluir categoria que
  // não vai receber: em vez de um valor possivelmente errado, mostra "—" e diz por quê.
  const amountUnknown = comparison.isLoading || comparison.isError;
  const activeRows = progress.rows.filter((row) => !row.held);
  const heldRows = progress.rows.filter((row) => row.held);
  // Extra: o total aportado que passou do planejado (aporte a mais do que o previsto no mês).
  const extraCents = amountUnknown ? 0 : Math.max(0, progress.doneCents - progress.plannedCents);
  const name = monthName(contribution.month);
  const totalBps =
    progress.plannedCents > 0 ? Math.min(10_000, Math.round((progress.doneCents * 10_000) / progress.plannedCents)) : null;

  return (
    <Card
      title={`Plano de ${name}`}
      action={
        <ButtonLink to="/carteira/movimentacoes?novo=aporte" variant="secondary" size="sm">
          Registrar aportes
        </ButtonLink>
      }
    >
      <dl className="flex flex-wrap items-start gap-x-10 gap-y-5">
        <div>
          <dt className="text-sm text-ink-3">Planejado</dt>
          <dd className="mt-1 font-serif text-2xl">{amountUnknown ? "—" : <Money cents={progress.plannedCents} />}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-3">Investido no mês</dt>
          <dd className="mt-1 font-serif text-2xl">
            <Money cents={progress.doneCents} />
          </dd>
          {investedDetail && (
            <dd className="mt-0.5 max-w-xs text-sm text-ink-3">
              <MoneyText parts={investedDetail} />
            </dd>
          )}
        </div>
        {extraCents > 0 && (
          <div>
            <dt className="text-sm text-ink-3">Extra do mês</dt>
            <dd className="mt-1 font-serif text-2xl text-jade">
              + <Money cents={extraCents} />
            </dd>
          </div>
        )}
        <div className="max-sm:w-full sm:ml-auto sm:text-right">
          <dt className="text-sm text-ink-3">{progress.complete && !amountUnknown ? "Situação" : "Ainda falta aportar"}</dt>
          <dd className={cx("tabular mt-1 font-serif text-4xl leading-none sm:text-display", progress.complete && !amountUnknown && "text-jade")}>
            {amountUnknown ? "—" : progress.complete ? "Plano cumprido" : <Money cents={progress.remainingCents} />}
          </dd>
          {amountUnknown && (
            <dd className="mt-1 text-sm text-ink-3">
              {comparison.isError ? "Não foi possível conferir as categorias mantidas." : "Conferindo categorias mantidas…"}
            </dd>
          )}
        </div>
      </dl>

      {totalBps !== null && !amountUnknown && (
        <div className="mt-5">
          <PebbleBar
            role="img"
            valueBps={totalBps}
            color="var(--jade)"
            label={`Plano de ${name}: ${formatPercent(totalBps)} do planejado já foi aportado`}
          />
          <p className="mt-1.5 text-sm text-ink-3">
            <span className="tabular">{formatPercent(totalBps)}</span> do planejado já foi aportado.
          </p>
        </div>
      )}

      <p className="mt-5 text-sm text-ink-3">
        Divisão gravada ao salvar o aporte
        {contribution.plan_name ? ` (plano “${contribution.plan_name}”, ` : " ("}
        {contribution.mode === "proportional" ? "modo proporcional" : "modo rebalancear"}). O “investido no mês” soma os aportes que
        você lança na Carteira e os investimentos novos cadastrados no mês.
      </p>

      <ul className="mt-4 space-y-1.5">
        {activeRows.map((row) => (
          <li
            key={row.key}
            // No celular: nome e valores na primeira linha, barra embaixo na largura toda (três colunas espremiam o texto).
            className={cx(
              "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-field bg-raise px-4 py-3 text-sm sm:grid-cols-[minmax(7rem,11rem)_1fr_minmax(8rem,auto)]",
              row.plannedCents === 0 && row.doneCents === 0 && "opacity-70",
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <Swatch color={row.color} />
              {row.name}
            </span>
            <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
              <PebbleBar
                role="progressbar"
                track="var(--card)"
                valueBps={row.progressBps ?? 0}
                color={row.color}
                label={row.progressBps === null ? `${row.name}: nada planejado` : `${row.name}: ${formatPercent(row.progressBps)} do planejado já foi aportado`}
              />
              <p className="mt-1.5 text-sm text-ink-3">
                {row.progressBps === null ? "" : `${formatPercent(row.progressBps)} · `}
                <MoneyText parts={status(row)} />
              </p>
              {holdStatus[row.key] === "partial" && heldAssetsOf(row.key).length > 0 && (
                <p className="text-sm text-ink-3">
                  {joinNames(heldAssetsOf(row.key).map((a) => a.name))} {heldAssetsOf(row.key).length === 1 ? "mantido" : "mantidos"}: o
                  aporte vai para os outros ativos da categoria.
                </p>
              )}
            </div>
            <span className="tabular col-start-2 row-start-1 text-right sm:col-start-3">
              <Money cents={row.doneCents} />
              <span className="block text-ink-3 sm:inline">
                {" "}
                de <Money cents={row.plannedCents} />
              </span>
            </span>
          </li>
        ))}
      </ul>

      {heldRows.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-ink-3">Mantidas, sem novos aportes</h3>
          <ul className="mt-2 space-y-1.5">
            {heldRows.map((row) => (
              <li
                key={row.key}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-field bg-raise px-4 py-3 text-sm"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Swatch color={row.color} />
                  {row.name}
                  <Badge>Toda mantida</Badge>
                </span>
                <span className="text-sm text-ink-3">
                  {row.plannedCents > 0 && (
                    <>
                      previsto <Money cents={row.plannedCents} /> no plano; não será aportado enquanto estiver mantida
                    </>
                  )}
                  {row.plannedCents > 0 && row.doneCents > 0 && " · "}
                  {row.doneCents > 0 && (
                    <>
                      você aportou <Money cents={row.doneCents} /> mesmo assim
                    </>
                  )}
                  {row.plannedCents === 0 && row.doneCents === 0 && "sem aporte; o que já está investido continua na carteira"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {extraCents > 0 && <ExtraSplit extraCents={extraCents} mode={contribution.mode ?? "rebalance"} />}
    </Card>
  );
}
