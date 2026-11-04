import { useMemo, useState } from "react";
import { useContributions } from "@/features/contributions";
import { arrangeByGroup, useAssetGroups } from "@/features/groups";
import { centsToInput, formatPercent, parseMoneyToCents } from "@/shared/lib/format";
import { Badge, Button, Card, Empty, ErrorBox, Field, inputClass, Loading, Money, Swatch, useConfirm } from "@/shared/ui";
import { AllocationEditor, type EditorGroup } from "./components/AllocationEditor";
import { HeldAssetsNotice } from "./components/HeldAssetsNotice";
import { useActivatePlan, useComparison, useCreatePlan, useDeletePlan, usePlans, useUpdatePlan } from "./hooks";
import { savedPlanMessage } from "./lib/messages";
import { splitProportional, TOTAL_BPS, totalOf, type Targets } from "./lib/targets";
import type { HoldStatus, Plan, PlanInput } from "./types";

function targetsOf(plan: Plan): Targets {
  return Object.fromEntries(plan.targets.map((t) => [t.class_key, t.percent_bps]));
}

function toInput(name: string, values: Targets): PlanInput {
  return { name, targets: Object.entries(values).map(([class_key, percent_bps]) => ({ class_key, percent_bps })) };
}

function TargetTile({ item, bps, held }: { item: { name: string; color: string }; bps: number; held: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
      <Swatch color={item.color} />
      <span className="truncate">{item.name}</span>
      <span className="tabular ml-auto font-semibold">{formatPercent(bps)}</span>
      {/* Linha própria: ao lado do nome, o selo espremia e cortava o nome da categoria. */}
      {held && (
        <span className="w-full">
          <Badge>Mantida: meta suspensa</Badge>
        </span>
      )}
    </li>
  );
}

