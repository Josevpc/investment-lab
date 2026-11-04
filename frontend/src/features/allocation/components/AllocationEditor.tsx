import { arrangeByGroup } from "@/features/groups";
import { formatPercent } from "@/shared/lib/format";
import { Badge, cx, Money, Swatch } from "@/shared/ui";
import { redistribute, totalOf, type Targets } from "../lib/targets";
import type { AllocationClass, HoldStatus } from "../types";
import { Donut } from "./Donut";
import { PercentInput } from "./PercentInput";

/** Grupo de categorias já resolvido para as chaves deste plano. */
export interface EditorGroup {
  id: number;
  name: string;
  color: string;
  classKeys: string[];
}

interface AllocationEditorProps {
  classes: AllocationClass[];
  /** Categorias que pertencem a um grupo ficam juntas sob o subtotal dele. O subtotal é só leitura. */
  groups?: EditorGroup[];
  values: Targets;
  onChange: (next: Targets) => void;
  locked: ReadonlySet<string>;
  onToggleLock: (key: string) => void;
  /** Situação de cada classe quanto aos ativos mantidos (só leitura: a marca é no cadastro do ativo). */
  holdStatus?: Record<string, HoldStatus>;
  /** Valor em centavos que cabe a cada classe (prévia do aporte). */
  amounts?: Record<string, number>;
  centerTop?: string;
  centerBottom?: string;
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      {locked ? <path d="M8 11V8a4 4 0 0 1 8 0v3" /> : <path d="M8 11V8a4 4 0 0 1 7.5-2" />}
    </svg>
  );
}

/** Rosca arrastável + sliders, campos numéricos e travas por classe. */
export function AllocationEditor({
  classes,
  groups = [],
  values,
  onChange,
  locked,
  onToggleLock,
  holdStatus,
  amounts,
  centerTop,
  centerBottom,
}: AllocationEditorProps) {
  const set = (key: string, bps: number) => onChange(redistribute(values, key, bps, locked));
  const groupOfKey = new Map(groups.flatMap((g) => g.classKeys.map((key) => [key, g] as const)));
  const arranged = arrangeByGroup(classes, (c) => groupOfKey.get(c.key), (g) => g.id);

  const renderRow = (c: AllocationClass, nested: boolean) => {
    const isLocked = locked.has(c.key);
    const status = holdStatus?.[c.key] ?? "none";
    return (
      <li key={c.key} className={cx("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-3", !nested && "first:pt-0")}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
          <Swatch color={c.color} />
          <span className="truncate">{c.name}</span>
          {status === "all" && <Badge>{nested ? "Mantida, sem novos aportes" : "Mantida: meta suspensa"}</Badge>}
          {status === "partial" && <Badge>Parte mantida</Badge>}
          {amounts && (
            <span className="ml-auto text-xs font-normal text-slate-500 dark:text-slate-400">
              {status === "all" ? "sem aporte" : <Money cents={amounts[c.key] ?? 0} />}
            </span>
          )}
        </div>
        <div className="row-span-2 flex items-center gap-1">
          <PercentInput
            label={`Meta de ${c.name} (%)`}
            bps={values[c.key] ?? 0}
            disabled={isLocked}
            onCommit={(bps) => set(c.key, bps)}
            className="w-24"
          />
          <button
            type="button"
            aria-pressed={isLocked}
            aria-label={isLocked ? `Destravar ${c.name}` : `Travar ${c.name}`}
            title={isLocked ? "Destravar" : "Travar este percentual enquanto ajusta as outras"}
            onClick={() => onToggleLock(c.key)}
            className={cx(
              "inline-flex size-10 items-center justify-center rounded-full transition-colors duration-150",
              "disabled:cursor-not-allowed disabled:opacity-40",
              isLocked
                ? "bg-gold-t text-ink"
                : "text-ink-3 hover:bg-raise",
            )}
          >
            <LockIcon locked={isLocked} />
          </button>
        </div>
        <input
          type="range"
          min={0}
          max={10000}
          step={50}
          value={values[c.key] ?? 0}
          disabled={isLocked}
          aria-label={`Meta de ${c.name}`}
          onChange={(event) => set(c.key, Number(event.target.value))}
          className="w-full accent-blue-600 disabled:opacity-40"
        />
      </li>
    );
  };

  return (
    <div className="grid items-start gap-6 md:grid-cols-[minmax(0,260px)_1fr]">
      <div className="md:sticky md:top-4">
        <Donut
          classes={classes}
          values={values}
          onChange={onChange}
          locked={locked}
          centerTop={centerTop}
          centerBottom={centerBottom}
          className="mx-auto w-full max-w-[260px]"
        />
      </div>

      <div>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          <strong className="font-medium text-slate-700 dark:text-slate-300">Cadeado:</strong> segura o percentual enquanto você
          ajusta as outras (vale só nesta edição).
          {groups.length > 0 && " A meta de um grupo é a soma das metas das categorias dele: você a ajusta em cada categoria, e o grupo só mostra o total."}
        </p>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {arranged.map((entry) => {
            if (entry.kind === "item") return renderRow(entry.item, false);
            const { group, items } = entry;
            const subtotal = totalOf(Object.fromEntries(items.map((c) => [c.key, values[c.key] ?? 0])));
            const amountSum = amounts ? items.reduce((sum, c) => sum + (holdStatus?.[c.key] === "all" ? 0 : (amounts[c.key] ?? 0)), 0) : null;
            return (
              <li key={`group-${group.id}`} className="py-3 first:pt-0">
                <div role="group" aria-label={`Grupo ${group.name}`} className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 dark:border-slate-800 dark:bg-slate-800/20">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-slate-200 py-2.5 dark:border-slate-800">
                    <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                      <Swatch color={group.color} />
                      <span className="truncate">{group.name}</span>
                      <Badge tone="gold">Grupo</Badge>
                    </p>
                    <p className="tabular text-sm">
                      <strong>{formatPercent(subtotal)}</strong>{" "}
                      <span className="text-xs text-slate-500 dark:text-slate-400">soma das metas das categorias</span>
                      {amountSum !== null && (
                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                          no aporte: <Money cents={amountSum} />
                        </span>
                      )}
                    </p>
                  </div>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">{items.map((c) => renderRow(c, true))}</ul>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
