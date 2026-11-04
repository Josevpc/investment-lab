import { useState } from "react";
import { centsToInput, formatDate, parseMoneyToCents } from "@/shared/lib/format";
import { Button, cx, Empty, ErrorBox, Field, inputClass, Loading, Money, useConfirm } from "@/shared/ui";
import { useDeleteValuation, useUpdateValuation, useValuations } from "../hooks";
import type { Asset, Valuation } from "../types";

const gainTone = (value: number) =>
  value === 0 ? "" : value > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";

function Row({ asset, valuation, isCurrent, onlyOne }: { asset: Asset; valuation: Valuation; isCurrent: boolean; onlyOne: boolean }) {
  const update = useUpdateValuation(asset.id);
  const remove = useDeleteValuation(asset.id);
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(valuation.date);
  const [invested, setInvested] = useState(centsToInput(valuation.invested_cents));
  const [current, setCurrent] = useState(centsToInput(valuation.current_cents));

  const investedCents = parseMoneyToCents(invested);
  const currentCents = parseMoneyToCents(current);
  const valid = date !== "" && investedCents !== null && currentCents !== null;

  function save() {
    if (!valid || investedCents === null || currentCents === null) return;
    update.mutate({ id: valuation.id, input: { date, invested_cents: investedCents, current_cents: currentCents } }, { onSuccess: () => setEditing(false) });
  }

  function cancel() {
    setEditing(false);
    setDate(valuation.date);
    setInvested(centsToInput(valuation.invested_cents));
    setCurrent(centsToInput(valuation.current_cents));
    update.reset();
  }

  const gain = valuation.current_cents - valuation.invested_cents;

  return (
    <>
      {dialog}
      <tr className={cx(isCurrent && "bg-blue-50/60 dark:bg-blue-950/20")}>
        {editing ? (
          // Uma célula só, com rótulos visíveis: em tabela, três campos e dois botões não cabem no celular.
          <td colSpan={5} className="py-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Data do valor">
                <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Valor investido">
                <input inputMode="decimal" className={`${inputClass} tabular text-right`} value={invested} onChange={(e) => setInvested(e.target.value)} />
              </Field>
              <Field label="Valor atual">
                <input inputMode="decimal" className={`${inputClass} tabular text-right`} value={current} onChange={(e) => setCurrent(e.target.value)} />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={cancel}>
                Cancelar
              </Button>
              <Button size="sm" disabled={!valid || update.isPending} onClick={save}>
                Salvar
              </Button>
            </div>
          </td>
        ) : (
          <>
            <td className="py-2 pr-3">
              {formatDate(valuation.date)}
              {isCurrent && <span className="ml-2 inline-block rounded-full bg-gold-t px-2.5 py-0.5 text-xs font-medium text-ink">atual</span>}
            </td>
            <td className="tabular hidden py-2 pr-3 text-right sm:table-cell">
              <Money cents={valuation.invested_cents} />
            </td>
            <td className="tabular py-2 pr-3 text-right font-semibold">
              <Money cents={valuation.current_cents} />
              {/* No celular as colunas Investido e Rendimento somem; os valores continuam à vista, com rótulo, sob o saldo. */}
              <span className="mt-0.5 block whitespace-nowrap text-xs font-normal text-ink-3 sm:hidden">
                Investido <Money cents={valuation.invested_cents} />
              </span>
              <span className={cx("mt-0.5 block whitespace-nowrap text-xs font-normal sm:hidden", gainTone(gain) || "text-ink-3")}>
                Rend. <Money cents={gain} />
              </span>
            </td>
            <td className={cx("tabular hidden py-2 pr-3 text-right sm:table-cell", gainTone(gain))}>
              <Money cents={gain} />
            </td>
            <td className="py-2 text-right sm:whitespace-nowrap">
              <div className="flex flex-col items-end sm:block">
              <Button variant="ghost" size="sm" aria-label={`Corrigir o valor de ${formatDate(valuation.date)}`} onClick={() => setEditing(true)}>
                Corrigir
              </Button>
              <Button
                variant="ghost" size="sm"
                disabled={onlyOne}
                title={onlyOne ? "O ativo precisa de ao menos um valor registrado." : undefined}
                aria-label={`Excluir o valor de ${formatDate(valuation.date)}`}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Excluir o valor de ${formatDate(valuation.date)}?`,
                    message: "O registro sai do histórico de valores deste ativo.",
                    confirmLabel: "Excluir valor",
                  });
                  if (ok) remove.mutate(valuation.id);
                }}
              >
                Excluir
              </Button>
              </div>
            </td>
          </>
        )}
      </tr>
      {(update.error || remove.error) && (
        <tr>
          <td colSpan={5} className="pb-2">
            <ErrorBox error={update.error ?? remove.error} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Histórico de valores de um ativo: permite corrigir ou excluir registros digitados errado. */
export function ValuationHistory({ asset }: { asset: Asset }) {
  const valuations = useValuations(asset.id);
  const list = valuations.data ?? [];
  // A posição atual é o registro de data mais recente.
  const latestId = list.reduce<Valuation | null>((best, v) => (best === null || v.date > best.date ? v : best), null)?.id;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        O valor atual de {asset.name} é o registro de data mais recente. Digitou algo errado? Use <strong>Corrigir</strong> para ajustar a data, o
        investido ou o atual, ou exclua um registro indevido.
      </p>
      {valuations.isLoading && <Loading />}
      <ErrorBox error={valuations.error} />
      {!valuations.isLoading && list.length === 0 && <Empty>Nenhum valor registrado.</Empty>}
      {list.length > 0 && (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <tr>
                <th className="pb-2 font-medium">Data</th>
                <th className="hidden pb-2 text-right font-medium sm:table-cell">Investido</th>
                <th className="pb-2 text-right font-medium">Atual</th>
                <th className="hidden pb-2 text-right font-medium sm:table-cell">Rendimento</th>
                <th className="pb-2"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {list.map((valuation) => (
                <Row key={valuation.id} asset={asset} valuation={valuation} isCurrent={valuation.id === latestId} onlyOne={list.length === 1} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
