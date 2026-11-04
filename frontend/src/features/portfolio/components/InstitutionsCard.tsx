import { useState } from "react";
import { Button, Card, Empty, ErrorBox, inputClass } from "@/shared/ui";
import { useCreateInstitution, useDeleteInstitution, useInstitutions } from "../hooks";

export function InstitutionsCard() {
  const institutions = useInstitutions();
  const create = useCreateInstitution();
  const remove = useDeleteInstitution();
  const [name, setName] = useState("");

  const list = institutions.data ?? [];

  return (
    <Card title="Instituições">
      <form
        className="mb-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          create.mutate(name.trim(), { onSuccess: () => setName("") });
        }}
      >
        <input
          aria-label="Nome da instituição"
          className={inputClass}
          placeholder="Banco ou corretora"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          Adicionar
        </Button>
      </form>

      {list.length === 0 ? (
        <Empty>Cadastre os bancos e corretoras onde você tem investimentos.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {list.map((institution) => (
            <li key={institution.id} className="flex items-center justify-between py-2 text-sm">
              {institution.name}
              <Button
                variant="ghost" size="sm"
                aria-label={`Excluir ${institution.name}`}
                onClick={() => remove.mutate(institution.id)}
              >
                Excluir
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 space-y-2">
        <ErrorBox error={create.error ?? remove.error} />
      </div>
    </Card>
  );
}
