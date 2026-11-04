import { useState } from "react";
import { EarningsCard, hasEarningsData, useEarnings } from "@/features/earnings";
import type { RangeKey } from "@/features/history";
import { usePortfolioSummary } from "@/features/portfolio";
import { ReserveSummary } from "@/features/reserve";
import { ButtonLink, Card, cx, ErrorBox, Loading } from "@/shared/ui";
import { usePreferences } from "@/shared/lib/preferences";
import { ArrowRightIcon } from "@/shared/ui/icons";
import { AllocationCard } from "./components/AllocationCard";
import { NextStepCard } from "./components/NextStep";
import { PatrimonyCard } from "./components/PatrimonyCard";
import { PerformanceCard } from "./components/PerformanceCard";
import { StreakSummary } from "./components/StreakSummary";
import { hello, longDate } from "./lib/header";

export function OverviewPage() {
  const { name } = usePreferences();
  const [range, setRange] = useState<RangeKey>("12m");
  const summary = usePortfolioSummary();
  const earnings = useEarnings();
  // Sem dados de rendimento (nenhum ativo), o desempenho ocupa a linha sozinho, sem buraco ao lado.
  const showEarnings = !earnings.isSuccess || hasEarningsData(earnings.data);

  const total = summary.data;

  if (summary.isLoading) return <Loading />;

  return (
    <>
      <header className="mb-8">
        <p className="text-base text-ink-2">{longDate()}</p>
        <h1 className="mt-1 font-serif text-3xl sm:text-title">{hello(name)}</h1>
      </header>

      <ErrorBox error={summary.error} />

      {total && total.assets_count === 0 ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,24rem)]">
          <Card>
            <h2 className="font-serif text-3xl">Comece pela sua primeira posição</h2>
            <p className="mt-3 max-w-xl text-base text-ink-2">
              Cadastre um ativo (qualquer instituição) e, de tempos em tempos, atualize os saldos. Com isso você passa a ver o
              patrimônio, a comparação com a meta e a evolução ao longo do tempo, inclusive contra o CDI.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink to="/carteira/ativos?novo=1">
                Cadastrar ativo <ArrowRightIcon className="size-4" />
              </ButtonLink>
              <ButtonLink to="/carteira/atualizar" variant="secondary">
                Atualizar saldos
              </ButtonLink>
            </div>
          </Card>
          <NextStepCard />
        </div>
      ) : (
        total && (
          <div className="space-y-6">
            <PatrimonyCard total={total} range={range} onRangeChange={setRange} />

            <NextStepCard />

            <div className={cx("grid grid-cols-[minmax(0,1fr)] items-start gap-6", showEarnings && "lg:grid-cols-2")}>
              <PerformanceCard range={range} />
              {showEarnings && <EarningsCard />}
            </div>

            <AllocationCard />

            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2">
              <ReserveSummary />
              <StreakSummary />
            </div>
          </div>
        )
      )}
    </>
  );
}
