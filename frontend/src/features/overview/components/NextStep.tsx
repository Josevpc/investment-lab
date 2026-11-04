import { Link, useLocation } from "react-router-dom";
import { useComparison, type HoldStatus } from "@/features/allocation";
import { planProgress, useContributions } from "@/features/contributions";
import { useSnapshots } from "@/features/history";
import { useMonthSummary, usePortfolioSummary } from "@/features/portfolio";
import { currentMonth } from "@/shared/lib/format";
import { ButtonLink, Loading } from "@/shared/ui";
import { MoneyText } from "@/shared/ui/MoneyText";
import { ArrowRightIcon, TargetIcon } from "@/shared/ui/icons";
import { nextStep, type NextStep } from "../lib/nextStep";

/** A ação que faz sentido agora, calculada dos dados (ou null enquanto eles carregam). */
export function useNextStep(): NextStep | null {
  const summary = usePortfolioSummary();
  const contributions = useContributions();
  const snapshots = useSnapshots();
  const month = currentMonth();
  const monthSummary = useMonthSummary(month);
  // Quais categorias estão todas mantidas: a mesma fonte do acompanhamento do plano, para o "Faltam"
  // bater com ele. Enquanto carrega, o passo espera; se falhar, o valor não é mostrado.
  const comparison = useComparison();

  if (summary.isLoading || contributions.isLoading || snapshots.isLoading || monthSummary.isLoading || comparison.isLoading) {
    return null;
  }

  const items = comparison.data?.items ?? [];
  const holdStatus: Record<string, HoldStatus> = Object.fromEntries(items.map((i) => [i.class_key, i.hold_status]));
  const allHeld = items.length > 0 && items.every((i) => i.hold_status === "all");

  const thisMonth = (contributions.data ?? []).find((c) => c.month === month);
  const progress =
    thisMonth && thisMonth.plan.length > 0 && monthSummary.data
      ? planProgress(
          thisMonth,
          { byClass: monthSummary.data.by_class, reserveCents: monthSummary.data.reserve_cents },
          holdStatus,
        )
      : null;
  const largest = progress ? [...progress.rows].sort((a, b) => b.remainingCents - a.remainingCents)[0] : undefined;

  return nextStep({
    plan: progress
      ? {
          remainingCents: progress.remainingCents,
          largestClass: largest && largest.remainingCents > 0 ? largest.name : null,
          amountUnknown: comparison.isError,
        }
      : null,
    allHeld,
    month,
    assetsCount: summary.data?.assets_count ?? 0,
    hasContribution: (contributions.data ?? []).some((c) => c.month === month),
    snapshotDates: (snapshots.data ?? []).map((s) => s.date),
  });
}

function StepTitle({ title }: { title: NextStep["title"] }) {
  return typeof title === "string" ? title : <MoneyText parts={title} />;
}

/**
 * A faixa de mel da Visão geral: o passo seguinte da jornada, em frase grande, com a ação principal da tela em
 * tinta. No passo de aportar, o atalho "Ver a divisão" leva a como o valor se reparte entre as categorias.
 */
export function NextStepCard() {
  const step = useNextStep();
  if (!step) {
    return (
      <section aria-label="Próximo passo" className="rounded-card bg-gold-t p-6 sm:p-8">
        <Loading label="Carregando o próximo passo..." />
      </section>
    );
  }
  return (
    <section aria-label="Próximo passo" className="rise rounded-card bg-gold-t p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-5">
        <div className="min-w-0 flex-1 basis-80">
          <p className="flex items-center gap-2 text-base text-ink-2">
            <TargetIcon className="size-5 text-gold" />
            Próximo passo
          </p>
          <h2 className="mt-3 font-serif text-[1.75rem] leading-tight">
            <StepTitle title={step.title} />
          </h2>
          <p className="mt-2 max-w-2xl text-base text-ink-2">{step.text}</p>
          {step.kind === "invest" && (
            <Link
              to="/aporte"
              className="mt-2 inline-flex min-h-10 items-center font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink"
            >
              Ver a divisão
            </Link>
          )}
        </div>
        <ButtonLink to={step.to}>
          {step.cta}
          <ArrowRightIcon className="size-4" />
        </ButtonLink>
      </div>
    </section>
  );
}

/**
 * Faixa discreta nas outras telas. Some quando o passo é fazer o que a própria tela já faz, para
 * não mandar a pessoa para onde ela já está.
 */
export function NextStepBanner() {
  const step = useNextStep();
  const { pathname } = useLocation();
  if (!step || step.to.split("?")[0] === pathname) return null;
  return (
    <aside
      aria-label="Próximo passo"
      className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card bg-gold-t px-5 py-4"
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-gold">
        <TargetIcon className="size-4" />
      </span>
      <p className="min-w-48 flex-1 text-sm">
        <span className="font-semibold">
          Próximo passo: <StepTitle title={step.title} />.
        </span>{" "}
        <span className="text-ink-2">{step.text}</span>
      </p>
      {/* Secundário: nas outras telas a ação principal é a da própria tela, e só ela leva a tinta. */}
      <ButtonLink to={step.to} size="sm" variant="secondary">
        {step.cta}
        <ArrowRightIcon className="size-4" />
      </ButtonLink>
    </aside>
  );
}
