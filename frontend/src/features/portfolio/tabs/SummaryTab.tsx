import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ReserveSummary } from "@/features/reserve";
import { formatSignedPercent } from "@/shared/lib/format";
import { Loading, Money } from "@/shared/ui";
import { Figure } from "@/shared/ui/Figure";
import { AssetDistributionCard } from "../components/AssetDistributionCard";
import { BalancesFreshness } from "../components/BalancesFreshness";
import { CategoryBreakdown } from "../components/CategoryBreakdown";
import { CompositionCard } from "../components/CompositionCard";
import { usePortfolioSummary } from "../hooks";
import { netWorthCents, outsideCashCents, separatedCents } from "../lib/separated";

/** Endereços da versão anterior (/carteira?fechar=1 etc.) levam à seção que hoje os abriga. */
function legacyTarget(params: URLSearchParams): string | null {
  if (params.get("fechar")) return "/carteira/fechamento";
  if (params.get("novo")) return "/carteira/ativos?novo=1";
  const category = params.get("categoria");
  if (category) return `/carteira/ativos?categoria=${encodeURIComponent(category)}`;
  return null;
}

/** Resumo da carteira: os totais, a carteira por categoria contra a meta, a reserva, a frescura dos saldos e a composição. */
export function SummaryTab() {
  const [params] = useSearchParams();
  const summary = usePortfolioSummary();

  const legacy = legacyTarget(params);
  if (legacy) return <Navigate to={legacy} replace />;

  const total = summary.data;
  const gain = total ? total.total_current_cents - total.total_invested_cents : 0;
  const up = total?.return_bps == null || total.return_bps >= 0;
  const separated = total ? separatedCents(total) : 0;
  const outsideCash = total ? outsideCashCents(total) : 0;

  return (
    <div className="space-y-6">
      <section aria-label="Totais da carteira" className="rounded-card bg-soil p-5 sm:p-7">
        {summary.isLoading ? (
          <Loading />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(11rem,100%),1fr))] gap-x-8 gap-y-6">
            <Figure
              label={separated > 0 ? "Patrimônio total" : "Patrimônio atual"}
              value={<Money cents={total ? netWorthCents(total) : 0} />}
              hint={
                total ? (
                  <>
                    {total.assets_count} {total.assets_count === 1 ? "ativo" : "ativos"}
                    {total.reserve_current_cents > 0 && (
                      <>
                        , com <Money cents={total.reserve_current_cents} /> de reserva
                      </>
                    )}
                    {separated > 0 && (
                      <>
                        . Inclui <Money cents={separated} /> separado, ainda não investido
                      </>
                    )}
                  </>
                ) : undefined
              }
            />
            <Figure label="Investido" value={<Money cents={total?.total_invested_cents ?? 0} />} hint="dinheiro que entrou" />
            <Figure
              label="Rendimento"
              tone={total?.return_bps != null && up ? "good" : undefined}
              value={
                total?.return_bps == null ? (
                  "—"
                ) : (
                  <>
                    <span aria-hidden>{up ? "▲" : "▼"} </span>
                    {formatSignedPercent(total.return_bps)}
                  </>
                )
              }
              hint={
                total ? (
                  <>
                    <Money cents={gain} /> {gain >= 0 ? "a mais" : "a menos"} que o investido
                  </>
                ) : undefined
              }
            />
            <Figure label="Proventos recebidos" value={<Money cents={total?.proventos_cents ?? 0} />} hint="dividendos e rendimentos de FIIs" />
          </div>
        )}
        {total && Boolean(outsideCash) && (
          <p className="mt-6 text-base text-ink-2">
            {separated > 0 ? "Caixa livre nas contas: " : "Caixa nas contas: "}
            <strong className="font-medium text-ink"><Money cents={outsideCash} /></strong>, dinheiro parado ainda
            não investido{separated > 0 ? " e sem destino" : ""}, fora do patrimônio acima.{" "}
            <Link to="/carteira/contas" className="font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink">
              Ver contas e caixa
            </Link>
          </p>
        )}
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <CategoryBreakdown />
        <div className="space-y-6">
          <ReserveSummary withAssets />
          <BalancesFreshness />
        </div>
      </div>

      <AssetDistributionCard />

      {total && <CompositionCard summary={total} />}
    </div>
  );
}
