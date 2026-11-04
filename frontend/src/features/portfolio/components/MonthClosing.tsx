import { useState } from "react";
import { Link } from "react-router-dom";
import { useContributions } from "@/features/contributions";
import { useCreateSnapshot, useSnapshots } from "@/features/history";
import { currentMonth, formatBRL, formatDate, monthName, todayISO } from "@/shared/lib/format";
import { Button, ButtonLink, Card, cx, ErrorBox, Field, inputClass, Loading, Money } from "@/shared/ui";
import { CheckIcon } from "@/shared/ui/icons";
import { usePortfolioSummary } from "../hooks";
import { closingSteps, type ClosingStep } from "../lib/monthClosing";
import type { Asset } from "../types";
import { ClosingEditor } from "./ClosingEditor";

interface Flags {
  balancesConfirmed: boolean;
  reviewed: boolean;
  skippedContribution: boolean;
}

const key = (month: string) => `il-closing-${month}`;

function load(month: string): Flags {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(month)) ?? "{}") as Partial<Flags>;
    return {
      balancesConfirmed: Boolean(parsed.balancesConfirmed),
      reviewed: Boolean(parsed.reviewed),
      skippedContribution: Boolean(parsed.skippedContribution),
    };
  } catch {
    return { balancesConfirmed: false, reviewed: false, skippedContribution: false };
  }
}

function save(month: string, flags: Flags) {
  try {
    localStorage.setItem(key(month), JSON.stringify(flags));
  } catch {
    // Sem armazenamento: o marcador vale só enquanto a tela estiver aberta.
  }
}

function StepMarker({ step, index }: { step: ClosingStep; index: number }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
        step.state === "done" && "border-emerald-500 bg-emerald-500 text-white dark:text-slate-950",
        step.state === "current" && "border-blue-500 text-blue-700 dark:text-blue-300",
        step.state === "pending" && "border-slate-300 text-slate-400 dark:border-slate-700",
      )}
    >
      {step.state === "done" ? <CheckIcon className="size-4" /> : index + 1}
    </span>
  );
}

const STATE_LABEL = { done: "concluída", current: "agora", pending: "pendente" } as const;

