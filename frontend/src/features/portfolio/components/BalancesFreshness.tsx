import { Link } from "react-router-dom";
import { formatDate, todayISO } from "@/shared/lib/format";
import { Badge, Card, ErrorBox, Loading } from "@/shared/ui";
import { useAssets } from "../hooks";
import { lastBalanceDate, STALE_AFTER_DAYS, staleAssets } from "../lib/staleBalances";

const SHOWN = 4;

/** "Saldos em dia?": quando foi a última atualização e quais ativos estão sem saldo novo há mais de 10 dias. */
export function BalancesFreshness() {
  const assets = useAssets(false);
  const list = assets.data ?? [];
  const last = lastBalanceDate(list);
  const stale = staleAssets(list, todayISO());
  const shown = stale.slice(0, SHOWN);

  return (
    <Card title="Saldos em dia?">
      {assets.isLoading && <Loading />}
      <ErrorBox error={assets.error} />

      {assets.isSuccess && list.length === 0 && (
        <p className="text-base text-ink-2">Quando você cadastrar ativos, aqui aparece se os saldos estão atualizados.</p>
      )}

      {assets.isSuccess && list.length > 0 && (
        <div className="space-y-4">
          <p className="text-base text-ink-2">
            Última atualização: <strong className="tabular font-medium text-ink">{last ? formatDate(last) : "—"}</strong>
          </p>

          {stale.length === 0 ? (
            <p className="flex flex-wrap items-center gap-2 text-base text-ink-2">
              <Badge tone="good">Em dia</Badge> Nenhum ativo está há mais de {STALE_AFTER_DAYS} dias sem saldo novo.
            </p>
          ) : (
            <div role="status" className="space-y-3 rounded-field bg-clay-t px-4 py-3 text-base text-ink">
              <p>
                {stale.length === 1 ? "1 ativo está" : `${stale.length} ativos estão`} sem saldo novo há mais de {STALE_AFTER_DAYS} dias:
              </p>
              <ul className="space-y-1 text-sm">
                {shown.map(({ asset, days }) => (
                  <li key={asset.id}>
                    <span className="font-medium">{asset.name}</span> · {asset.institution_name}, há {days} dias
                  </li>
                ))}
              </ul>
              {stale.length > shown.length && <p className="text-sm">e mais {stale.length - shown.length}.</p>}
              <Link
                to="/carteira/atualizar"
                className="inline-flex min-h-10 items-center font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink"
              >
                Atualizar agora
              </Link>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
