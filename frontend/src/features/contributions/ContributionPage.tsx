import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  adjustedTargetNote,
  allocateBps,
  Donut,
  isAllHeldSplitError,
  joinNames,
  PlansSection,
  useSplit,
  type SplitMode,
} from "@/features/allocation";
import { investedDetail, useMonthSummary } from "@/features/portfolio";
import { defaultReserveCents, useReserve } from "@/features/reserve";
import { useDebounced } from "@/shared/hooks/useDebounced";
import {
  bpsToInput,
  centsToInput,
  currentMonth,
  formatBRL,
  formatMonth,
  formatPercent,
  monthName,
  parseMoneyToCents,
  parsePercentToBps,
} from "@/shared/lib/format";
import { RESERVE_COLOR } from "@/shared/lib/chart";
import { scrollBehavior } from "@/shared/lib/motion";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  cx,
  Drawer,
  Empty,
  ErrorBox,
  Field,
  inputClass,
  Loading,
  MonthInput,
  Money,
  Notice,
  PageHeader,
  Segmented,
  Stat,
  Swatch,
} from "@/shared/ui";
import { useContributions, useSaveContribution } from "./hooks";
import { PlanTracking } from "./components/PlanTracking";
import { calculateContribution } from "./lib/calculate";
import { destinationText } from "./lib/destination";
import { executedFromSummary } from "./lib/planProgress";
import { parseReserveInput } from "./lib/reserve";

const DEFAULT_PERCENT_BPS = 750;
const PRESETS = [1000, 1500, 2000, 2500, 3000];

interface Edits {
  salary: string | null;
  percentBps: number | null;
  override: string | null; // null = sem ajuste manual
}

const NO_EDITS: Edits = { salary: null, percentBps: null, override: null };

/** Faixa da tabela: fundo `raise` com as pontas arredondadas, sem linhas. */
const cell = "bg-raise px-3 py-3 first:rounded-l-field last:rounded-r-field";

/**
 * Aporte do mês: a pessoa decide quanto investir (esquerda) e vê para onde cada real vai (direita).
 * Com o mês já salvo, o formulário vira um resumo e o plano do mês mostra o que falta aportar.
 */
