import { useState } from "react";
import type { Institution } from "@/features/portfolio";
import { Field, inputClass } from "@/shared/ui";
import { useCreateAccount } from "../hooks";
import type { Account } from "../types";
import { CashError, FormPanel, SubmitRow } from "./parts";

/** Conta extra numa instituição (a primeira nasce junto com a instituição). */
export function NewAccountForm({
  institutions,
  onDone,
  onCancel,
}: {
  institutions: Institution[];
  onDone: (account: Account) => void;
  onCancel: () => void;
}) {
  const create = useCreateAccount();
  const [institutionId, setInstitutionId] = useState(institutions.length === 1 ? String(institutions[0].id) : "");
  const [name, setName] = useState("");
  const institution = institutions.find((i) => String(i.id) === institutionId);
  const trimmed = name.trim();
  const problem = !institution ? "Escolha a instituição." : trimmed === "" ? "Dê um nome à conta." : trimmed.length > 80 ? "Use até 80 caracteres." : null;

  return (
    <FormPanel
      title="Nova conta"
      intro="Cada instituição já tem uma conta com o mesmo nome. Crie outra só se você tem mais de uma conta no mesmo banco ou corretora (ex.: conta corrente e conta investimento)."
      onSubmit={() => {
        if (problem || !institution) return;
        create.mutate({ name: trimmed, institutionId: institution.id }, { onSuccess: onDone });
      }}
    >
      <div className="flex flex-wrap items-start gap-4">
        <Field label="Instituição" className="min-w-0 flex-1 basis-52">
          <select className={`${inputClass} min-h-10`} value={institutionId} onChange={(e) => setInstitutionId(e.target.value)}>
            <option value="">Escolha a instituição</option>
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nome da conta" className="min-w-0 flex-1 basis-52">
          <input
            className={`${inputClass} min-h-10`}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder={institution ? `Ex.: ${institution.name} investimento` : "Ex.: XP investimento"}
          />
        </Field>
      </div>
      <CashError error={create.error} />
      <SubmitRow label="Criar conta" problem={problem} pending={create.isPending} onCancel={onCancel} />
    </FormPanel>
  );
}
