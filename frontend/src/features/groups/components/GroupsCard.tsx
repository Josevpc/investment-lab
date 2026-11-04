import { useState } from "react";
import { nextEarthColor } from "@/shared/lib/palette";
import { Button, Card, Empty, ErrorBox, inputClass, Loading, Notice } from "@/shared/ui";
import { useAssetGroups, useCreateGroup, useUpdateGroup } from "../hooks";
import type { AssetGroup } from "../types";

interface Category {
  id: number;
  name: string;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function GroupRow({
  group,
  categories,
  onDone,
  onStart,
}: {
  group: AssetGroup;
  categories: readonly Category[];
  onDone: (message: string) => void;
  /** Uma nova ação começou: o aviso da anterior já não vale. */
  onStart: () => void;
}) {
  const update = useUpdateGroup();
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState(group.color);
  const [confirming, setConfirming] = useState(false);

  const members = categories.filter((c) => group.class_ids.includes(c.id));
  const trimmed = name.trim();
  const dirty = trimmed !== group.name || color !== group.color;

  // mutateAsync (e não os callbacks do mutate): ao salvar, a linha é remontada ou muda de lista, e os
  // callbacks do mutate não disparam em componente desmontado. O erro aparece em `update.error`.
  const run = (input: { name?: string; color?: string; archived?: boolean }, message: string) => {
    onStart();
    return update
      .mutateAsync({ id: group.id, input })
      .then(() => onDone(message))
      .catch(() => undefined);
  };

  const save = () => run({ name: trimmed, color }, `Grupo salvo como ${trimmed}. O nome e a cor já valem na Visão geral, na Carteira e no Histórico.`);

  const archive = () =>
    run(
      { archived: true },
      `Grupo ${group.name} arquivado. ${members.length === 0 ? "Nenhuma categoria estava nele" : plural(members.length, "categoria ficou", "categorias ficaram") + " sem grupo"}; nada saiu da carteira nem do histórico. Para agrupar de novo, restaure o grupo e escolha as categorias outra vez.`,
    );

  const restore = () =>
    run({ archived: false }, `Grupo ${group.name} restaurado, ainda sem categorias. Escolha, na lista de categorias acima, as que fazem parte dele.`);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label={`Cor do grupo ${group.name}`}
          value={color}
          disabled={group.archived}
          onChange={(e) => setColor(e.target.value)}
          className="size-10 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-transparent p-0.5 disabled:opacity-40 dark:border-slate-700"
        />
        <input
          aria-label={`Nome do grupo ${group.name}`}
          value={name}
          disabled={group.archived}
          onChange={(e) => setName(e.target.value)}
          className={`${inputClass} min-w-40 flex-1`}
        />
        {dirty && !group.archived && (
          <Button disabled={update.isPending || !trimmed} onClick={save}>
            Salvar
          </Button>
        )}
        {group.archived ? (
          <Button variant="secondary" disabled={update.isPending} onClick={restore}>
            Restaurar
          </Button>
        ) : (
          <Button variant="ghost" aria-label={`Arquivar o grupo ${group.name}`} aria-expanded={confirming} onClick={() => setConfirming((open) => !open)}>
            Arquivar
          </Button>
        )}
      </div>

      <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
        {members.length > 0
          ? `${plural(members.length, "categoria", "categorias")}: ${members.map((c) => c.name).join(", ")}.`
          : group.archived
            ? "Sem categorias."
            : "Nenhuma categoria ainda. Escolha o grupo na lista de categorias acima."}
      </p>

      {confirming && !group.archived && (
        <div role="group" aria-label={`Confirmar o arquivamento de ${group.name}`} className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-100">
          <p>
            Arquivar o grupo <strong>{group.name}</strong>?{" "}
            {members.length > 0
              ? `${members.map((c) => c.name).join(", ")} ${members.length === 1 ? "fica" : "ficam"} sem grupo e volta${members.length === 1 ? "" : "m"} a aparecer solta${members.length === 1 ? "" : "s"}. `
              : "Nenhuma categoria está nele. "}
            Nada some da carteira, dos saldos nem do histórico, e as metas de cada categoria continuam as mesmas.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="danger" disabled={update.isPending} onClick={archive}>
              Arquivar grupo
            </Button>
            <Button variant="secondary" autoFocus onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      <div className="mt-2">
        <ErrorBox error={update.error} />
      </div>
    </li>
  );
}

/**
 * Cria, renomeia e arquiva grupos de categorias. O grupo só agrupa na leitura: a meta dele é a soma das
 * metas das categorias e continua sendo editada em cada categoria. Quem escolhe o grupo de cada categoria
 * é a lista de categorias (`categories` só serve para mostrar os membros).
 */
export function GroupsCard({ categories }: { categories: readonly Category[] }) {
  const groups = useAssetGroups(true);
  const create = useCreateGroup();
  const restore = useUpdateGroup();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const active = groups.data.filter((g) => !g.archived);
  const archived = groups.data.filter((g) => g.archived);
  const clash = name.trim() !== "" ? groups.data.find((g) => sameName(g.name, name)) : undefined;
  const duplicate = clash !== undefined;
  const reason = !clash
    ? null
    : clash.archived
      ? `O nome ${clash.name} já é de um grupo arquivado. Restaure esse grupo ou escolha outro nome.`
      : "Já existe um grupo com esse nome.";

  const restoreClash = (group: AssetGroup) => {
    setMessage(null);
    restore
      .mutateAsync({ id: group.id, input: { archived: false } })
      .then(() => {
        setName("");
        setMessage(`Grupo ${group.name} restaurado, ainda sem categorias. Escolha, na lista de categorias acima, as que fazem parte dele.`);
      })
      .catch(() => undefined);
  };

  return (
    <Card title="Grupos de categorias">
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
        Um grupo junta categorias na hora de ler a carteira (ex.: <strong>Renda variável</strong> com FIIs e Ações/ETF). Ele só
        agrupa: a meta do grupo é a <strong>soma das metas das categorias</strong> dele, e você continua ajustando a meta em cada
        categoria.
      </p>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed || duplicate) return;
          create.mutate(
            { name: trimmed, color: nextEarthColor(groups.data.map((g) => g.color)) },
            {
              onSuccess: () => {
                setName("");
                setMessage(`Grupo ${trimmed} criado. Agora escolha as categorias que fazem parte dele.`);
              },
            },
          );
        }}
      >
        <input
          aria-label="Nome do novo grupo"
          aria-describedby={reason ? "group-name-reason" : undefined}
          aria-invalid={duplicate || undefined}
          className={`${inputClass} min-w-40 flex-1`}
          placeholder="Novo grupo (ex.: Renda variável)"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setMessage(null);
          }}
        />
        <Button type="submit" disabled={!name.trim() || duplicate || create.isPending}>
          Criar grupo
        </Button>
      </form>
      {reason && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p id="group-name-reason" className="text-xs text-red-700 dark:text-red-300">
            {reason}
          </p>
          {clash?.archived && (
            <Button variant="secondary" disabled={restore.isPending} aria-label={`Restaurar o grupo ${clash.name}`} onClick={() => restoreClash(clash)}>
              Restaurar
            </Button>
          )}
        </div>
      )}
      <div className="mt-3 space-y-3">
        <ErrorBox error={create.error} />
        <ErrorBox error={restore.error} />
        {message && (
          <Notice tone="success" role="status">
            {message}
          </Notice>
        )}
      </div>

      <div className="mt-4">
        {groups.isLoading && <Loading />}
        {groups.isError && <ErrorBox error={groups.error} />}
        {groups.isSuccess && groups.data.length === 0 && (
          <Empty>
            Nenhum grupo ainda. Sem grupos, a carteira continua listada categoria por categoria; com um grupo, a Visão geral e a
            Carteira mostram o subtotal dele e deixam abrir as categorias.
          </Empty>
        )}
        {active.length > 0 && (
          <ul aria-label="Grupos ativos" className="divide-y divide-slate-100 dark:divide-slate-800">
            {active.map((group) => (
              <GroupRow key={`${group.id}-${group.name}-${group.color}`} group={group} categories={categories} onDone={setMessage} onStart={() => setMessage(null)} />
            ))}
          </ul>
        )}
        {archived.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-400">Arquivados ({archived.length})</summary>
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {archived.map((group) => (
                <GroupRow key={group.id} group={group} categories={categories} onDone={setMessage} onStart={() => setMessage(null)} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}
