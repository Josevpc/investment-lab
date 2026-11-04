import { EarningsSection } from "@/features/earnings";
import { scrollBehavior } from "@/shared/lib/motion";
import { Button, ErrorBox, Loading, PageHeader } from "@/shared/ui";
import { GoalSettingsCard } from "./components/GoalSettingsCard";
import { NetWorthGoalCard, YearGoalCard } from "./components/GoalProgressCards";
import { ProjectionCard } from "./components/ProjectionCard";
import { StreakCard } from "./components/StreakCard";
import { useGoalSettings, useGoalsProgress } from "./hooks";

/** Leva a pessoa ao formulário "Definir metas" e já deixa o primeiro campo pronto para digitar. */
function goToGoalSettings() {
  document.getElementById("definir-metas")?.scrollIntoView?.({ behavior: scrollBehavior(), block: "start" });
  document.getElementById("meta-patrimonio")?.focus({ preventScroll: true });
}

/** Metas: o hábito de hoje (sequência), o caminho até as metas e o futuro que ele constrói. */
export function GoalsPage() {
  const progress = useGoalsProgress();
  const settings = useGoalSettings();

  return (
    <>
      <PageHeader
        title="Metas"
        subtitle="O que você quer alcançar, e o quanto já andou."
        action={
          settings.data && (
            <Button variant="secondary" onClick={goToGoalSettings}>
              Editar metas
            </Button>
          )
        }
      />
      {(progress.isLoading || settings.isLoading) && <Loading />}
      <ErrorBox error={progress.error ?? settings.error} />

      {progress.data && (
        <div className="space-y-6">
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2">
            <StreakCard progress={progress.data} />
            <div className="space-y-6">
              <NetWorthGoalCard net={progress.data.net_worth} />
              <YearGoalCard year={progress.data.year} month={progress.data.month} />
            </div>
          </div>
          <EarningsSection />
          <ProjectionCard pace={progress.data.contribution_pace} settings={settings.data} />
          {settings.data && <GoalSettingsCard settings={settings.data} />}
        </div>
      )}
    </>
  );
}