/** Fluxo do fechamento mensal. O ponto em que parou é calculado dos dados, então dá para sair e voltar. */
export function MonthClosing({ assets, onClose }: { assets: Asset[]; onClose: () => void }) {
  const month = currentMonth();
  const summary = usePortfolioSummary();
  const contributions = useContributions();
  const snapshots = useSnapshots();
  const createSnapshot = useCreateSnapshot();
  const [flags, setFlags] = useState<Flags>(() => load(month));
  const [date, setDate] = useState(todayISO());
  // Etapa reaberta pela pessoa para corrigir algo; null = seguir de onde parou.
  const [focus, setFocus] = useState<ClosingStep["key"] | null>(null);

  const update = (patch: Partial<Flags>) => {
    const next = { ...flags, ...patch };
    setFlags(next);
    save(month, next);
  };

  const contribution = (contributions.data ?? []).find((c) => c.month === month);
  const monthSnapshots = (snapshots.data ?? []).filter((s) => s.date.startsWith(month));
  const hasSnapshot = monthSnapshots.length > 0;

  const steps = closingSteps({
    month,
    hasContribution: Boolean(contribution) || flags.skippedContribution,
    assets,
    balancesConfirmed: flags.balancesConfirmed,
    reviewed: flags.reviewed,
    hasSnapshot,
  });
  const current = steps.find((s) => s.state === "current")?.key ?? "summary";
  const active = focus ?? current;
  const revisiting = focus !== null && focus !== current;
  const total = summary.data;

  // Resumo: o fechamento mais recente do mês contra o anterior.
  const sorted = [...(snapshots.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const closed = monthSnapshots.length > 0 ? sorted.filter((s) => s.date.startsWith(month)).at(-1) : undefined;
  const previous = closed ? sorted.filter((s) => s.date < closed.date).at(-1) : undefined;

  const loading = summary.isLoading || contributions.isLoading || snapshots.isLoading;

  return (
    <Card
      title={`Fechamento de ${monthName(month)}`}
      action={
        <Button variant="ghost" onClick={onClose}>
          Fechar fluxo
        </Button>
      }
    >
      {loading && <Loading />}
      {revisiting && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-blue-500/50 bg-blue-50/60 px-3 py-2 text-sm dark:bg-blue-400/5"
        >
          <span className="min-w-0 flex-1">
            Você voltou para <strong>{steps.find((s) => s.key === focus)?.title}</strong>.
            {hasSnapshot && " O fechamento já registrado não muda; ajuste o que precisar."}
          </span>
          <Button variant="secondary" onClick={() => setFocus(null)}>
            Continuar de onde parei
          </Button>
        </div>
      )}
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li
            key={step.key}
            aria-current={active === step.key ? "step" : undefined}
            className={cx(
              "rounded-xl border p-3",
              active === step.key && revisiting ? "border-blue-500/60" : "border-slate-200 dark:border-slate-800",
            )}
          >
            <div className="flex items-start gap-3">
              <StepMarker step={step} index={index} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {step.title}{" "}
                    <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">({STATE_LABEL[step.state]})</span>
                  </p>
                  {step.state !== "pending" && active !== step.key && step.key !== "summary" && (
                    <Button
                      variant="ghost" size="sm"
                      aria-label={`Voltar para a etapa: ${step.title}`}
                      onClick={() => setFocus(step.key)}
                    >
                      {step.state === "done" ? "Rever e editar" : "Abrir"}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{step.description}</p>

                {step.key === "contribution" && step.state !== "pending" && (
                  <div className="mt-2 text-sm">
                    {contribution ? (
                      <p>
                        Aporte registrado: <strong><Money cents={contribution.final_cents} /></strong>.{" "}
                        <Link to="/aporte" className="font-medium text-blue-700 underline dark:text-blue-300">Rever</Link>
                      </p>
                    ) : flags.skippedContribution ? (
                      <p>
                        Etapa dispensada: sem aporte neste mês.{" "}
                        <button type="button" className="font-medium text-blue-700 underline dark:text-blue-300" onClick={() => update({ skippedContribution: false })}>
                          Desfazer
                        </button>
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <ButtonLink to="/aporte" size="sm">
                          Calcular aporte
                        </ButtonLink>
                        <Button variant="ghost" onClick={() => update({ skippedContribution: true })}>
                          Não houve aporte este mês
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {step.key === "balances" && active === "balances" && (
                  <div className="mt-3">
                    {assets.length === 0 ? (
                      <p className="text-sm">Cadastre ao menos um ativo para atualizar saldos.</p>
                    ) : (
                      <>
                        <ClosingEditor assets={assets} onDone={() => setFocus(null)} />
                        <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                            Só os ativos que você altera ganham uma nova posição. Se os demais continuam com o saldo de antes, confirme para avançar.
                          </p>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              update({ balancesConfirmed: true });
                              setFocus(null);
                            }}
                          >
                            Os saldos que não mudaram estão corretos
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {step.key === "balances" && step.state === "done" && (
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Todos os ativos têm posição de {monthName(month)}.</p>
                )}

                {step.key === "review" && active === "review" && total && (
                  <div className="mt-3 space-y-3 text-sm">
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div>
                        <dt className="text-xs text-slate-500 dark:text-slate-400">Patrimônio</dt>
                        <dd className="font-semibold"><Money cents={total.total_current_cents} /></dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500 dark:text-slate-400">Investido</dt>
                        <dd className="font-semibold"><Money cents={total.total_invested_cents} /></dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500 dark:text-slate-400">Reserva (inclusa)</dt>
                        <dd className="font-semibold"><Money cents={total.reserve_current_cents} /></dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500 dark:text-slate-400">Posições</dt>
                        <dd className="font-semibold">{total.assets_count}</dd>
                      </div>
                    </dl>
                    <ul className="space-y-1">
                      {total.by_class.map((c) => (
                        <li key={c.class_key} className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-2">
                            <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                            {c.class_name}
                          </span>
                          <span className="tabular">
                            <Money cents={c.current_cents} /> · {(c.share_bps / 100).toFixed(1).replace(".", ",")}%
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => {
                          update({ reviewed: true });
                          setFocus(null);
                        }}
                      >
                        Está tudo certo
                      </Button>
                      <Button variant="secondary" onClick={() => setFocus("balances")}>
                        Voltar e corrigir um saldo
                      </Button>
                    </div>
                  </div>
                )}

                {step.key === "snapshot" && active === "snapshot" && (
                  <form
                    className="mt-3 flex flex-wrap items-end gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      createSnapshot.mutate({ date });
                    }}
                  >
                    <Field label="Data do fechamento" className="w-48">
                      <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
                    </Field>
                    <Button type="submit" disabled={!date || createSnapshot.isPending}>
                      Registrar fechamento
                    </Button>
                    <Button variant="secondary" onClick={() => setFocus("balances")}>
                      Voltar e corrigir um saldo
                    </Button>
                  </form>
                )}
                {step.key === "snapshot" && active === "snapshot" && <div className="mt-2"><ErrorBox error={createSnapshot.error} /></div>}

                {step.key === "summary" && closed && (
                  <div className="mt-3 space-y-2 text-sm">
                    <p>
                      Fechamento de <strong>{formatDate(closed.date)}</strong> registrado: patrimônio de{" "}
                      <strong><Money cents={closed.total_cents} /></strong>.
                    </p>
                    {previous ? (
                      <ul className="space-y-1 text-slate-600 dark:text-slate-400">
                        <li>
                          Desde {formatDate(previous.date)}: patrimônio {closed.total_cents >= previous.total_cents ? "subiu" : "caiu"}{" "}
                          <strong className="tabular">{formatBRL(Math.abs(closed.total_cents - previous.total_cents))}</strong>.
                        </li>
                        <li>
                          Entrou de dinheiro novo: <strong className="tabular">{formatBRL(closed.invested_cents - previous.invested_cents)}</strong>.
                        </li>
                        <li>
                          Valorização do período:{" "}
                          <strong className="tabular">
                            {formatBRL(closed.total_cents - previous.total_cents - (closed.invested_cents - previous.invested_cents))}
                          </strong>
                          .
                        </li>
                      </ul>
                    ) : (
                      <p className="text-slate-600 dark:text-slate-400">Este é o primeiro fechamento: ainda não há com o que comparar.</p>
                    )}
                    <Link to="/historico?aba=desempenho" className="inline-block font-medium text-blue-700 underline dark:text-blue-300">
                      Ver desempenho
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
