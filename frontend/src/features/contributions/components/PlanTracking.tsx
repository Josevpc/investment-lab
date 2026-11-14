import { useId, useState } from "react";
import { isAllHeldSplitError, joinNames, useComparison, useSplit, type HoldStatus } from "@/features/allocation";
import { useDebounced } from "@/shared/hooks/useDebounced";
import { formatBRL, formatPercent, monthName, parseMoneyToCents } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { useHiddenValues } from "@/shared/lib/preferences";
import { Badge, ButtonLink, Card, cx, ErrorBox, inputClass, Money, Notice, Swatch } from "@/shared/ui";
import { MoneyText } from "@/shared/ui/MoneyText";
import { PebbleBar } from "@/shared/ui/PebbleBar";
import { SeparatedSwatch } from "@/shared/ui/SeparatedMark";
import { planProgress, type Executed, type PlanRow } from "../lib/planProgress";
import type { Contribution } from "../types";

interface Props {
  contribution: Contribution;
  executed: Executed;
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

/**
 * Com separado na categoria, "cumprido" vale comprado + separado (e diz por escrito, não só pela cor).
 * Sem separado a frase é a de sempre.
 */
function statusWithSeparated(row: PlanRow): MoneyTextPart[] {
  if (!row.fulfilled) return status(row);
  return row.overCents > 0 ? ["Cumprido, acima do plano em ", { cents: row.overCents }] : ["Cumprido"];
}

/** Leitura da barra para leitor de tela. Com "ocultar valores", só percentuais (o desfoque não alcança este texto). */
function separatedValueText(row: PlanRow, hidden: boolean): string {
  if (hidden) return `${formatPercent(row.progressBps ?? 0)} do planejado coberto, entre comprado e separado`;
  return `${formatBRL(row.boughtCents)} comprado e ${formatBRL(row.separatedCents)} separado, de ${formatBRL(row.plannedCents)} planejado`;
}

/**
 * Simulação de um aporte extra: a pessoa digita quanto pretende aportar a mais e vê onde colocar, pela carteira de
 * hoje (sem `month`, porque o dinheiro ainda não foi aportado). Só consulta: não muda o plano nem grava nada.
 */
function ExtraContribution({ mode, pendingCents }: { mode: "rebalance" | "proportional"; pendingCents: number }) {
  const [text, setText] = useState("");
  const parsed = parseMoneyToCents(text);
  const cents = parsed !== null && parsed > 0 ? parsed : null;
  const invalid = text.trim() !== "" && cents === null;
  // O debounce vale para o valor já interpretado: digitar "5", "50", "500" não dispara três consultas.
  const debounced = useDebounced(cents ?? 0, 300);
  const split = useSplit(debounced, mode, undefined, undefined, debounced > 0);
  const inputId = useId();
  const messageId = `${inputId}-msg`;

  // A sugestão só vale se for do valor que está no campo agora (a anterior fica de lado durante a digitação).
  const current = cents !== null && debounced === cents;
  const result = current && split.data?.amount_cents === cents && !split.error ? split.data : null;
  const items = (result?.items ?? []).filter((item) => item.amount_cents > 0);
  const sumCents = items.reduce((sum, item) => sum + item.amount_cents, 0);
  const failed = current && split.error ? split.error : null;
  const waiting = cents !== null && !result && !failed;

  return (
    <div className="mt-8 rounded-field bg-raise/60 p-4 sm:p-5">
      <h3 className="text-base font-medium">Aportar um valor extra</h3>
      <p className="mt-0.5 text-sm text-ink-3">
        Quer colocar mais dinheiro além do plano? Digite o valor e veja onde colocar, pela carteira de hoje (
        {mode === "rebalance" ? "priorizando o que está abaixo da meta" : "na proporção das metas"}). É só uma sugestão: não muda o
        plano nem grava nada.
      </p>

      <div className="mt-3 max-w-xs">
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink-2">
          Valor extra (R$)
        </label>
        <input
          id={inputId}
          inputMode="decimal"
          autoComplete="off"
          className={`${inputClass} tabular`}
          placeholder="500,00"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={invalid}
          aria-describedby={messageId}
        />
        <p id={messageId} className={cx("mt-1.5 text-sm", invalid ? "text-clay" : "text-ink-3")}>
          {invalid ? "Digite um valor como 500,00" : text.trim() === "" ? "Digite quanto quer aportar a mais para ver onde colocar" : ""}
        </p>
      </div>

      {pendingCents > 0 && (
        <p className="mt-3 text-sm text-ink-2">
          O plano ainda tem <Money cents={pendingCents} /> pendentes; a sugestão do extra parte da carteira de hoje.
        </p>
      )}

      <div aria-live="polite" className="mt-3">
        {waiting && <p className="text-sm text-ink-3">Calculando a sugestão…</p>}
        {failed &&
          (isAllHeldSplitError(failed) ? (
            <div role="alert" className="rounded-field bg-clay-t p-4 text-sm text-ink">
              <p className="font-medium">Não há onde colocar o extra: todos os ativos estão em &quot;Manter posição&quot;.</p>
              <p className="mt-1">
                Para receber aportes, abra um ativo na Carteira, clique em &quot;Editar cadastro&quot; e desligue &quot;Manter
                posição&quot;.
              </p>
            </div>
          ) : (
            <ErrorBox error={failed} />
          ))}
        {result && items.length > 0 && (
          <div>
            <p className="text-sm font-medium text-ink-2">
              Sugestão para <Money cents={result.amount_cents} />
            </p>
            <ul className="mt-2 space-y-1.5" aria-label="Sugestão de divisão do valor extra">
              {items.map((item) => (
                <li key={item.class_key} className="flex items-center justify-between gap-3 rounded-field bg-card px-4 py-3 text-sm">
                  <span className="flex items-center gap-2">
                    <Swatch color={item.color} />
                    {item.class_name}
                  </span>
                  <span className="tabular font-medium">
                    <Money cents={item.amount_cents} />
                  </span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 px-4 py-1 text-sm font-medium">
                <span>Total sugerido</span>
                <span className="tabular">
                  <Money cents={sumCents} />
                </span>
              </li>
            </ul>
            {sumCents === cents ? (
              <p className="mt-1 text-sm text-ink-3">A soma confere com o valor digitado.</p>
            ) : (
              <div className="mt-2">
                <Notice tone="warn" role="alert">
                  A soma das categorias (<Money cents={sumCents} />) não bate com o valor digitado (<Money cents={cents ?? 0} />). Confira
                  antes de aportar.
                </Notice>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4">
        <ButtonLink to="/carteira/movimentacoes?novo=aporte" variant="secondary" size="sm">
          Registrar aportes na Carteira
        </ButtonLink>
        <p className="mt-1.5 text-sm text-ink-3">Depois de aportar, lance o valor na Carteira para ele entrar neste plano.</p>
      </div>
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
  const hidden = useHiddenValues();
  // Sem a situação dos mantidos (carregando ou com erro), planejado e falta podem incluir categoria que
  // não vai receber: em vez de um valor possivelmente errado, mostra "—" e diz por quê.
  const amountUnknown = comparison.isLoading || comparison.isError;
  const activeRows = progress.rows.filter((row) => !row.held);
  const heldRows = progress.rows.filter((row) => row.held);
  // Extra: o total aportado que passou do planejado (aporte a mais do que o previsto no mês).
  const extraCents = amountUnknown ? 0 : Math.max(0, progress.doneCents - progress.plannedCents);
  const offGoalCents = executed.offGoalCents ?? 0;
  const name = monthName(contribution.month);
  const totalBps =
    progress.plannedCents > 0 ? Math.min(10_000, Math.round((progress.doneCents * 10_000) / progress.plannedCents)) : null;
  const separatedTotal = progress.separatedCents;
  // Barra do total: o comprado cheio e, ao lado, o separado hachurado (só quando há separado). Sobre o maior entre
  // planejado e feito, para o hachurado não sumir quando o total passa do plano.
  const barBase = Math.max(progress.plannedCents, progress.doneCents, 1);
  const totalSeparatedBps = separatedTotal > 0 ? Math.floor((separatedTotal * 10_000) / barBase) : 0;
  const totalBoughtBps = Math.floor(((progress.doneCents - separatedTotal) * 10_000) / barBase);

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
            {/* Com aportes fora da meta, o investido inclui a sobra marcada; o que conta no plano é só `doneCents`. */}
            <Money cents={progress.doneCents + offGoalCents} />
          </dd>
          {offGoalCents > 0 && (
            <dd className="mt-0.5 max-w-xs text-sm text-ink-3">
              Fora da meta: <Money cents={offGoalCents} /> (não conta no plano)
            </dd>
          )}
          {investedDetail && (
            <dd className="mt-0.5 max-w-xs text-sm text-ink-3">
              <MoneyText parts={investedDetail} />
            </dd>
          )}
          {separatedTotal > 0 && (
            <dd className="mt-0.5 max-w-xs text-sm text-ink-3">
              Inclui <Money cents={separatedTotal} /> separados (ainda não investidos)
            </dd>
          )}
        </div>
        {extraCents > 0 && (
          <div>
            <dt className="text-sm text-ink-3">Extra do mês</dt>
            <dd className="mt-1 font-serif text-2xl text-jade">
              + <Money cents={extraCents} />
            </dd>
            <dd className="mt-0.5 max-w-xs text-sm text-ink-3">já aportado além do planejado</dd>
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
            valueBps={separatedTotal > 0 ? totalBoughtBps : totalBps}
            separatedBps={totalSeparatedBps}
            color="var(--jade)"
            label={
              separatedTotal > 0
                ? `Plano de ${name}: ${formatPercent(totalBps)} do planejado está coberto, entre comprado e separado`
                : `Plano de ${name}: ${formatPercent(totalBps)} do planejado já foi aportado`
            }
          />
          <p className="mt-1.5 text-sm text-ink-3">
            <span className="tabular">{formatPercent(totalBps)}</span>{" "}
            {separatedTotal > 0 ? "do planejado está coberto (comprado e separado)." : "do planejado já foi aportado."}
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
                valueBps={row.separatedCents > 0 ? row.boughtBps : (row.progressBps ?? 0)}
                separatedBps={row.separatedBps}
                valueText={row.separatedCents > 0 ? separatedValueText(row, hidden) : undefined}
                color={row.color}
                label={
                  row.progressBps === null
                    ? `${row.name}: nada planejado`
                    : row.separatedCents > 0
                      ? `${row.name}: ${formatPercent(row.progressBps)} do planejado coberto`
                      : `${row.name}: ${formatPercent(row.progressBps)} do planejado já foi aportado`
                }
              />
              <p className="mt-1.5 text-sm text-ink-3">
                {row.progressBps === null ? "" : `${formatPercent(row.progressBps)} · `}
                <MoneyText parts={row.separatedCents > 0 ? statusWithSeparated(row) : status(row)} />
              </p>
              {row.separatedCents > 0 && (
                <p className="text-sm text-ink-3">
                  <Money cents={row.boughtCents} /> comprado + <SeparatedSwatch className="inline-block shrink-0 align-middle" />{" "}
                  <Money cents={row.separatedCents} /> separado de <Money cents={row.plannedCents} /> planejado
                </p>
              )}
              {row.fromReservedCents > 0 && (
                <p className="text-sm text-ink-3">
                  Compra de <Money cents={row.fromReservedCents} /> usando o separado (já contada no mês em que foi separado)
                </p>
              )}
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

      <ExtraContribution mode={contribution.mode ?? "rebalance"} pendingCents={amountUnknown ? 0 : progress.remainingCents} />
    </Card>
  );
}