export function ContributionPage() {
  const contributions = useContributions();
  const save = useSaveContribution();

  const [month, setMonth] = useState(currentMonth());
  const [edits, setEdits] = useState<Edits>(NO_EDITS);
  const [modeEdit, setModeEdit] = useState<SplitMode | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  // Com o aporte do mês salvo, o formulário some; "Alterar aporte" volta a abri-lo.
  const [editing, setEditing] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [reserveEdit, setReserveEdit] = useState<string | null>(null);
  const reserve = useReserve();
  const monthSummary = useMonthSummary(month);

  const history = contributions.data ?? [];
  const existing = history.find((c) => c.month === month);
  const latest = history[0];
  const showForm = existing === undefined || editing;
  const formRef = useRef<HTMLDivElement>(null);
  const salaryRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef<HTMLDivElement>(null);
  // Ao clicar em "Alterar aporte", leva a tela até o formulário (o plano do mês fica acima dele) e o foco ao Salário:
  // o botão clicado sai da tela e, sem isso, o foco cairia no <body>.
  useEffect(() => {
    if (!editing) return;
    formRef.current?.scrollIntoView?.({ behavior: scrollBehavior(), block: "start" });
    salaryRef.current?.focus({ preventScroll: true });
  }, [editing]);
  // Depois de salvar, o formulário (e o botão focado) sai da tela: o foco vai para o aviso, que o leitor de tela lê.
  const savedVisible = justSaved && existing !== undefined && !showForm;
  useEffect(() => {
    if (savedVisible) savedRef.current?.focus();
  }, [savedVisible]);

  // Valores iniciais: o mês já registrado ou, na falta dele, o último aporte (Q2 do PRD).
  const mode: SplitMode = modeEdit ?? existing?.mode ?? "rebalance";
  const setMode = setModeEdit;
  const base = existing ?? latest;
  // O salário quase nunca muda de um mês para o outro: o campo já vem com o do mês anterior.
  const salaryPrefilled = !existing && latest !== undefined && edits.salary === null;
  const salaryText =
    edits.salary ?? (existing ? centsToInput(existing.salary_cents) : latest ? centsToInput(latest.salary_cents) : "");
  const percentBps = edits.percentBps ?? base?.percent_bps ?? DEFAULT_PERCENT_BPS;
  const overrideText = edits.override ?? (existing?.overridden ? centsToInput(existing.final_cents) : null);

  const salaryCents = parseMoneyToCents(salaryText);
  const calculated = calculateContribution(salaryCents ?? 0, percentBps);
  const overrideCents = overrideText === null ? null : parseMoneyToCents(overrideText);
  const finalCents = overrideText === null ? calculated : (overrideCents ?? 0);

  // Parte do aporte que vai para a reserva de emergência; o restante segue o plano de alocação.
  const r = reserve.data;
  const reserveDefault = r ? defaultReserveCents(r, finalCents) : 0;
  // No mês já salvo, a reserva volta como foi gravada (o padrão só vale para um mês novo).
  const reserveInitial = existing ? existing.reserve_cents : reserveDefault;
  const reserveText = reserveEdit ?? (reserveInitial > 0 ? centsToInput(reserveInitial) : "");
  const reserveParsed = parseReserveInput(reserveText, finalCents);
  // A reserva recebe no máximo o que falta para a meta (se houver meta) e no máximo o aporte inteiro.
  // O que já foi para a reserva neste mês volta ao limite: ele já estava na meta quando foi gravado. Só a parte que
  // conta na meta do mês (`reserve_goal_cents`): a sobra marcada como fora da meta não é do plano e não volta ao limite.
  const reserveCap =
    r && r.goal_cents > 0 ? r.remaining_cents + (monthSummary.data?.reserve_goal_cents ?? 0) : Number.POSITIVE_INFINITY;
  const reserveCents = Math.min(reserveParsed ?? 0, finalCents, reserveCap);
  // Se o digitado passa do limite, a tela não corta em silêncio: o aviso diz a que valor foi limitado e por quê.
  const reserveLimitedBy =
    reserveParsed !== null && reserveParsed > reserveCents ? (reserveCap < finalCents ? "goal" : "contribution") : null;
  const investCents = finalCents - reserveCents;

  const planChanged =
    existing !== undefined &&
    (finalCents !== existing.final_cents || reserveCents !== existing.reserve_cents || mode !== (existing.mode ?? "rebalance"));

  const debouncedAmount = useDebounced(investCents);
  const split = useSplit(debouncedAmount, mode, undefined, month);

  const update = (patch: Partial<Edits>) => {
    setJustSaved(false);
    setEdits((current) => ({ ...current, ...patch }));
  };

  const changeMonth = (next: string) => {
    if (!next) return;
    setMonth(next);
    setEdits(NO_EDITS);
    setReserveEdit(null);
    setModeEdit(null);
    setEditing(false);
    setJustSaved(false);
  };

  const cancelEditing = () => {
    setEdits(NO_EDITS);
    setReserveEdit(null);
    setModeEdit(null);
    setEditing(false);
  };

  // Com todos os ativos mantidos o back-end recusa salvar se sobrar algo para investir: avisa antes.
  const allHeldBlocked = isAllHeldSplitError(split.error) && investCents > 0;
  // O botão desligado sempre diz por quê: nada incompleto vai para a API.
  const blockReason =
    salaryCents === null
      ? "Digite o salário para salvar."
      : overrideText !== null && overrideCents === null
        ? "Digite o valor do aporte para salvar."
        : reserveParsed === null
          ? "Corrija a parte da reserva para salvar."
          : allHeldBlocked
            ? 'Todos os ativos estão em "Manter posição"; desmarque algum ou destine o valor à reserva.'
            : null;
  const canSave = blockReason === null && !save.isPending;

  function submit() {
    if (salaryCents === null || reserveParsed === null) return;
    save.mutate(
      {
        month,
        input: {
          salary_cents: salaryCents,
          percent_bps: percentBps,
          final_cents: overrideText === null ? null : overrideCents,
          reserve_cents: reserveCents,
          mode,
        },
      },
      {
        onSuccess: () => {
          setJustSaved(true);
          setEditing(false);
          setEdits(NO_EDITS);
          setReserveEdit(null);
          setModeEdit(null);
        },
      },
    );
  }

  // Categoria com todos os ativos mantidos não recebe aporte: fica fora da rosca e numa seção à parte.
  const allItems = split.data?.items ?? [];
  const items = allItems.filter((item) => item.hold_status !== "all");
  const heldItems = allItems.filter((item) => item.hold_status === "all");
  const adjustedNotes = items.flatMap((item) => {
    const text = adjustedTargetNote(item, allItems);
    return text ? [{ key: item.class_key, name: item.class_name, text }] : [];
  });
  const invested = monthSummary.data ? investedDetail(monthSummary.data) : null;
  // "Hoje": a participação de cada categoria na carteira (sem a reserva). Carteira vazia não tem participação.
  const totalCurrent = allItems.reduce((sum, item) => sum + item.current_cents, 0);
  const todayShares = totalCurrent > 0 ? allocateBps(10_000, allItems.map((item) => item.current_cents)) : null;
  const todayOf = (classKey: string) => {
    const index = allItems.findIndex((item) => item.class_key === classKey);
    return todayShares && index >= 0 ? todayShares[index] : null;
  };
  const shares = items.length ? allocateBps(10_000, items.map((i) => (investCents > 0 ? i.amount_cents : i.effective_target_bps))) : [];
  const donutValues = Object.fromEntries(items.map((item, i) => [item.class_key, shares[i]]));
  const donutClasses = items.map((i) => ({ key: i.class_key, name: i.class_name, color: i.color }));
  const showReserveRow = reserveCents > 0 || (monthSummary.data?.reserve_goal_cents ?? 0) > 0;
  const sumsMatch =
    finalCents > 0 && allItems.reduce((sum, item) => sum + item.amount_cents, 0) + reserveCents === finalCents;

  return (
    <>
      <PageHeader
        title="Aporte do mês"
        subtitle={`Defina quanto investir em ${monthName(month)} e veja para onde cada real deve ir.`}
        action={<MonthInput value={month} onChange={changeMonth} />}
      />

      <div className="space-y-6">
        {existing && existing.plan.length > 0 && monthSummary.data && (
          <PlanTracking
            contribution={existing}
            executed={executedFromSummary(monthSummary.data)}
            investedDetail={invested}
          />
        )}

        {existing && !showForm && (
          <Card
            title={`Aporte de ${monthName(month)} definido`}
            action={
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Alterar aporte
              </Button>
            }
          >
            {justSaved && (
              <div ref={savedRef} tabIndex={-1} className="mb-5 rounded-field">
                <Notice tone="success" role="status">
                  Aporte de {monthName(month)} registrado: <Money cents={existing.final_cents} className="font-semibold" />
                  {existing.reserve_cents > 0 && (
                    <>
                      {" ("}
                      <Money cents={existing.final_cents - existing.reserve_cents} /> para investir e{" "}
                      <Money cents={existing.reserve_cents} /> para a reserva)
                    </>
                  )}
                  . Próximo passo: faça o aporte nas instituições e atualize os saldos na{" "}
                  <Link to="/carteira/atualizar" className="font-semibold underline">
                    Carteira
                  </Link>
                  .
                </Notice>
              </div>
            )}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(9rem,100%),1fr))] gap-x-6 gap-y-5">
              <Stat label="Salário mensal" value={<Money cents={existing.salary_cents} />} />
              <Stat
                label="Aporte do mês"
                value={<Money cents={existing.final_cents} />}
                hint={existing.overridden ? "valor ajustado à mão" : `${formatPercent(existing.percent_bps)} do salário`}
              />
              <Stat
                label="Para investir"
                value={<Money cents={existing.final_cents - existing.reserve_cents} />}
                hint={existing.mode === "proportional" ? "modo proporcional" : "modo rebalancear"}
              />
              <Stat label="Para a reserva" value={<Money cents={existing.reserve_cents} />} />
            </div>
            {existing.plan.length === 0 && (
              <p className="mt-5 text-sm text-ink-3">
                Este aporte foi salvo antes do acompanhamento por categoria. Clique em &quot;Alterar aporte&quot; e depois em &quot;Atualizar
                aporte&quot; para gravar o plano do mês.
              </p>
            )}
          </Card>
        )}

        {showForm && (
          <div ref={formRef} className="grid scroll-mt-20 grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)]">
            <Card title="Quanto investir">
              <div className="space-y-6">
                <Field
                  label="Salário mensal (R$)"
                  error={salaryText !== "" && salaryCents === null ? "Digite um valor como 8.000,00" : null}
                  hint={
                    latest && !existing ? (
                      salaryPrefilled ? (
                        `Preenchido com o mês anterior (${formatMonth(latest.month)}). Mude se o salário mudou.`
                      ) : (
                        <>
                          Mês anterior ({formatMonth(latest.month)}): <Money cents={latest.salary_cents} />
                        </>
                      )
                    ) : (
                      "O valor líquido, o que cai na sua conta."
                    )
                  }
                >
                  <input
                    ref={salaryRef}
                    inputMode="decimal"
                    placeholder="0,00"
                    className={`${inputClass} tabular`}
                    value={salaryText}
                    onChange={(e) => update({ salary: e.target.value })}
                  />
                </Field>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label htmlFor="percent-slider" className="text-sm font-medium text-ink-2">
                      Quanto do salário investir
                    </label>
                    <PercentField bps={percentBps} onCommit={(bps) => update({ percentBps: bps })} />
                  </div>
                  <input
                    id="percent-slider"
                    type="range"
                    min={0}
                    max={3000}
                    step={50}
                    value={Math.min(percentBps, 3000)}
                    aria-valuetext={`${formatPercent(percentBps)} do salário`}
                    onChange={(e) => update({ percentBps: Number(e.target.value) })}
                    className="block h-8 w-full cursor-pointer accent-ink"
                  />
                  <div role="group" aria-label="Atalhos de percentual" className="mt-2 flex flex-wrap gap-2">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        aria-pressed={percentBps === preset}
                        onClick={() => update({ percentBps: preset })}
                        className={cx(
                          "tabular min-h-10 rounded-full px-4 text-sm font-medium transition-colors duration-150",
                          percentBps === preset ? "bg-ink text-card" : "bg-raise text-ink-2 hover:bg-soil",
                        )}
                      >
                        {formatPercent(preset)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-field bg-soil px-5 py-5" aria-live="polite">
                  <p className="text-sm text-ink-2">Aporte de {monthName(month)}</p>
                  <p className="tabular mt-1 break-words font-serif text-4xl leading-none sm:text-display">
                    <Money cents={finalCents} />
                  </p>
                  <p className="mt-3 text-sm text-ink-2">
                    {overrideText !== null ? (
                      <>
                        Valor ajustado à mão. Cálculo original: <Money cents={calculated} /> ({formatPercent(percentBps)} do salário).
                      </>
                    ) : salaryCents ? (
                      <>
                        {formatPercent(percentBps)} de <Money cents={salaryCents} />
                      </>
                    ) : (
                      "Digite o salário para calcular o aporte."
                    )}
                  </p>
                </div>

                <div>
                  <label className="flex min-h-10 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={overrideText !== null}
                      onChange={(e) => update({ override: e.target.checked ? centsToInput(calculated) : null })}
                      className="size-5 accent-ink"
                    />
                    Ajustar o valor manualmente (13º, bônus...)
                  </label>
                  {overrideText !== null && (
                    <div className="mt-2">
                      <Field label="Valor do aporte (R$)" error={overrideCents === null ? "Digite um valor como 1.500,00" : null}>
                        <input
                          inputMode="decimal"
                          className={`${inputClass} tabular`}
                          value={overrideText}
                          onChange={(e) => update({ override: e.target.value })}
                        />
                      </Field>
                    </div>
                  )}
                </div>

                {r && (
                  <Field
                    label="Parte para a reserva de emergência (R$ ou %)"
                    error={reserveParsed === null ? "Digite um valor como 500,00 ou uma porcentagem como 10%" : null}
                    hint={
                      r.goal_cents === 0 ? (
                        "Defina a meta da reserva em Configurações. O restante do aporte segue o plano de alocação."
                      ) : r.reached ? (
                        "Meta da reserva atingida: o aporte inteiro segue o plano de alocação."
                      ) : (
                        <>
                          Faltam <Money cents={r.remaining_cents} /> para a meta da reserva. A parte da reserva não entra no
                          rebalanceamento. Sobram <Money cents={investCents} /> para investir.
                        </>
                      )
                    }
                  >
                    <input
                      inputMode="decimal"
                      placeholder="0,00 ou 10%"
                      className={`${inputClass} tabular`}
                      value={reserveText}
                      onChange={(e) => setReserveEdit(e.target.value)}
                    />
                  </Field>
                )}
                {r && reserveLimitedBy && (
                  <Notice tone="attention" role="status">
                    {reserveLimitedBy === "goal"
                      ? "Você digitou mais do que falta para a meta da reserva: o valor foi limitado a "
                      : "Você digitou mais do que o aporte do mês: o valor foi limitado a "}
                    <Money cents={reserveCents} className="font-semibold" />
                    {reserveLimitedBy === "goal" ? "." : ", o aporte inteiro."}
                  </Notice>
                )}

                <div className="space-y-3">
                  <Button
                    className="w-full"
                    disabled={!canSave}
                    aria-describedby={blockReason ? "save-blocked-reason" : undefined}
                    onClick={submit}
                  >
                    {existing ? "Atualizar aporte" : "Salvar aporte"}
                  </Button>
                  {blockReason && (
                    <p id="save-blocked-reason" className={cx("text-sm", allHeldBlocked ? "text-clay" : "text-ink-2")}>
                      {blockReason}
                    </p>
                  )}
                  <ErrorBox error={save.error} />
                  {existing && existing.plan.length > 0 && planChanged && (
                    <Notice role="status">
                      Você mudou o aporte, a reserva ou o modo. O plano acima só muda quando você clicar em &quot;Atualizar aporte&quot;.
                    </Notice>
                  )}
                  <div className="text-center">
                    {existing ? (
                      <Button variant="ghost" onClick={cancelEditing}>
                        Cancelar alteração
                      </Button>
                    ) : (
                      <Link to="/" className="inline-flex min-h-10 items-center text-sm text-ink-2 underline underline-offset-2">
                        Voltar à visão geral
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            <Card
              title="Divisão sugerida"
              action={
                <Segmented
                  label="Modo de divisão"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "rebalance", label: "Rebalancear" },
                    { value: "proportional", label: "Proporcional" },
                  ]}
                />
              }
            >
              {split.isLoading && <Loading />}
              {split.error &&
                (isAllHeldSplitError(split.error) ? (
                  <div role="alert" className="rounded-field bg-clay-t p-4 text-sm text-ink">
                    <p className="font-medium">Não há onde aplicar o aporte: todos os ativos estão em &quot;Manter posição&quot;.</p>
                    <p className="mt-1">
                      Para dividir o aporte, escolha na Carteira ao menos um ativo para voltar a receber: abra o ativo, clique em
                      &quot;Editar cadastro&quot; e desligue &quot;Manter posição&quot;. Até lá, o aporte só pode ser salvo se o valor
                      inteiro for para a reserva.
                    </p>
                    <ButtonLink to="/carteira/ativos" variant="secondary" size="sm" className="mt-3">
                      Ir para os ativos na Carteira
                    </ButtonLink>
                  </div>
                ) : (
                  <ErrorBox error={split.error} />
                ))}
              {split.data && !split.error && (
                <div className="space-y-5">
                  <p className="text-base text-ink-2">
                    {mode === "rebalance" ? (
                      <>
                        <strong className="font-semibold text-ink">Rebalancear:</strong> os <Money cents={investCents} /> para investir
                        vão primeiro para as categorias abaixo da meta, até aproximá-las do plano.
                        {reserveCents > 0 && (
                          <>
                            {" "}
                            Os <Money cents={reserveCents} /> da reserva ficam de fora.
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <strong className="font-semibold text-ink">Proporcional:</strong> os <Money cents={investCents} /> para investir
                        são divididos na proporção das metas do plano.
                      </>
                    )}{" "}
                    Plano: <strong className="font-semibold text-ink">{split.data.plan_name}</strong>.
                  </p>

                  {investCents === 0 && (
                    <Notice>
                      Sem valor para investir, a rosca mostra a meta do plano. Digite o salário para ver quanto vai para cada categoria.
                    </Notice>
                  )}

                  <Donut
                    classes={donutClasses}
                    values={donutValues}
                    centerTop={investCents > 0 ? formatBRL(investCents) : "100%"}
                    centerBottom={investCents > 0 ? "para investir" : "meta do plano"}
                    centerIsMoney={investCents > 0}
                    className="mx-auto block w-full max-w-[220px]"
                  />

                  <div className="min-w-0 overflow-x-auto">
                    <table className="w-full border-separate border-spacing-y-1.5 text-sm">
                      <caption className="sr-only">
                        Divisão sugerida do aporte por categoria: participação hoje, meta e quanto aportar
                      </caption>
                      <thead className="text-left text-ink-3">
                        <tr>
                          <th scope="col" className="px-3 pb-1 font-medium">
                            Categoria
                          </th>
                          <th scope="col" className="hidden px-2 pb-1 text-right font-medium sm:table-cell">
                            Hoje
                          </th>
                          <th scope="col" className="hidden px-2 pb-1 text-right font-medium sm:table-cell">
                            Meta
                          </th>
                          <th scope="col" className="px-3 pb-1 text-right font-medium">
                            Aportar
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {showReserveRow && (
                          <tr>
                            <th scope="row" className={cx(cell, "text-left font-medium")}>
                              <span className="flex items-center gap-2">
                                <Swatch color={RESERVE_COLOR} />
                                Reserva de emergência
                              </span>
                            </th>
                            <td className={cx(cell, "hidden px-2 text-right text-ink-3 sm:table-cell")}>—</td>
                            <td className={cx(cell, "hidden px-2 text-right text-ink-3 sm:table-cell")}>—</td>
                            <td className={cx(cell, "tabular text-right font-semibold")}>
                              <Money cents={reserveCents} />
                            </td>
                          </tr>
                        )}
                        {items.map((item) => {
                          const destination = destinationText(item.receiving_assets, item.held_assets);
                          const today = todayOf(item.class_key);
                          const above = mode === "rebalance" && item.amount_cents === 0 && today !== null && today > item.effective_target_bps;
                          return (
                            <tr key={item.class_key}>
                              <th scope="row" className={cx(cell, "text-left font-medium")}>
                                <span className="flex items-center gap-2">
                                  <Swatch color={item.color} />
                                  {item.class_name}
                                </span>
                                {above && <span className="block text-xs font-normal text-ink-3">acima da meta, sem aporte</span>}
                                {destination && <span className="block text-xs font-normal text-ink-3">{destination}</span>}
                                <span className="tabular block text-xs font-normal text-ink-3 sm:hidden">
                                  Hoje {today === null ? "—" : formatPercent(today)} · meta {formatPercent(item.effective_target_bps)}
                                </span>
                              </th>
                              <td className={cx(cell, "tabular hidden px-2 text-right text-ink-2 sm:table-cell")}>{today === null ? "—" : formatPercent(today)}</td>
                              <td className={cx(cell, "tabular hidden px-2 text-right text-ink-2 sm:table-cell")}>{formatPercent(item.effective_target_bps)}</td>
                              <td className={cx(cell, "tabular text-right font-semibold")}>
                                <Money cents={item.amount_cents} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {heldItems.length > 0 && (
                        <tbody>
                          <tr>
                            <th scope="rowgroup" colSpan={4} className="px-3 pt-3 pb-1 text-left text-sm font-medium text-ink-3">
                              Todos os ativos mantidos, sem novos aportes
                            </th>
                          </tr>
                          {heldItems.map((item) => (
                            <tr key={item.class_key} className="text-ink-2">
                              <th scope="row" className={cx(cell, "text-left font-medium")}>
                                <span className="flex flex-wrap items-center gap-2">
                                  <Swatch color={item.color} />
                                  {item.class_name}
                                  <Badge>Mantida: meta suspensa</Badge>
                                </span>
                                {item.held_assets.length > 0 && (
                                  <span className="block text-xs font-normal">{destinationText([], item.held_assets)}</span>
                                )}
                              </th>
                              <td className={cx(cell, "tabular hidden px-2 text-right sm:table-cell")}>
                                {todayOf(item.class_key) === null ? "—" : formatPercent(todayOf(item.class_key) ?? 0)}
                              </td>
                              <td className={cx(cell, "hidden px-2 text-right text-xs sm:table-cell")}>suspensa</td>
                              <td className={cx(cell, "text-right text-xs")}>sem novos aportes</td>
                            </tr>
                          ))}
                        </tbody>
                      )}
                      <tfoot>
                        <tr>
                          <th scope="row" className="px-3 pt-2 text-left font-medium">
                            Total
                          </th>
                          <td className="hidden sm:table-cell" />
                          <td className="hidden sm:table-cell" />
                          <td className="tabular px-3 pt-2 text-right font-bold">
                            <Money cents={split.data.amount_cents + reserveCents} />
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {sumsMatch && (
                    <p className="text-sm text-jade">
                      ✓ Soma conferida: <Money cents={split.data.amount_cents} /> para investir + <Money cents={reserveCents} /> para a
                      reserva = <Money cents={finalCents} />.
                    </p>
                  )}
                  {heldItems.length > 0 && (
                    <p className="text-sm text-ink-2">
                      {joinNames(heldItems.map((i) => i.class_name))} {heldItems.length === 1 ? "está toda mantida" : "estão todas mantidas"}:
                      o que já está investido continua na carteira, e o aporte vai para as outras categorias, com as metas ajustadas.
                    </p>
                  )}
                  {adjustedNotes.length > 0 && (
                    <ul className="space-y-0.5 text-sm text-ink-2">
                      {adjustedNotes.map((note) => (
                        <li key={note.key}>
                          {note.name}: {note.text}.
                        </li>
                      ))}
                    </ul>
                  )}

                  <Notice tone="attention">
                    <strong className="font-semibold">Sugestão, não ordem.</strong>{" "}
                    {mode === "rebalance"
                      ? "Categorias acima da meta ficam sem aporte neste mês (R$ 0,00 é esperado)."
                      : "O aporte segue a proporção das metas, mesmo nas categorias que já estão acima delas."}{" "}
                    Se você investir diferente, registre o que fez na Carteira.
                  </Notice>

                  <Button variant="secondary" size="sm" onClick={() => setEditingPlan(true)}>
                    Ajustar metas do plano
                  </Button>
                </div>
              )}
            </Card>
          </div>
        )}

        <Card title="Aportes registrados">
          {contributions.isLoading && <Loading />}
          {history.length === 0 && !contributions.isLoading && (
            <Empty>Nenhum aporte registrado ainda. Quando você salvar o primeiro, ele aparece aqui e alimenta a sua sequência de meses.</Empty>
          )}
          {history.length > 0 && (
            <ul className="space-y-1.5">
              {history.map((c) => (
                <li
                  key={c.id}
                  aria-current={c.month === month ? "true" : undefined}
                  className={cx(
                    "grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 rounded-field px-4 py-3 sm:grid-cols-[7rem_1fr_auto]",
                    c.month === month ? "bg-soil" : "bg-raise",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => changeMonth(c.month)}
                    className="tabular min-h-10 justify-self-start font-medium text-ink underline underline-offset-2"
                  >
                    {formatMonth(c.month)}
                    <span className="sr-only"> (abrir este mês)</span>
                  </button>
                  <span className="tabular col-span-2 row-start-2 text-sm text-ink-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                    Salário <Money cents={c.salary_cents} /> · {formatPercent(c.percent_bps)}
                  </span>
                  <span className="tabular col-start-2 row-start-1 flex items-center gap-2 text-right font-semibold sm:col-start-3">
                    <Money cents={c.final_cents} />
                    {c.overridden && <Badge tone="gold">manual</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {editingPlan && (
        <Drawer title="Plano de alocação" wide onClose={() => setEditingPlan(false)}>
          <p className="mb-4 text-sm text-ink-2">
            As metas valem para o plano ativo e a divisão ao lado se atualiza ao salvar. Elas precisam fechar em 100%.
          </p>
          <PlansSection />
        </Drawer>
      )}
    </>
  );
}

/** Campo numérico do percentual: sincroniza com o slider e só aplica valores válidos. */
function PercentField({ bps, onCommit }: { bps: number; onCommit: (bps: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-1.5">
      <input
        aria-label="Percentual (%)"
        inputMode="decimal"
        value={text ?? bpsToInput(bps)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = text === null ? null : parsePercentToBps(text);
          if (parsed !== null) onCommit(Math.min(parsed, 10_000));
          setText(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={`${inputClass} tabular w-20! py-2! text-right`}
      />
      <span aria-hidden className="text-ink-2">
        %
      </span>
    </div>
  );
}
