import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, inputClass, Money, useConfirm } from "@/shared/ui";
import { useUpdateAccount } from "../hooks";
import type { Account } from "../types";
import { CashError, SubmitRow } from "./parts";

/** Por que não dá para arquivar agora (ou null). `activeAssets` null: os ativos ainda não chegaram. */
function archiveBlock(activeAssets: number | null, assetsFailed: boolean): string | null {
  if (assetsFailed) return "Não deu para conferir os ativos desta conta. Recarregue a página para tentar de novo.";
  if (activeAssets === null) return "Conferindo os ativos desta conta...";
  if (activeAssets > 0) {
    return `${activeAssets === 1 ? "Há 1 ativo" : `Há ${activeAssets} ativos`} nesta conta. Arquive-os em Carteira → Ativos antes de arquivar a conta.`;
  }
  return null;
}

/** Renomear, arquivar e restaurar: ações raras, longe das do dia a dia. */
export function AccountSettings({
  account,
  activeAssets,
  assetsFailed = false,
  onNotice,
}: {
  account: Account;
  activeAssets: number | null;
  assetsFailed?: boolean;
  onNotice: (message: string) => void;
}) {
  const update = useUpdateAccount();
  const { confirm, dialog } = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(account.name);
  const renameRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Ao fechar o formulário (salvar ou cancelar), o foco volta para "Renomear".
  useEffect(() => {
    if (!renaming && returnFocus.current) {
      returnFocus.current = false;
      renameRef.current?.focus();
    }
  }, [renaming]);

  const trimmed = name.trim();
  const nameProblem = trimmed === "" ? "Informe um nome." : trimmed.length > 80 ? "Use até 80 caracteres." : trimmed === account.name ? "O nome é o mesmo de agora." : null;
  const blocked = archiveBlock(activeAssets, assetsFailed);
  const hasCash = account.balance_cents !== 0;

  function close() {
    returnFocus.current = true;
    setRenaming(false);
  }

  function rename() {
    if (nameProblem) return;
    update.mutate(
      { id: account.id, name: trimmed },
      {
        onSuccess: () => {
          close();
          onNotice(`Conta renomeada para ${trimmed}. O extrato e os ativos continuam os mesmos.`);
        },
      },
    );
  }

  async function toggleArchive() {
    const archive = !account.archived;
    const ok = await confirm(
      archive
        ? {
            title: `Arquivar ${account.name}?`,
            message: "Ela sai da lista de contas e não recebe lançamentos nem ativos novos. O extrato fica guardado e você pode restaurá-la depois.",
            confirmLabel: "Arquivar conta",
          }
        : {
            title: `Restaurar ${account.name}?`,
            message: "Ela volta à lista e pode receber lançamentos de novo.",
            confirmLabel: "Restaurar conta",
            tone: "primary",
          },
    );
    if (!ok) return;
    update.mutate(
      { id: account.id, name: account.name, archived: archive },
      {
        onSuccess: () =>
          onNotice(archive ? `${account.name} foi arquivada. Para vê-la, use “Mostrar arquivadas” na lista de contas.` : `${account.name} foi restaurada.`),
      },
    );
  }

  return (
    <Card title="Gerenciar conta">
      {dialog}
      {renaming ? (
        <form
          aria-label="Renomear conta"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            rename();
          }}
        >
          <Field label="Nome da conta" className="max-w-sm">
            <input autoFocus className={`${inputClass} min-h-10`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <SubmitRow
            label="Salvar nome"
            problem={nameProblem}
            pending={update.isPending}
            onCancel={() => {
              close();
              setName(account.name);
              update.reset();
            }}
          />
        </form>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600 dark:text-slate-400">
            Nome: <strong className="text-slate-900 dark:text-slate-100">{account.name}</strong> · {account.archived ? "Arquivada" : "Ativa"}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button ref={renameRef} variant="secondary" size="sm" onClick={() => setRenaming(true)}>
              Renomear
            </Button>
            {account.archived ? (
              <Button variant="secondary" size="sm" disabled={update.isPending} onClick={toggleArchive}>
                Restaurar conta
              </Button>
            ) : (
              <Button
                variant="ghost" size="sm" className="text-clay"
                disabled={update.isPending || blocked !== null || hasCash}
                aria-describedby={blocked || hasCash ? "arquivar-motivo" : undefined}
                onClick={toggleArchive}
              >
                Arquivar conta
              </Button>
            )}
          </div>
          {!account.archived && (blocked || hasCash) && (
            <p id="arquivar-motivo" className="text-xs text-slate-600 dark:text-slate-400">
              {blocked ?? (
                <>
                  Ainda há <Money cents={account.balance_cents} /> em caixa. Transfira ou retire o dinheiro antes de arquivar.
                </>
              )}
            </p>
          )}
        </div>
      )}
      <div className="mt-3">
        <CashError error={update.error} />
      </div>
    </Card>
  );
}
