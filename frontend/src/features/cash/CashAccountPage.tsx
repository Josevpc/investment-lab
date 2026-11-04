import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAssets, useInstitutions } from "@/features/portfolio";
import { ApiError } from "@/shared/lib/api";
import { formatDate } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { Badge, Button, Card, Empty, Loading, Money, Stat } from "@/shared/ui";
import { MoneyText } from "@/shared/ui/MoneyText";
import { AccountSettings } from "./components/AccountSettings";
import { ActivateCashForm } from "./components/ActivateCashForm";
import { EntryForm } from "./components/EntryForm";
import { CashError } from "./components/parts";
import { PurchaseForm } from "./components/PurchaseForm";
import { ReconcileForm } from "./components/ReconcileForm";
import { StatementCard } from "./components/StatementCard";
import { TransferForm } from "./components/TransferForm";
import { useAccount, useAccounts, useContributedCapital } from "./hooks";
import type { EntryNames } from "./lib/entries";

type Mode = "entry" | "reconcile" | "purchase" | "transfer";

function BackLink() {
  return (
    <Link to="/carteira/contas" className="inline-flex min-h-10 items-center text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
      ← Todas as contas
    </Link>
  );
}

function assetsText(count: number): string {
  return count === 0 ? "nenhum ativo nesta conta" : count === 1 ? "1 ativo nesta conta" : `${count} ativos nesta conta`;
}

