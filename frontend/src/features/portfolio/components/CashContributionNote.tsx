import { Link } from "react-router-dom";
import { Money } from "@/shared/ui";
import { beforeOpeningText, type CashLink } from "../lib/cashLink";

/**
 * Aviso de um aporte numa conta com caixa ativado: diz que ele também entra no caixa e deixa escolher entre
 * dinheiro novo (padrão) e "usar o dinheiro que já está no caixa", que evita contar o mesmo dinheiro duas vezes.
 */
export function CashContributionNote({
  link,
  assetName,
  cents,
  useCash,
  onUseCashChange,
  problem,
  problemId,
}: {
  link: CashLink;
  assetName: string;
  cents: number;
  useCash: boolean;
  onUseCashChange: (value: boolean) => void;
  problem: string | null;
  problemId: string;
}) {
  if (link.kind === "none" || cents <= 0) return null;
  const { account } = link;
  if (link.kind === "before") {
    return <p className="text-xs text-slate-600 dark:text-slate-400">{beforeOpeningText(account)}</p>;
  }

  return (
    <div className="space-y-2 rounded-lg border border-blue-500/40 bg-blue-50/60 p-3 text-sm text-slate-700 dark:bg-blue-950/20 dark:text-slate-300">
      <p>
        Este aporte também entra no caixa da conta <strong>{account.name}</strong>.{" "}
        {useCash && problem ? (
          <>Usando o dinheiro que já está lá, ele sairia do caixa, mas o caixa de hoje não cobre o valor.</>
        ) : useCash ? (
          <>
            Usando o dinheiro que já está lá, ele sai do caixa (de <Money cents={account.balance_cents} /> para{" "}
            <Money cents={account.balance_cents - cents} />) e o capital aportado não muda.
          </>
        ) : (
          <>
            Como dinheiro novo, vira um depósito e uma compra de <Money cents={cents} />: o caixa não muda e o capital aportado sobe{" "}
            <Money cents={cents} />.
          </>
        )}
      </p>
      <label className="flex min-h-10 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-blue-600"
          checked={useCash}
          onChange={(e) => onUseCashChange(e.target.checked)}
          aria-describedby={problem ? problemId : undefined}
        />
        <span>
          Usar o dinheiro que já está no caixa de {account.name} (<Money cents={account.balance_cents} />)
          <span className="sr-only"> para o aporte em {assetName}</span>
        </span>
      </label>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Marque se você já registrou o depósito desse dinheiro ou se ele veio de uma venda ou de um provento. Fora do fechamento, o mesmo
        caminho é{" "}
        <Link to={`/carteira/contas/${account.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-300">
          Comprar ativo com o caixa
        </Link>
        .
      </p>
      {problem && (
        <p id={problemId} className="text-xs font-medium text-red-700 dark:text-red-300">
          {problem}
        </p>
      )}
    </div>
  );
}
