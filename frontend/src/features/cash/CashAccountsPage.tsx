import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAssets, useInstitutions } from "@/features/portfolio";
import { formatDate } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { Badge, Button, Card, cx, Empty, Loading, Money, Notice, Stat } from "@/shared/ui";
import { MoneyText } from "@/shared/ui/MoneyText";
import { NewAccountForm } from "./components/NewAccountForm";
import { CashError } from "./components/parts";
import { TransferForm } from "./components/TransferForm";
import { useAccounts, useCashBalance, useContributedCapital } from "./hooks";
import type { Account } from "./types";

const LINK_BUTTON =
  "inline-flex min-h-10 items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40";

function AccountRow({
  account,
  institutionName,
  assetsCount,
  contributedCents,
}: {
  account: Account;
  institutionName: string | undefined;
  /** Null enquanto os ativos não chegam: aí não se diz "nenhum ativo". */
  assetsCount: number | null;
  contributedCents: number | undefined;
}) {
  const details = [
    institutionName && institutionName !== account.name ? institutionName : null,
    assetsCount === null ? null : assetsCount === 0 ? "nenhum ativo" : assetsCount === 1 ? "1 ativo" : `${assetsCount} ativos`,
    account.cash_enabled && account.opening_date ? `caixa desde ${formatDate(account.opening_date)}` : null,
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="flex flex-wrap items-center gap-2">
          <Link
            to={`/carteira/contas/${account.id}`}
            className="break-words font-medium text-slate-900 hover:underline focus-visible:underline dark:text-slate-100"
          >
            {account.name}
          </Link>
          {account.archived && <Badge>Arquivada</Badge>}
          {!account.cash_enabled && !account.archived && <Badge>Caixa não ativado</Badge>}
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{details.join(" · ")}</p>
      </div>
      {account.cash_enabled ? (
        <div className="ml-auto text-right">
          <p className="font-serif text-lg font-semibold">
            <Money cents={account.balance_cents} />
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            em caixa{contributedCents !== undefined && <> · aportado <Money cents={contributedCents} /></>}
          </p>
        </div>
      ) : (
        !account.archived && (
          <Link
            to={`/carteira/contas/${account.id}`}
            aria-label={`Ativar caixa de ${account.name}`}
            className={cx(
              LINK_BUTTON,
              "border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800",
            )}
          >
            Ativar caixa
          </Link>
        )
      )}
    </li>
  );
}

/**
 * Contas e caixa: quanto dinheiro está parado em cada conta, esperando para ser investido. Daqui a pessoa
 * abre a conta (extrato e lançamentos), ativa o caixa, transfere entre contas ou cria uma conta.
 */