/** Uma conta: caixa de hoje, capital aportado, a ação do mês (registrar lançamento) e o extrato. */
export function CashAccountPage() {
  const rawId = useParams().id ?? "";
  const id = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  const validId = Number.isInteger(id) && id > 0;
  const account = useAccount(id);
  const accounts = useAccounts(true);
  const capital = useContributedCapital(id, account.data?.cash_enabled === true);
  const institutions = useInstitutions();
  const allAssets = useAssets(true);
  const [mode, setMode] = useState<Mode | null>(null);
  const [notice, setNotice] = useState<MoneyTextPart[] | null>(null);
  const buttons = useRef<Partial<Record<Mode, HTMLButtonElement | null>>>({});
  // Ao fechar um formulário (cancelar ou concluir), o foco volta ao botão que o abriu. O botão só existe
  // depois que o formulário some (e, ao ativar o caixa, depois que a conta recarrega), por isso o efeito
  // tenta a cada renderização até conseguir.
  const focusBack = useRef<Mode | null>(null);
  useEffect(() => {
    const target = focusBack.current && buttons.current[focusBack.current];
    if (mode === null && target) {
      target.focus();
      focusBack.current = null;
    }
  });

  if (validId && account.isLoading) return <Loading label="Carregando a conta..." />;
  if (!validId || account.error || !account.data) {
    const missing = !validId || (account.error instanceof ApiError && account.error.status === 404);
    return (
      <div className="space-y-4">
        <BackLink />
        {missing ? <Empty>Essa conta não existe (ou não existe mais). Volte para a lista de contas.</Empty> : <CashError error={account.error} />}
        {!missing && (
          <Button variant="secondary" size="sm" onClick={() => void account.refetch()}>
            Tentar de novo
          </Button>
        )}
      </div>
    );
  }

  const a = account.data;
  const institution = institutions.data?.find((i) => i.id === a.institution_id)?.name;
  const assetNames = new Map((allAssets.data ?? []).map((asset) => [asset.id, asset.name]));
  const accountNames = new Map((accounts.data ?? []).map((acc) => [acc.id, acc.name]));
  const names: EntryNames = { asset: (assetId) => assetNames.get(assetId), account: (accountId) => accountNames.get(accountId) };
  // Enquanto os ativos não chegam (ou se a consulta falhou), não dá para dizer que a conta não tem ativos.
  const assetsReady = allAssets.data !== undefined;
  const myAssets = (allAssets.data ?? []).filter((asset) => asset.account_id === a.id && !asset.archived);
  const otherWithCash = (accounts.data ?? []).filter((acc) => acc.id !== a.id && acc.cash_enabled && !acc.archived);
  const canAct = a.cash_enabled && !a.archived;
  const myCapital = a.cash_enabled ? capital.data : undefined;

  const purchaseBlock = allAssets.error
    ? "Não deu para carregar os ativos desta conta; recarregue a página para comprar."
    : !assetsReady
      ? "Carregando os ativos desta conta..."
      : myAssets.length === 0
        ? "Comprar fica disponível quando houver um ativo nesta conta."
        : null;
  const transferBlock = accounts.data === undefined ? "Carregando as outras contas..." : otherWithCash.length === 0 ? "Transferir fica disponível quando outra conta tiver o caixa ativado." : null;

  function open(next: Mode) {
    setNotice(null);
    setMode(next);
  }
  function close(from: Mode, message?: MoneyTextPart[]) {
    focusBack.current = from;
    setMode(null);
    if (message) setNotice(message);
  }

  return (
    <div className="space-y-6">
      <BackLink />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words font-serif text-2xl font-semibold tracking-tight">{a.name}</h2>
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
              {institution && institution !== a.name ? `${institution} · ` : ""}
              {allAssets.error ? "não deu para carregar os ativos" : assetsReady ? assetsText(myAssets.length) : "carregando os ativos..."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {a.archived && <Badge>Arquivada</Badge>}
            {!a.cash_enabled && <Badge>Caixa não ativado</Badge>}
          </div>
        </div>

        {a.cash_enabled && (
          <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <Stat label="Caixa hoje" value={<Money cents={a.balance_cents} />} hint="Dinheiro parado nesta conta, ainda não investido." />
            <Stat
              label="Capital aportado nesta conta"
              value={myCapital ? <Money cents={myCapital.contributed_cents} /> : "—"}
              hint={
                myCapital ? (
                  <>
                    Depósitos <Money cents={myCapital.deposits_cents} /> − retiradas <Money cents={myCapital.withdrawals_cents} />. Não é valor
                    atual nem rendimento.
                  </>
                ) : undefined
              }
            />
            <Stat
              label="Caixa desde"
              value={a.opening_date ? formatDate(a.opening_date) : "—"}
              hint="Data do saldo inicial. Nada é lançado antes dela."
            />
          </div>
        )}
      </Card>

      {a.archived && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Esta conta está arquivada: o extrato fica guardado, mas ela não recebe lançamentos. Para voltar a usá-la, restaure em “Gerenciar
          conta”.
        </p>
      )}

      {!a.cash_enabled && !a.archived && <ActivateCashForm account={a} onDone={(message) => close("entry", message)} />}

      {canAct && mode === null && (
        <div className="space-y-2">
          <div role="group" aria-label="Ações da conta" className="flex flex-wrap items-center gap-3">
            <Button ref={(el) => void (buttons.current.entry = el)} className="min-h-10" onClick={() => open("entry")}>
              Registrar lançamento
            </Button>
            <Button ref={(el) => void (buttons.current.reconcile = el)} variant="secondary" className="min-h-10" onClick={() => open("reconcile")}>
              Conferir com o extrato
            </Button>
            <Button
              ref={(el) => void (buttons.current.purchase = el)}
              variant="secondary"
              className="min-h-10"
              disabled={purchaseBlock !== null}
              aria-describedby={purchaseBlock ? "comprar-motivo" : undefined}
              onClick={() => open("purchase")}
            >
              Comprar ativo com o caixa
            </Button>
            <Button
              ref={(el) => void (buttons.current.transfer = el)}
              variant="secondary"
              className="min-h-10"
              disabled={transferBlock !== null}
              aria-describedby={transferBlock ? "transferir-motivo" : undefined}
              onClick={() => open("transfer")}
            >
              Transferir para outra conta
            </Button>
          </div>
          {(purchaseBlock || transferBlock) && (
            <div className="space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              {purchaseBlock && <p id="comprar-motivo">{purchaseBlock}</p>}
              {transferBlock && <p id="transferir-motivo">{transferBlock}</p>}
            </div>
          )}
        </div>
      )}
      {mode === "entry" && <EntryForm account={a} onDone={(m) => close("entry", m)} onCancel={() => close("entry")} />}
      {mode === "reconcile" && <ReconcileForm account={a} onDone={(m) => close("reconcile", m)} onCancel={() => close("reconcile")} />}
      {mode === "purchase" && (
        <PurchaseForm account={a} assets={myAssets} onDone={(m) => close("purchase", m)} onCancel={() => close("purchase")} />
      )}
      {mode === "transfer" && (
        <TransferForm accounts={accounts.data ?? []} fromId={a.id} onDone={(m) => close("transfer", m)} onCancel={() => close("transfer")} />
      )}

      {/* A região de status existe desde o início, para o aviso ser anunciado quando o texto chegar. */}
      <div role="status" aria-live="polite">
        {notice && (
          <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            <p className="min-w-0 flex-1">
              <MoneyText parts={notice} />
            </p>
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)} aria-label="Fechar aviso">
              Fechar
            </Button>
          </div>
        )}
      </div>

      {a.cash_enabled && <StatementCard account={a} names={names} onNotice={setNotice} />}

      <AccountSettings
        key={`${a.id}-${a.name}`}
        account={a}
        activeAssets={assetsReady ? myAssets.length : null}
        assetsFailed={Boolean(allAssets.error)}
        onNotice={(text) => setNotice([text])}
      />
    </div>
  );
}
