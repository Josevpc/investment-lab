import { Fragment, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAssetClasses } from "@/features/portfolio";
import { NextStepBanner } from "@/features/overview";
import { formatDate, todayISO } from "@/shared/lib/format";
import { Badge, Button, Card, Empty, ErrorBox, Field, inputClass, Loading, Money, PageHeader, ScrollRegion, Segmented, Tabs, useConfirm } from "@/shared/ui";
import { AssetsVsCdiCard } from "./components/AssetsVsCdiCard";
import { CompositionTab } from "./components/CompositionTab";
import { PerformanceTab } from "./components/PerformanceTab";
import { SnapshotForm } from "./components/SnapshotForm";
import { WealthTab } from "./components/WealthTab";
import { useCreateSnapshot, useDeleteSnapshot, useEvolution, useSnapshots, useUpdateSnapshot } from "./hooks";
import { RANGES, rangeStart, type RangeKey } from "./lib/range";
import type { Snapshot } from "./types";

type TabKey = "patrimonio" | "composicao" | "desempenho";

const TABS = [
  { value: "patrimonio", label: "Patrimônio" },
  { value: "composicao", label: "Composição" },
  { value: "desempenho", label: "Desempenho" },
] as const;

const isTab = (value: string | null): value is TabKey => TABS.some((t) => t.value === value);
const isRange = (value: string | null): value is RangeKey => RANGES.some((r) => r.key === value);

type Panel = null | { kind: "new" } | { kind: "edit"; snapshot: Snapshot };

