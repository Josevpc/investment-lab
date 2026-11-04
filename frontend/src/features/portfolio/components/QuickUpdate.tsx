import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { formatDate, formatSignedPercent, todayISO } from "@/shared/lib/format";
import { Badge, Button, Card, cx, Empty, ErrorBox, Field, inputClass, Money } from "@/shared/ui";
import { useSaveBalances } from "../hooks";
import { daysSince, evaluateRow, groupByInstitution, isStale, updatedLabel, type Draft } from "../lib/quickUpdate";
import { parseQuantity } from "../lib/quote";
import type { Asset } from "../types";
import { FetchQuoteButton } from "./FetchQuoteButton";
import { QuickUpdateResult, SignedMoney, type SavedRow } from "./QuickUpdateResult";

const EMPTY_DRAFT: Draft = { balance: "", quote: "", contribution: "" };

/**
 * Atualização rápida dos saldos, para a rotina semanal: uma tela só, com os ativos agrupados por
 * instituição. O que a pessoa deixar em branco não ganha uma nova posição. O fechamento do mês
 * (que guarda a foto da carteira) continua à parte.
 */
export function QuickUpdate({ assets }: { assets: Asset[] }) {
  const save = useSaveBalances();
  const base = useId();
  const saveRef = useRef<HTMLButtonElement>(null);
  const [today] = useState(todayISO);
  const [date, setDate] = useState(today);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  // Linhas em que a pessoa abriu o aporte; com um aporte digitado, o campo fica aberto de qualquer jeito.
  const [withContribution, setWithContribution] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState<{ rows: SavedRow[]; date: string; unchanged: number } | null>(null);

  const groups = groupByInstitution(assets);
  const draftOf = (asset: Asset): Draft => drafts[asset.id] ?? EMPTY_DRAFT;
  const edit = (asset: Asset, patch: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [asset.id]: { ...(current[asset.id] ?? EMPTY_DRAFT), ...patch } }));

  // Na ordem da tela: é assim que a pessoa lê, e a gravação segue a mesma ordem.
  const rows = groups.flatMap((g) => g.assets).map((asset) => ({ asset, state: evaluateRow(asset, draftOf(asset), date) }));
  const ready = rows.flatMap(({ asset, state }) => (state.kind === "ready" ? [{ asset, preview: state.preview, result: state.result }] : []));
  const hasInvalid = rows.some(({ state }) => state.kind === "invalid");
  const canSave = ready.length > 0 && !hasInvalid && date !== "" && !save.isPending;

  function submit() {
    if (!canSave) return;
    save.mutate(
      ready.map(({ asset, preview }) => ({
        id: asset.id,
        input: {
          date,
          balance_cents: preview.balanceCents ?? 0,
          contribution_cents: preview.contributionCents,
          contribution_date: preview.contributionCents > 0 && preview.contributionDate ? preview.contributionDate : undefined,
        },
      })),
      {
        onSuccess: () => {
          setSaved({
            rows: ready.map(({ asset, preview, result }) => ({
              asset,
              balanceCents: preview.balanceCents ?? 0,
              contributionCents: preview.contributionCents,
              result,
            })),
            date,
            unchanged: rows.length - ready.length,
          });
          setDrafts({});
          setWithContribution({});
        },
      },
    );
  }

  // Enter pula para o saldo do próximo ativo (ou para o botão, no último): dá para atualizar tudo só no teclado.
  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    const target = event.target;
    if (event.key !== "Enter" || !(target instanceof HTMLInputElement) || !target.dataset.nav) return;
    event.preventDefault();
    const fields = [...event.currentTarget.querySelectorAll<HTMLInputElement>("input[data-nav]")];
    const next = fields.slice(fields.indexOf(target) + 1).find((field) => field.dataset.nav === "balance");
    (next ?? saveRef.current)?.focus();
  }

  if (saved) {
    return (
      <QuickUpdateResult
        saved={saved.rows}
        date={saved.date}
        unchanged={saved.unchanged}
        onAgain={() => {
          setSaved(null);
          save.reset();
        }}
      />
    );
  }

  const status = hasInvalid
    ? "Corrija os valores apontados antes de salvar."
    : ready.length === 0
      ? "Nada para salvar ainda."
      : `${ready.length} ${ready.length === 1 ? "ativo" : "ativos"} para salvar.`;

  return (
    <form
      className="max-w-4xl"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={onKeyDown}
    >
      <Card
        title="Atualizar saldos"
        action={
          <Link to="/carteira/fechamento" className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
            Fechamento do mês
          </Link>
        }
      >
        {assets.length === 0 ? (
          <div className="space-y-3">
            <Empty>Cadastre um ativo para poder atualizar os saldos.</Empty>
            <Link to="/carteira/ativos?novo=1" className="inline-block text-sm font-medium text-blue-700 underline dark:text-blue-300">
              Novo ativo
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Digite o saldo de hoje de cada ativo, como aparece no app do banco. Deixe em branco o que não mudou: esses ativos continuam como
              estão.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-4">
              <Field label="Data dos saldos" className="w-48" hint="Os saldos valem para este dia.">
                <input type="date" max={today} className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>

            {groups.map((group) => (
              <section key={group.id} aria-labelledby={`${base}-group-${group.id}`} className="mt-6">
                <h3 id={`${base}-group-${group.id}`} className="font-serif text-base font-semibold">
                  {group.name}
                </h3>
                <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
                  {group.assets.map((asset) => {
                    const draft = draftOf(asset);
                    const state = rows.find((r) => r.asset.id === asset.id)?.state;
                    const days = daysSince(asset.valuation_date, today);
                    const deltaId = `${base}-delta-${asset.id}`;
                    const showContribution = Boolean(withContribution[asset.id]) || draft.contribution !== "";
                    return (
                      <li key={asset.id} aria-label={asset.name} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:gap-4">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {asset.name}{" "}
                            {isStale(days) && <Badge tone="gold">Desatualizado</Badge>}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {asset.class_name} · saldo anterior <Money cents={asset.current_cents} /> · {updatedLabel(days)}
                            {asset.class_key === "renda_fixa" && asset.balance_is_net && " · saldo líquido de IR"}
                          </p>
                        </div>

                        <div>
                          <input
                            aria-label={`Saldo atual de ${asset.name}`}
                            aria-describedby={deltaId}
                            aria-invalid={state?.kind === "invalid" || undefined}
                            data-nav="balance"
                            inputMode="decimal"
                            placeholder="saldo de hoje"
                            className={cx(inputClass, "tabular text-right", state?.kind === "invalid" && "border-red-500")}
                            value={draft.balance}
                            onChange={(e) => edit(asset, { balance: e.target.value, quote: "" })}
                          />
                          {parseQuantity(asset.quantity) !== null && (
                            <label className="mt-1 flex items-center justify-end gap-1.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                              {asset.quantity} × cotação
                              <input
                                aria-label={`Cotação de ${asset.name}`}
                                data-nav="quote"
                                inputMode="decimal"
                                placeholder="R$"
                                className={`${inputClass} tabular w-24 py-1 text-right text-xs`}
                                value={draft.quote}
                                onChange={(e) => edit(asset, { quote: e.target.value, balance: "" })}
                              />
                            </label>
                          )}
                          {asset.class_key === "cripto" && asset.ticker && parseQuantity(asset.quantity) !== null && (
                            <FetchQuoteButton
                              ticker={asset.ticker}
                              assetName={asset.name}
                              className="mt-1 items-end"
                              onQuote={(price) => edit(asset, { quote: price, balance: "" })}
                            />
                          )}

                          {showContribution ? (
                            <div className="mt-2 space-y-1">
                              <input
                                aria-label={`Aporte em ${asset.name}`}
                                inputMode="decimal"
                                placeholder="aporte (R$)"
                                className={`${inputClass} tabular py-1.5 text-right`}
                                value={draft.contribution}
                                onChange={(e) => edit(asset, { contribution: e.target.value })}
                              />
                              <label className="flex items-center justify-end gap-1.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                                dia do aporte
                                <input
                                  type="date"
                                  aria-label={`Dia do aporte em ${asset.name}`}
                                  max={date}
                                  className={`${inputClass} w-36 py-1 text-xs`}
                                  value={draft.contributionDate ?? date}
                                  onChange={(e) => edit(asset, { contributionDate: e.target.value })}
                                />
                              </label>
                            </div>
                          ) : null}
                          <div className="mt-1 text-right">
                            <button
                              type="button"
                              aria-expanded={showContribution}
                              aria-label={showContribution ? `Sem aporte em ${asset.name}` : `Adicionar aporte em ${asset.name}`}
                              className="text-xs font-medium text-blue-700 underline dark:text-blue-300"
                              onClick={() => {
                                if (showContribution) edit(asset, { contribution: "", contributionDate: undefined });
                                setWithContribution((current) => ({ ...current, [asset.id]: !showContribution }));
                              }}
                            >
                              {showContribution ? "Sem aporte" : "Adicionar aporte"}
                            </button>
                          </div>

                          <p id={deltaId} className="tabular mt-1 min-h-4 text-right text-xs">
                            {state?.kind === "invalid" && <span className="text-red-600 dark:text-red-400">{state.message}</span>}
                            {state?.kind === "ready" && (
                              <>
                                <span className="font-medium">
                                  <SignedMoney cents={state.result.gainCents} />
                                  {state.result.returnBps !== null && ` · ${formatSignedPercent(state.result.returnBps)}`}
                                </span>{" "}
                                <span className="text-slate-500 dark:text-slate-400">desde {formatDate(asset.valuation_date)}</span>
                              </>
                            )}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        )}
      </Card>

      {assets.length > 0 && (
        <>
          <div className="mt-3">
            <ErrorBox error={save.error} />
          </div>
          {/* Abaixo de lg há uma barra de navegação fixa (5rem) no rodapé: o botão de salvar fica acima dela. */}
          <div className="sticky bottom-20 z-10 mt-3 flex lg:bottom-3 flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
            <Button ref={saveRef} type="submit" disabled={!canSave}>
              {save.isPending ? "Salvando..." : "Salvar atualização"}
            </Button>
            <p role="status" className={cx("text-sm", hasInvalid ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-400")}>
              {status}
            </p>
          </div>
        </>
      )}
    </form>
  );
}