export function CashAccountsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<"transfer" | "new" | null>(null);
  const [notice, setNotice] = useState<MoneyTextPart[] | null>(null);
  const transferRef = useRef<HTMLButtonElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  // Ao fechar um formulário, o foco volta ao botão que o abriu.
  const focusBack = useRef<"transfer" | "new" | null>(null);
  useEffect(() => {
    if (form !== null || !focusBack.current) return;
    (focusBack.current === "transfer" ? transferRef : newRef).current?.focus();
    focusBack.current = null;
  }, [form]);
  const accounts = useAccounts(true);
  const balance = useCashBalance();
  const capital = useContributedCapital();
  const institutions = useInstitutions();
  const assets = useAssets(false);

  const all = accounts.data ?? [];
  const institutionName = new Map((institutions.data ?? []).map((i) => [i.id, i.name]));
  const contributed = new Map((capital.data?.by_account ?? []).map((c) => [c.account_id, c.contributed_cents]));
  const assetsByAccount = new Map<number, number>();
  for (const asset of assets.data ?? []) {
    if (asset.account_id !== null) assetsByAccount.set(asset.account_id, (assetsByAccount.get(asset.account_id) ?? 0) + 1);
  }
  const sorted = [...all].sort(
    (a, b) =>
      (institutionName.get(a.institution_id) ?? "").localeCompare(institutionName.get(b.institution_id) ?? "", "pt-BR") ||
      a.name.localeCompare(b.name, "pt-BR"),
  );
  const active = sorted.filter((a) => !a.archived);
  const archived = sorted.filter((a) => a.archived);
  const shown = showArchived ? sorted : active;
  const withCash = active.filter((a) => a.cash_enabled);
  const transferBlock = withCash.length < 2 ? "Ative o caixa de pelo menos duas contas para transferir entre elas." : null;
  const newBlock = institutions.isLoading
    ? "Carregando as instituições..."
    : (institutions.data ?? []).length === 0
      ? "Cadastre uma instituição em Ativos antes de criar uma conta."
      : null;

  function open(next: "transfer" | "new") {
    setNotice(null);
    setForm(next);
  }
  function close(from: "transfer" | "new", message?: MoneyTextPart[]) {
    focusBack.current = from;
    setForm(null);
    if (message) setNotice(message);
  }

  return (
    <div className="space-y-6">
      <Card>
        {accounts.isLoading || balance.isLoading ? (
          <Loading label="Carregando as contas..." />
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <Stat
              label="Caixa nas contas"
              value={<Money cents={balance.data?.total_cents ?? 0} />}
              hint="Dinheiro parado, ainda não investido. Fica fora do patrimônio investido e da alocação."
            />
            <Stat
              label="Capital aportado pelo caixa"
              value={<Money cents={capital.data?.contributed_cents ?? 0} />}
              hint={
                capital.data && (capital.data.deposits_cents > 0 || capital.data.withdrawals_cents > 0) ? (
                  <>
                    Depósitos <Money cents={capital.data.deposits_cents} /> − retiradas <Money cents={capital.data.withdrawals_cents} />, desde
                    que cada caixa foi ativado. Não é valor atual nem rendimento.
                  </>
                ) : (
                  "Depósitos − retiradas, desde que cada caixa foi ativado. Não é valor atual nem rendimento."
                )
              }
            />
            <Stat
              label="Contas com caixa ativado"
              value={`${withCash.length} de ${active.length}`}
              hint={active.length > withCash.length ? "Ative as demais quando quiser acompanhar o dinheiro parado nelas." : "Todas as contas ativas."}
            />
          </div>
        )}
      </Card>

      <CashError error={accounts.error ?? balance.error} />
      {accounts.error && (
        <Button variant="secondary" size="sm" onClick={() => void accounts.refetch()}>
          Tentar de novo
        </Button>
      )}

      {form === null && (
        <div role="group" aria-label="Ações das contas" className="flex flex-wrap items-center gap-3">
          <Button
            ref={transferRef}
            variant="secondary" size="sm"
            disabled={transferBlock !== null}
            aria-describedby={transferBlock ? "transferir-motivo" : undefined}
            onClick={() => open("transfer")}
          >
            Transferir entre contas
          </Button>
          <Button
            ref={newRef}
            variant="secondary" size="sm"
            disabled={newBlock !== null}
            aria-describedby={newBlock ? "nova-conta-motivo" : undefined}
            onClick={() => open("new")}
          >
            Nova conta
          </Button>
          {(transferBlock || newBlock) && accounts.data && (
            <div className="w-full space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              {transferBlock && <p id="transferir-motivo">{transferBlock}</p>}
              {newBlock && <p id="nova-conta-motivo">{newBlock}</p>}
            </div>
          )}
        </div>
      )}
      {form === "transfer" && (
        <TransferForm
          accounts={active}
          onCancel={() => close("transfer")}
          onDone={(message) => close("transfer", message)}
        />
      )}
      {form === "new" && (
        <NewAccountForm
          institutions={institutions.data ?? []}
          onCancel={() => close("new")}
          onDone={(account) => close("new", [`Conta ${account.name} criada. Abra a conta e ative o caixa para acompanhar o dinheiro parado nela.`])}
        />
      )}
      {/* A região de status existe desde o início, para o aviso ser anunciado quando o texto chegar. */}
      <div role="status" aria-live="polite">
        {notice && (
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            <MoneyText parts={notice} />
          </p>
        )}
      </div>

      {accounts.data && active.length > 0 && withCash.length === 0 && (
        <Notice>
          <strong>Comece ativando o caixa</strong> da conta onde você deixa dinheiro parado (ex.: o saldo da corretora antes de comprar). Você
          informa o saldo do extrato uma vez; depois, depósitos, compras e proventos daquela conta passam a atualizar o caixa sozinhos.
        </Notice>
      )}

      <Card
        title="Suas contas"
        action={
          archived.length > 0 && (
            <Button variant="ghost" size="sm" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Esconder arquivadas" : `Mostrar arquivadas (${archived.length})`}
            </Button>
          )
        }
      >
        {accounts.isLoading && <Loading />}
        {accounts.data && all.length === 0 && (
          <Empty>
            Nenhuma conta ainda. Cada instituição que você cadastra ganha uma conta com o mesmo nome.{" "}
            <Link to="/carteira/ativos" className="font-medium text-blue-700 hover:underline dark:text-blue-300">
              Cadastrar instituição em Ativos
            </Link>
          </Empty>
        )}
        {accounts.data && all.length > 0 && shown.length === 0 && <Empty>Todas as contas estão arquivadas. Use “Mostrar arquivadas”.</Empty>}
        {shown.length > 0 && (
          <ul aria-label="Contas" className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                institutionName={institutionName.get(account.institution_id)}
                assetsCount={assets.data ? (assetsByAccount.get(account.id) ?? 0) : null}
                contributedCents={contributed.get(account.id)}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