export function HistoryPage() {
  // Aba e período ficam no endereço: a Visão geral leva direto ao desempenho do mesmo intervalo.
  const [params, setParams] = useSearchParams();
  const tab: TabKey = isTab(params.get("aba")) ? (params.get("aba") as TabKey) : "patrimonio";
  const range: RangeKey = isRange(params.get("periodo")) ? (params.get("periodo") as RangeKey) : "12m";
  const setParam = (key: "aba" | "periodo", value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const [date, setDate] = useState(todayISO());
  const [panel, setPanel] = useState<Panel>(null);

  const evolution = useEvolution(rangeStart(range));
  const snapshots = useSnapshots();
  const classes = useAssetClasses(true);
  const create = useCreateSnapshot();
  const update = useUpdateSnapshot();
  const remove = useDeleteSnapshot();
  const { confirm, dialog } = useConfirm();

  const existingOnDate = snapshots.data?.find((s) => s.date === date);

  // Na edição, categorias arquivadas só entram se o snapshot tinha valor nelas.
  const formCategories = (classes.data ?? []).filter(
    (c) => !c.archived || (panel?.kind === "edit" && panel.snapshot.by_class.some((b) => b.class_key === c.key)),
  );

  const closePanel = () => setPanel(null);

  return (
    <>
      {dialog}
      <PageHeader
        title="Histórico"
        subtitle="Veja a evolução e o desempenho a partir dos saldos que você atualiza. O fechamento do mês é opcional: guarda uma foto da carteira."
        action={
          <Segmented
            label="Período"
            size="md"
            value={range}
            // "Todo" (e não "Todo o período"): numa linha só, em 360 px, as quatro opções cabem sem quebrar em dois andares.
            options={RANGES.map((r) => ({ value: r.key, label: r.key === "all" ? "Todo" : r.label }))}
            fill
            onChange={(value) => setParam("periodo", value)}
          />
        }
      />

      <NextStepBanner />

      <div className="space-y-6">
        <Tabs label="Visões do histórico" value={tab} tabs={TABS} onChange={(value) => setParam("aba", value)} />

        {tab === "patrimonio" && (
          <WealthTab range={range} data={evolution.data} loading={evolution.isLoading} error={evolution.error} />
        )}
        {tab === "composicao" && (
          <CompositionTab range={range} data={evolution.data} loading={evolution.isLoading} error={evolution.error} />
        )}
        {tab === "desempenho" && (
          <>
            <PerformanceTab range={range} />
            <AssetsVsCdiCard range={range} />
          </>
        )}

        {panel === null ? (
          <Card
            title="Registrar fechamento"
            action={<Button variant="secondary" onClick={() => setPanel({ kind: "new" })}>Digitar manualmente</Button>}
          >
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!existingOnDate) create.mutate({ date });
              }}
            >
              <Field label="Data do fechamento" className="w-48">
                <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Button type="submit" disabled={!date || create.isPending || Boolean(existingOnDate)}>
                Foto da carteira atual
              </Button>
              <p className="pb-2 text-xs text-slate-500 dark:text-slate-400">
                Guarda o valor de cada ativo hoje; atualize os saldos na Carteira antes. Para lançar meses passados, use &quot;Digitar
                manualmente&quot;.
              </p>
            </form>
            {existingOnDate && (
              <p role="status" className="mt-3 rounded-lg border border-slate-200 bg-slate-100/70 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-800/40">
                Já existe um fechamento em {formatDate(date)}. Para não duplicar, edite o registro existente.{" "}
                <button
                  type="button"
                  className="font-medium text-blue-700 underline dark:text-blue-300"
                  onClick={() => setPanel({ kind: "edit", snapshot: existingOnDate })}
                >
                  Editar este fechamento
                </button>
              </p>
            )}
            <div className="mt-3">
              <ErrorBox error={create.error} />
            </div>
          </Card>
        ) : (
          <Card title={panel.kind === "edit" ? `Editar fechamento de ${formatDate(panel.snapshot.date)}` : "Digitar fechamento"}>
            <SnapshotForm
              key={panel.kind === "edit" ? panel.snapshot.id : "new"}
              categories={formCategories}
              initial={panel.kind === "edit" ? panel.snapshot : undefined}
              pending={create.isPending || update.isPending}
              error={create.error ?? update.error}
              onCancel={closePanel}
              onSubmit={(snapshotDate, items, reserveCents, reserveInvestedCents) =>
                panel.kind === "edit"
                  ? update.mutate({ id: panel.snapshot.id, date: snapshotDate, items, reserveCents, reserveInvestedCents }, { onSuccess: closePanel })
                  : create.mutate({ date: snapshotDate, items, reserveCents, reserveInvestedCents }, { onSuccess: closePanel })
              }
            />
          </Card>
        )}

        <Card title="Fechamentos registrados">
          {snapshots.isLoading && <Loading />}
          {snapshots.data?.length === 0 && <Empty>Nenhum fechamento ainda. Registre o primeiro acima.</Empty>}
          {snapshots.data && snapshots.data.length > 0 && (
            // No celular só Data, Patrimônio e Investido viram colunas; o resto desce para a célula da data e para uma
            // linha de ações logo abaixo. A rolagem é só rede de segurança (valores na casa dos milhões).
            // relative: o "Ações" só para leitor de tela é absoluto; sem isso ele escapa da rolagem e alarga a página.
            <ScrollRegion label="Fechamentos registrados" className="relative">
              <table className="w-full text-sm">
                <caption className="sr-only">Fechamentos registrados, do mais recente ao mais antigo</caption>
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <th scope="col" className="pb-2 font-medium">Data</th>
                    <th scope="col" className="hidden pb-2 pl-4 font-medium md:table-cell">Situação</th>
                    <th scope="col" className="pb-2 pl-2 text-right font-medium md:pl-3">Patrimônio</th>
                    <th scope="col" className="pb-2 pl-2 text-right font-medium md:pl-3">Investido</th>
                    <th scope="col" className="hidden pb-2 pl-3 text-right font-medium md:table-cell">Reserva</th>
                    <th scope="col" className="hidden pb-2 pl-3 md:table-cell"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.data.map((s) => {
                    const situation = (
                      <>
                        {s.manual ? (
                          <Badge tone="gold">Digitado</Badge>
                        ) : (
                          <Badge>Da carteira · {s.assets_count} {s.assets_count === 1 ? "ativo" : "ativos"}</Badge>
                        )}
                        {s.invested_cents === 0 && s.total_cents > 0 && (
                          <span className="ml-2 text-xs text-red-600 dark:text-red-400">sem valor investido: afeta o desempenho</span>
                        )}
                      </>
                    );
                    const actions = (
                      <>
                        <Button
                          variant="ghost" size="sm"
                          aria-label={`Editar fechamento de ${formatDate(s.date)}`}
                          onClick={() => setPanel({ kind: "edit", snapshot: s })}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          aria-label={`Excluir fechamento de ${formatDate(s.date)}`}
                          onClick={async () => {
                            const ok = await confirm({
                              title: `Excluir o fechamento de ${formatDate(s.date)}?`,
                              message: "Os valores dos ativos não são alterados, só este registro no histórico.",
                              confirmLabel: "Excluir fechamento",
                            });
                            if (ok) remove.mutate(s.id);
                          }}
                        >
                          Excluir
                        </Button>
                      </>
                    );
                    return (
                      <Fragment key={s.id}>
                        <tr className="align-top md:border-b md:border-slate-100 md:dark:border-slate-800">
                          <th scope="row" className="pt-2 text-left font-medium md:pb-2">
                            <span className="whitespace-nowrap">{formatDate(s.date)}</span>
                            {/* display: none também tira do leitor de tela; por isso a mesma informação aparece aqui no celular. */}
                            <span className="mt-1 block font-normal text-slate-600 md:hidden dark:text-slate-400">{situation}</span>
                            {s.reserve_cents > 0 && (
                              <span className="tabular mt-1 block text-xs font-normal text-slate-600 md:hidden dark:text-slate-400">
                                Reserva: <Money cents={s.reserve_cents} />
                              </span>
                            )}
                          </th>
                          <td className="hidden py-2 pl-4 text-slate-600 md:table-cell dark:text-slate-400">{situation}</td>
                          <td className="tabular whitespace-nowrap pt-2 pl-2 text-right text-xs font-semibold md:pb-2 md:pl-3 md:text-sm">
                            <Money cents={s.total_cents} />
                          </td>
                          <td className="tabular whitespace-nowrap pt-2 pl-2 text-right text-xs md:pb-2 md:pl-3 md:text-sm">
                            <Money cents={s.invested_cents} />
                          </td>
                          <td className="tabular hidden whitespace-nowrap py-2 pl-3 text-right md:table-cell">
                            {s.reserve_cents > 0 ? <Money cents={s.reserve_cents} /> : "—"}
                          </td>
                          <td className="hidden whitespace-nowrap py-1 pl-3 text-right md:table-cell">{actions}</td>
                        </tr>
                        {/* Só no celular: as ações numa linha própria, com alvo de toque inteiro. */}
                        <tr className="border-b border-slate-100 md:hidden dark:border-slate-800">
                          <td colSpan={3} className="pb-1">
                            <div className="flex gap-1">{actions}</div>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </ScrollRegion>
          )}
          <div className="mt-3">
            <ErrorBox error={remove.error} />
          </div>
        </Card>
      </div>
    </>
  );
}
