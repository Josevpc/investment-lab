import { useState } from "react";
import { GroupsCard, useAssetGroups, type AssetGroup } from "@/features/groups";
import { nextEarthColor } from "@/shared/lib/palette";
import { Button, Card, Empty, ErrorBox, inputClass, Loading, Notice } from "@/shared/ui";
import { useAssetClasses, useCreateClass, useUpdateClass } from "../hooks";
import type { AssetClass } from "../types";

function CategoryRow({
  category,
  groups,
  onGroupChanged,
}: {
  category: AssetClass;
  /** Grupos ativos. Sem nenhum, a escolha de grupo nem aparece. */
  groups: readonly AssetGroup[];
  /** Texto do último resultado; null limpa o aviso quando uma nova ação começa. */
  onGroupChanged: (message: string | null) => void;
}) {
  const update = useUpdateClass();
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);

  const dirty = name.trim() !== category.name || color !== category.color;
  const save = (archived: boolean) => {
    onGroupChanged(null);
    update.mutate({ id: category.id, input: { name: name.trim() || category.name, color, archived } });
  };

  const currentGroup = groups.find((g) => g.id === category.group_id);
  const changeGroup = (value: string) => {
    const next = groups.find((g) => g.id === Number(value));
    onGroupChanged(null);
    // Só o grupo muda: nome e cor gravados seguem como estão, mesmo com edição pendente na linha.
    update.mutate(
      { id: category.id, input: { name: category.name, color: category.color, archived: category.archived, group_id: next?.id ?? null } },
      {
        onSuccess: () =>
          onGroupChanged(
            next
              ? `${category.name} agora faz parte de ${next.name}. A meta do grupo passa a somar a meta desta categoria; ela continua sendo ajustada no plano de alocação, acima.`
              : `${category.name} saiu do grupo${currentGroup ? ` ${currentGroup.name}` : ""} e volta a aparecer solta nas telas.`,
          ),
      },
    );
  };

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label={`Cor de ${category.name}`}
          value={color}
          disabled={category.archived}
          onChange={(e) => setColor(e.target.value)}
          className="size-10 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-transparent p-0.5 disabled:opacity-40 dark:border-slate-700"
        />
        <input
          aria-label={`Nome de ${category.name}`}
          value={name}
          disabled={category.archived}
          onChange={(e) => setName(e.target.value)}
          className={`${inputClass} min-w-40 flex-1`}
        />
        {groups.length > 0 && !category.archived && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <span aria-hidden>Grupo</span>
            <select
              aria-label={`Grupo de ${category.name}`}
              className={`${inputClass} w-auto! min-h-10`}
              value={currentGroup?.id ?? ""}
              disabled={update.isPending}
              onChange={(e) => changeGroup(e.target.value)}
            >
              <option value="">Sem grupo</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {dirty && !category.archived && (
          <Button disabled={update.isPending || !name.trim()} onClick={() => save(false)}>
            Salvar
          </Button>
        )}
        {category.archived ? (
          <Button variant="secondary" onClick={() => save(false)}>
            Restaurar
          </Button>
        ) : (
          <Button variant="ghost" aria-label={`Arquivar ${category.name}`} onClick={() => save(true)}>
            Arquivar
          </Button>
        )}
      </div>
      <ErrorBox error={update.error} />
    </li>
  );
}

/** Adiciona, renomeia, recolore e arquiva categorias da carteira, e escolhe o grupo de cada uma. */
export function CategoriesCard() {
  const categories = useAssetClasses(true);
  const groups = useAssetGroups(false);
  const create = useCreateClass();
  const [name, setName] = useState("");
  const [groupMessage, setGroupMessage] = useState<string | null>(null);

  const list = categories.data ?? [];
  const active = list.filter((c) => !c.archived);
  const archived = list.filter((c) => c.archived);

  return (
    <>
      <Card title="Categorias da carteira">
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Adicione categorias para abrir novas frentes (ex.: FIIs, Ouro) ou arquive as que saíram da sua estratégia. Uma
          categoria nova entra nos planos com 0%, e uma arquivada devolve o percentual às demais. O histórico é preservado.
          {groups.data.length > 0
            ? " Escolha o grupo de cada categoria na própria linha."
            : " Para juntar categorias em um grupo (ex.: Renda variável), crie o grupo na seção abaixo."}
        </p>

        <form
          className="mb-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            setGroupMessage(null);
            create.mutate({ name: name.trim(), color: nextEarthColor(list.map((c) => c.color)) }, { onSuccess: () => setName("") });
          }}
        >
          <input
            aria-label="Nome da nova categoria"
            className={inputClass}
            placeholder="Nova categoria"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            Adicionar
          </Button>
        </form>
        <ErrorBox error={create.error} />
        {groupMessage && (
          <div className="mb-3">
            <Notice tone="success" role="status">
              {groupMessage}
            </Notice>
          </div>
        )}

        {categories.isLoading && <Loading />}
        {!categories.isLoading && active.length === 0 && <Empty>Nenhuma categoria ativa.</Empty>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {active.map((category) => (
            <CategoryRow
              key={`${category.id}-${category.name}-${category.color}`}
              category={category}
              groups={groups.data}
              onGroupChanged={setGroupMessage}
            />
          ))}
        </ul>

        {archived.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-400">
              Arquivadas ({archived.length})
            </summary>
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {archived.map((category) => (
                <CategoryRow key={category.id} category={category} groups={groups.data} onGroupChanged={setGroupMessage} />
              ))}
            </ul>
          </details>
        )}
      </Card>

      <GroupsCard categories={list.filter((c) => !c.archived)} />
    </>
  );
}
