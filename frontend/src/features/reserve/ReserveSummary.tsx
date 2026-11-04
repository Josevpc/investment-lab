import { Link } from "react-router-dom";
import { formatPercent } from "@/shared/lib/format";
import { Badge, Card, ErrorBox, Loading, Money } from "@/shared/ui";
import { PebbleBar } from "@/shared/ui/PebbleBar";
import { useReserve } from "./hooks";

const linkClass = "inline-flex min-h-10 items-center font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink";

/**
 * Reserva de emergência em resumo (Visão geral e Carteira): quanto tem, quanto falta e para onde ir.
 * `withAssets` lista os ativos da reserva com o atalho "Usei a reserva", que leva ao resgate já com o ativo.
 * A meta se define em Configurações.
 */
export function ReserveSummary({ withAssets = false }: { withAssets?: boolean }) {
  const reserve = useReserve();
  const r = reserve.data;

  return (
    <Card title="Reserva de emergência">
      {reserve.isLoading && <Loading />}
      <ErrorBox error={reserve.error} />

      {r && r.goal_cents > 0 && (
        <div className="space-y-4">
          <div>
            <p className="font-serif text-4xl leading-none sm:text-5xl">
              <Money cents={r.balance_cents} />
            </p>
            <p className="mt-2 text-base text-ink-2">
              de <Money cents={r.goal_cents} /> de meta
            </p>
          </div>
          <PebbleBar role="progressbar" valueBps={r.progress_bps} label="Progresso da reserva de emergência" />
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            {r.reached ? (
              <Badge tone="good">Reserva completa</Badge>
            ) : (
              <Badge tone="warn">
                Faltam&nbsp;
                <Money cents={r.remaining_cents} />
              </Badge>
            )}
            <span className="tabular">{formatPercent(r.progress_bps)} da meta</span>
          </p>
          {r.coverage_months !== null && (
            <p className="text-sm text-ink-2">Você tem {String(r.coverage_months).replace(".", ",")} meses de salário guardados.</p>
          )}
          <p className="text-sm text-ink-3">Fica fora da alocação, para não distorcer o rebalanceamento.</p>

          {withAssets && r.assets.length > 0 && (
            <ul aria-label="Ativos da reserva" className="space-y-2">
              {r.assets.map((asset) => (
                <li key={asset.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-field bg-raise px-4 py-2 text-sm">
                  <span className="min-w-0">
                    {asset.name} <span className="text-ink-3">· {asset.institution_name}</span>
                    <span className="block font-medium text-ink">
                      <Money cents={asset.current_cents} />
                    </span>
                  </span>
                  <Link
                    to={`/carteira/movimentacoes?novo=resgate&ativo=${asset.id}`}
                    aria-label={`Usei a reserva: registrar resgate de ${asset.name}`}
                    className={linkClass}
                  >
                    Usei a reserva
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link to="/carteira/retiradas" className={linkClass}>
            Ver todas as retiradas
          </Link>
        </div>
      )}

      {r && r.goal_cents === 0 && (
        <div className="space-y-3">
          <p className="text-base text-ink-2">
            Defina quanto você quer guardar para imprevistos. A reserva fica separada da alocação e o progresso aparece aqui.
          </p>
          <Link to="/configuracoes#reserva" className={linkClass}>
            Definir a meta da reserva
          </Link>
        </div>
      )}
    </Card>
  );
}