/** Planos de alocação e metas por categoria (usado em Configurações e no painel da tela de aporte). */
export function PlansSection() {
  const plans = usePlans();
  const contributions = useContributions();
  const updatePlan = useUpdatePlan();
  const createPlan = useCreatePlan();
  const activatePlan = useActivatePlan();
  const deletePlan = useDeletePlan();
  const { confirm, dialog } = useConfirm();
  // Só para saber quais categorias têm ativos mantidos (a marca é por ativo e vale para qualquer plano).
  const comparison = useComparison();
  const assetGroups = useAssetGroups(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Targets | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [locked, setLocked] = useState<ReadonlySet<string>>(new Set());
  const [amountText, setAmountText] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);

  const list = plans.data ?? [];
  const selected = list.find((p) => p.id === selectedId) ?? list.find((p) => p.is_active) ?? list[0];

  const classes = useMemo(
    () => (selected ? selected.targets.map((t) => ({ key: t.class_key, name: t.class_name, color: t.color })) : []),
    [selected],
  );

  const latestContribution = contributions.data?.[0]?.final_cents ?? 0;
  const amountCents = parseMoneyToCents(amountText ?? centsToInput(latestContribution)) ?? 0;

  if (plans.isLoading) return <Loading />;
  if (plans.error) return <ErrorBox error={plans.error} />;
  if (!selected) return <Empty>Nenhum plano de alocação encontrado.</Empty>;

  // Grupos só com as categorias deste plano; um grupo sem nenhuma delas não tem o que somar.
  const editorGroups: EditorGroup[] = assetGroups.data.flatMap((g) => {
    const classKeys = selected.targets.filter((t) => g.class_ids.includes(t.class_id)).map((t) => t.class_key);
    return classKeys.length > 0 ? [{ id: g.id, name: g.name, color: g.color, classKeys }] : [];
  });
  const editorGroupOfKey = new Map(editorGroups.flatMap((g) => g.classKeys.map((key) => [key, g] as const)));

  const saved = targetsOf(selected);
  // Se as categorias mudaram (adicionada/arquivada) enquanto havia edição, o rascunho perde a validade.
  const savedKeys = Object.keys(saved);
  const draftIsCurrent =
    draft !== null && savedKeys.length === Object.keys(draft).length && savedKeys.every((k) => k in draft);
  const values = draftIsCurrent ? draft : saved;
  const dirty = draftIsCurrent && savedKeys.some((k) => saved[k] !== draft[k]);
  const total = totalOf(values);

  const holdStatus: Record<string, HoldStatus> = Object.fromEntries(
    (comparison.data?.items ?? []).map((item) => [item.class_key, item.hold_status]),
  );
  const allHeld = classes.length > 0 && classes.every((c) => holdStatus[c.key] === "all");
  // Prévia como no back-end: a categoria toda mantida fica sem aporte e as outras dividem o valor.
  const amounts = splitProportional(
    amountCents,
    Object.fromEntries(Object.entries(values).filter(([k]) => holdStatus[k] !== "all")),
  );

  // Motivo visível para o Salvar ficar desligado (o back-end recusaria o mesmo plano).
  const invalidReason =
    total !== TOTAL_BPS ? `As metas das categorias devem somar 100%, mas somam ${formatPercent(total)}.` : null;

  const edit = (next: Targets) => {
    setSavedMessage(null);
    setDraft(next);
  };

  const select = (id: number) => {
    setSelectedId(id);
    setDraft(null);
    setLocked(new Set());
    setSavedMessage(null);
  };

  const save = () => {
    updatePlan.mutate(
      { id: selected.id, input: toInput(selected.name, values) },
      {
        onSuccess: () => {
          setSavedMessage(savedPlanMessage(selected.is_active));
          setDraft(null);
        },
      },
    );
  };

  const toggleLock = (key: string) =>
    setLocked((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const mutationError = updatePlan.error ?? createPlan.error ?? activatePlan.error ?? deletePlan.error;

  return (
    <>
      {dialog}
      <div className="space-y-6">
        <Card
          title="Planos"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Plano de alocação"
                value={selected.id}
                onChange={(event) => select(Number(event.target.value))}
                className={`${inputClass} w-auto!`}
              >
                {list.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                    {plan.is_active ? " (ativo)" : ""}
                  </option>
                ))}
              </select>
              {!selected.is_active && (
                <>
                  <Button variant="secondary" onClick={() => activatePlan.mutate(selected.id)}>
                    Ativar
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Excluir o plano "${selected.name}"?`,
                        message: "O plano sai da lista e suas metas por categoria são apagadas. O plano ativo e os aportes já salvos não mudam.",
                        confirmLabel: "Excluir plano",
                      });
                      if (ok) deletePlan.mutate(selected.id, { onSuccess: () => select(list.find((p) => p.is_active)?.id ?? 0) });
                    }}
                  >
                    Excluir
                  </Button>
                </>
              )}
            </div>
          }
        >
          <p className="text-sm text-slate-600 dark:text-slate-400">
            O plano ativo é o usado na tela de aporte do mês. Crie planos para comparar estratégias.
          </p>
        </Card>

        <Card
          title={selected.name}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {dirty && <span className="text-xs text-clay">Alterações não salvas</span>}
              <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(null)}>
                Reverter
              </Button>
              <Button
                disabled={!dirty || invalidReason !== null || updatePlan.isPending}
                aria-describedby={invalidReason ? "plan-invalid-reason" : undefined}
                onClick={save}
              >
                {updatePlan.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          }
        >
          {savedMessage && (
            <p
              role="status"
              className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
            >
              {savedMessage}
            </p>
          )}
          {invalidReason && (
            <p id="plan-invalid-reason" role="alert" className="mb-4 text-sm text-red-700 dark:text-red-300">
              {invalidReason}
            </p>
          )}
          {comparison.data && <HeldAssetsNotice items={comparison.data.items} className="mb-4" />}
          {allHeld && (
            <p role="status" className="mb-4 text-sm text-red-700 dark:text-red-300">
              Todos os ativos estão em &quot;Manter posição&quot;: a simulação fica em R$ 0 e a tela de aporte não consegue dividir o
              valor. Desligue &quot;Manter posição&quot; em ao menos um ativo na Carteira.
            </p>
          )}
          {comparison.isError && (
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              Não foi possível conferir quais ativos estão mantidos. As metas podem ser editadas normalmente.
            </p>
          )}
          <AllocationEditor
            classes={classes}
            groups={editorGroups}
            values={values}
            onChange={edit}
            locked={locked}
            onToggleLock={toggleLock}
            holdStatus={holdStatus}
            amounts={amounts}
            centerTop={formatPercent(total)}
            centerBottom="da carteira"
          />

          <div className="mt-6 flex flex-wrap items-end gap-4 border-t border-slate-200 pt-4 dark:border-slate-800">
            <Field label="Simular com o aporte de" hint="Pré-preenchido com o último aporte registrado." className="w-48">
              <input
                inputMode="decimal"
                className={`${inputClass} tabular`}
                value={amountText ?? centsToInput(latestContribution)}
                onChange={(event) => setAmountText(event.target.value)}
              />
            </Field>
            <p className="tabular pb-2 text-sm text-slate-600 dark:text-slate-400">
              Total simulado:{" "}
              <strong>
                <Money cents={amountCents} />
              </strong>
            </p>
          </div>

          <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
            {newName === null ? (
              <Button variant="secondary" onClick={() => setNewName(`${selected.name} (cópia)`)}>
                Salvar como novo plano
              </Button>
            ) : (
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  createPlan.mutate(toInput(newName.trim(), values), {
                    onSuccess: (plan) => {
                      setNewName(null);
                      setSelectedId(plan.id);
                      setDraft(null);
                    },
                  });
                }}
              >
                <Field label="Nome do novo plano" className="w-64">
                  <input className={inputClass} value={newName} onChange={(event) => setNewName(event.target.value)} autoFocus />
                </Field>
                <Button type="submit" disabled={!newName.trim() || createPlan.isPending}>
                  Criar plano
                </Button>
                <Button variant="ghost" onClick={() => setNewName(null)}>
                  Cancelar
                </Button>
              </form>
            )}
          </div>
        </Card>

        {mutationError && <ErrorBox error={mutationError} />}

        <Card title="Resumo das metas">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {arrangeByGroup(classes, (c) => editorGroupOfKey.get(c.key), (g) => g.id).map((entry) => {
              if (entry.kind === "item") return <TargetTile key={entry.item.key} item={entry.item} bps={values[entry.item.key] ?? 0} held={holdStatus[entry.item.key] === "all"} />;
              const subtotal = totalOf(Object.fromEntries(entry.items.map((c) => [c.key, values[c.key] ?? 0])));
              return (
                <li key={`group-${entry.group.id}`} className="rounded-lg border border-slate-200 p-2 sm:col-span-2 lg:col-span-5 dark:border-slate-800">
                  <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-sm">
                    <Swatch color={entry.group.color} />
                    <strong className="font-semibold">{entry.group.name}</strong>
                    <Badge tone="gold">Grupo</Badge>
                    <span className="tabular ml-auto">
                      <strong>{formatPercent(subtotal)}</strong>{" "}
                      <span className="text-xs text-slate-500 dark:text-slate-400">soma das metas das categorias</span>
                    </span>
                  </p>
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {entry.items.map((c) => (
                      <TargetTile key={c.key} item={c} bps={values[c.key] ?? 0} held={holdStatus[c.key] === "all"} />
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
