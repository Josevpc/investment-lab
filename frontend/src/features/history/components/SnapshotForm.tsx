import { useId, useState, type FormEvent } from "react";
import { centsToInput, parseMoneyToCents, todayISO } from "@/shared/lib/format";
import { RESERVE_COLOR } from "@/shared/lib/chart";
import { Button, ErrorBox, Field, inputClass, Swatch } from "@/shared/ui";
import { buildSnapshotItems, type ManualRow } from "../lib/manual";
import type { Snapshot, SnapshotItemInput } from "../types";

interface SnapshotFormProps {
  /** Categorias a preencher (ativas e, na edição, as arquivadas que já tinham valor). */
  categories: { key: string; name: string; color: string }[];
  /** Presente na edição: preenche data e valores. */
  initial?: Snapshot;
  pending?: boolean;
  error?: unknown;
  /** `reserveInvestedCents` só vem quando a pessoa preencheu; ausente = a API decide (mantém ou usa o valor atual). */
  onSubmit: (date: string, items: SnapshotItemInput[], reserveCents: number, reserveInvestedCents?: number) => void;
  onCancel: () => void;
}

/** Digita o valor de cada categoria numa data: serve para lançar o passado ou corrigir um snapshot. */
export function SnapshotForm({ categories, initial, pending, error, onSubmit, onCancel }: SnapshotFormProps) {
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [reserve, setReserve] = useState(initial && initial.reserve_cents > 0 ? centsToInput(initial.reserve_cents) : "");
  const [rows, setRows] = useState<ManualRow[]>(() =>
    categories.map((category) => {
      const saved = initial?.by_class.find((c) => c.class_key === category.key);
      return {
        key: category.key,
        name: category.name,
        invested: saved ? centsToInput(saved.invested_cents) : "",
        current: saved ? centsToInput(saved.current_cents) : "",
      };
    }),
  );
  // Na edição já mostra o investido que o fechamento tem; na criação começa vazio (a API usa o valor atual).
  const [reserveInvested, setReserveInvested] = useState(
    initial && initial.reserve_cents > 0 ? centsToInput(initial.reserve_invested_cents) : "",
  );
  const [problem, setProblem] = useState<string | null>(null);
  const investedId = useId();

  const edit = (key: string, patch: Partial<ManualRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const reserveCents = reserve.trim() === "" ? 0 : parseMoneyToCents(reserve);
  // O campo só existe com reserva; sem ela o que estiver digitado é ignorado (nunca vai para a API).
  const showReserveInvested = reserveCents !== null && reserveCents > 0;
  // Vazio = não mandar nada: a API mantém o investido do fechamento (na criação, usa o valor atual).
  const reserveInvestedFilled = showReserveInvested && reserveInvested.trim() !== "";
  const reserveInvestedParsed = reserveInvestedFilled ? parseMoneyToCents(reserveInvested) : undefined;
  const reserveInvestedInvalid = reserveInvestedFilled && reserveInvestedParsed === null;
  // Igual ao que o fechamento já tinha: nada a enviar, a API mantém.
  const reserveInvestedCents =
    initial && initial.reserve_cents > 0 && reserveInvestedParsed === initial.reserve_invested_cents ? undefined : reserveInvestedParsed;

  function changeReserve(value: string) {
    setReserve(value);
    // Só quando a reserva é apagada: um valor intermediário (ex.: "0" a caminho de "0,5") não pode perder o que já foi digitado.
    if (value.trim() === "") setReserveInvested("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (reserveCents === null) {
      setProblem("Valor inválido na reserva de emergência.");
      return;
    }
    if (reserveInvestedInvalid) return;
    const built = buildSnapshotItems(rows, reserveCents > 0);
    setProblem(built.error);
    if (!built.error) onSubmit(date, built.items, reserveCents, reserveInvestedCents ?? undefined);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Informe quanto você tinha em cada categoria nessa data. Deixe em branco o que não existia. Se o valor
        investido ficar vazio, usamos o mesmo valor atual.
      </p>

      <Field label="Data" className="w-48">
        <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <tr>
              <th className="pb-2 font-medium">Categoria</th>
              <th className="w-40 pb-2 font-medium">Valor atual (R$)</th>
              <th className="w-40 pb-2 font-medium">Investido (R$)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((row, index) => (
              <tr key={row.key}>
                <td className="py-1.5 pr-3">
                  <span className="flex items-center gap-2">
                    <Swatch color={categories[index].color} />
                    {row.name}
                  </span>
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    aria-label={`Valor atual de ${row.name}`}
                    inputMode="decimal"
                    placeholder="0,00"
                    className={`${inputClass} tabular py-1.5 text-right`}
                    value={row.current}
                    onChange={(e) => edit(row.key, { current: e.target.value })}
                  />
                </td>
                <td className="py-1.5">
                  <input
                    aria-label={`Valor investido em ${row.name}`}
                    inputMode="decimal"
                    placeholder="igual ao atual"
                    className={`${inputClass} tabular py-1.5 text-right`}
                    value={row.invested}
                    onChange={(e) => edit(row.key, { invested: e.target.value })}
                  />
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-1.5 pr-3">
                <span className="flex items-center gap-2">
                  <Swatch color={RESERVE_COLOR} />
                  Reserva de emergência
                </span>
              </td>
              <td className="py-1.5 pr-2">
                <input
                  aria-label="Valor da reserva de emergência"
                  inputMode="decimal"
                  placeholder="0,00"
                  className={`${inputClass} tabular py-1.5 text-right`}
                  value={reserve}
                  onChange={(e) => changeReserve(e.target.value)}
                />
              </td>
              <td className="py-1.5 text-xs text-slate-500 dark:text-slate-400">fora das categorias acima</td>
            </tr>
          </tbody>
        </table>
      </div>

      {showReserveInvested && (
        <div className="max-w-sm text-sm">
          <label htmlFor={investedId} className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
            Quanto da reserva foi aporte (R$)
          </label>
          <input
            id={investedId}
            aria-invalid={reserveInvestedInvalid}
            aria-describedby={`${investedId}-hint${reserveInvestedInvalid ? ` ${investedId}-error` : ""}`}
            inputMode="decimal"
            placeholder={initial ? "manter o que já tinha" : "igual ao valor da reserva"}
            className={`${inputClass} tabular text-right`}
            value={reserveInvested}
            onChange={(e) => setReserveInvested(e.target.value)}
          />
          {reserveInvestedInvalid && (
            <p id={`${investedId}-error`} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
              Informe um valor de R$ 0,00 em diante, como 1500,00.
            </p>
          )}
          <p id={`${investedId}-hint`} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {initial
              ? "Opcional. Já mostramos o que este fechamento tinha como investido na reserva; altere para definir quanto você colocou nela. Se apagar o campo, mantemos o valor que ele já tinha."
              : "Opcional. Deixe vazio e usamos o valor atual da reserva como investido. Preencha para definir quanto você colocou nela."}
          </p>
        </div>
      )}

      {problem && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {problem}
        </p>
      )}
      <ErrorBox error={error} />

      <div className="flex gap-2">
        <Button type="submit" disabled={!date || pending || reserveInvestedInvalid}>
          {initial ? "Salvar alterações" : "Salvar snapshot"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
