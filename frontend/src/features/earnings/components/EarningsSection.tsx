import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { formatMonth, formatPercent } from "@/shared/lib/format";
import { Card, cx, Empty, ErrorBox, Loading, Money } from "@/shared/ui";
import { GoalBar } from "@/shared/ui/GoalBar";
import { MoneyText } from "@/shared/ui/MoneyText";
import { useEarnings } from "../hooks";
import { followsUpdateGap, GAP_NOTE, hasEarningsData, milestoneParts, monthShortLabel, nextMilestoneInfo, readMonth } from "../lib/earnings";
import type { Earnings, EarningsMonth, Milestone, MilestoneKind } from "../types";
import { Earned } from "./Earned";
import { WorkMinutesChart } from "./WorkMinutesChart";

export const SECTION_ID = "salario-do-dinheiro";

/** Faixa da tabela: fundo `raise` com as pontas arredondadas, sem linhas. */
const cell = "bg-raise px-3 py-3 first:rounded-l-field last:rounded-r-field";

const GROUPS: { kind: MilestoneKind; title: string }[] = [
  { kind: "first", title: "O começo" },
  { kind: "monthly_share", title: "Parte do seu salário em um mês" },
  { kind: "total_amount", title: "Rendimento acumulado" },
];

/** Metas: o salário do dinheiro (gráfico e mês a mês) ao lado da escada de conquistas. */
export function EarningsSection() {
  const earnings = useEarnings();
  const { hash } = useLocation();
  const data = earnings.data;
  const ready = hasEarningsData(data);

  // O link "Ver conquistas" da Visão geral aponta para cá; a seção só existe depois dos dados.
  useEffect(() => {
    if (ready && hash === `#${SECTION_ID}`) document.getElementById(SECTION_ID)?.scrollIntoView?.({ block: "start" });
  }, [ready, hash]);

  return (
    <div id={SECTION_ID} className={cx("scroll-mt-20", ready && "grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]")}>
      <Card title="Salário do seu dinheiro">
        <p className="-mt-2 mb-5 max-w-2xl text-base text-ink-2">
          Quanto seus investimentos renderam para você, sem contar o que você aportou. Cada marco é uma conquista do seu dinheiro
          trabalhando.
        </p>
        {earnings.isLoading && <Loading />}
        <ErrorBox error={earnings.error} />
        {earnings.isSuccess && !ready && (
          <Empty>
            Cadastre seus ativos e atualize os saldos no fim do mês: aqui aparecem quanto seu dinheiro rendeu e as conquistas dele.{" "}
            <Link to="/carteira/ativos?novo=1" className="font-medium text-ink underline underline-offset-2">
              Cadastrar ativo
            </Link>
          </Empty>
        )}
        {ready && (
          <div className="space-y-8">
            <WorkMinutesChart months={data.months} />
            <MonthsTable months={data.months} trackingSince={data.tracking_since} />
          </div>
        )}
      </Card>
      {ready && (
        <Card title="Conquistas">
          <Milestones data={data} />
        </Card>
      )}
    </div>
  );
}

function Milestones({ data }: { data: Earnings }) {
  const next = nextMilestoneInfo(data);
  const achieved = data.milestones.filter((m) => m.achieved_month).length;

  return (
    <div>
      <p className="-mt-2 text-base text-ink-2">
        {achieved} de {data.milestones.length} marcos conquistados.
      </p>
      <div className="mt-5 space-y-6">
        {GROUPS.map((group) => {
          const items = data.milestones.filter((m) => m.kind === group.kind);
          if (items.length === 0) return null;
          return (
            <div key={group.kind} className="min-w-0">
              <h3 className="text-base font-medium">{group.title}</h3>
              <ol className="mt-2 space-y-1.5">
                {items.map((m) => (
                  <MilestoneItem key={m.key} milestone={m} next={next?.milestone.key === m.key ? next : null} />
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MilestoneItem({ milestone, next }: { milestone: Milestone; next: ReturnType<typeof nextMilestoneInfo> }) {
  const done = milestone.achieved_month !== null;
  return (
    // Conquistado: jade suave. Próximo: mel suave (é uma meta). A conquistar: neutro. O texto também diz o estado.
    <li className={cx("rounded-field px-4 py-3 text-sm", done && "bg-jade-t", next && "bg-gold-t", !done && !next && "bg-raise")}>
      <p className={cx("text-base", done ? "font-medium" : "text-ink-2")}>
        <span aria-hidden>{done ? "✓ " : next ? "→ " : "○ "}</span>
        <MoneyText parts={milestoneParts(milestone)} />
      </p>
      <p className="mt-0.5 text-sm text-ink-2">
        {done ? `Conquistado em ${formatMonth(milestone.achieved_month ?? "")}` : next ? "Próximo marco" : "A conquistar"}
      </p>
      {next && (
        <div className="mt-3">
          <GoalBar bps={next.progressBps} label="Caminho até o próximo marco" />
          <p className="mt-1.5 text-sm text-ink-2">
            <span className="tabular font-semibold">{formatPercent(next.progressBps)}</span> do caminho ·{" "}
            <MoneyText parts={next.detail} />
          </p>
          {next.currentMonth && <p className="mt-1 text-sm text-ink-2">{next.currentMonth}</p>}
        </div>
      )}
    </li>
  );
}

function MonthsTable({ months, trackingSince }: { months: EarningsMonth[]; trackingSince: string | null }) {
  const rows = [...months].reverse();
  const largest = Math.max(1, ...rows.map((m) => Math.abs(m.earned_cents)));

  if (rows.length === 0) return <Empty>Os meses aparecem aqui depois da primeira atualização de saldo.</Empty>;

  return (
    // No celular a tabela rola de lado dentro da própria área (focável, para rolar pelo teclado).
    <div className="min-w-0 overflow-x-auto" tabIndex={0} role="region" aria-label="Salário do seu dinheiro mês a mês">
      <table className="w-full border-separate border-spacing-y-1.5 text-sm sm:min-w-[34rem]">
        <caption className="mb-2 text-left">
          <span className="font-serif text-xl">Mês a mês</span>
          <span className="mt-1 block text-sm font-normal text-ink-3">
            Últimos {rows.length === 1 ? "mês" : `${rows.length} meses`}, pelas atualizações de saldo. O mês aparece sem valor quando o
            saldo não foi atualizado nele; o mês seguinte com atualização concentra o rendimento do período.
          </span>
        </caption>
        <thead className="text-left text-ink-3">
          <tr>
            <th scope="col" className="px-3 pb-1 font-medium">Mês</th>
            <th scope="col" className="px-3 pb-1 font-medium">Rendeu</th>
            <th scope="col" className="hidden px-3 pb-1 text-right font-medium sm:table-cell">Valorização</th>
            <th scope="col" className="hidden px-3 pb-1 text-right font-medium sm:table-cell">Proventos</th>
            <th scope="col" className="px-3 pb-1 text-right font-medium">% do salário</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.month}>
              <th scope="row" className={cx(cell, "text-left font-medium sm:whitespace-nowrap")}>
                {monthShortLabel(m)}
              </th>
              {readMonth(m) === "no_update" ? (
                <td colSpan={4} className={cx(cell, "text-ink-3")}>
                  sem atualização de saldo
                </td>
              ) : (
                <>
                  <td className={cell}>
                    <Earned cents={m.earned_cents} className="font-semibold" />
                    <span aria-hidden className="mt-1 block h-1.5 w-full max-w-32 rounded-full bg-card">
                      <span
                        className={cx("block h-full rounded-full", m.earned_cents >= 0 ? "bg-jade" : "bg-ink-3")}
                        style={{ width: `${Math.round((Math.abs(m.earned_cents) * 100) / largest)}%` }}
                      />
                    </span>
                    {m.has_update && (
                      <span className="mt-1 block text-sm text-ink-3 sm:hidden">
                        Valorização <Money cents={m.appreciation_cents} /> · proventos <Money cents={m.proventos_cents} />
                      </span>
                    )}
                    {followsUpdateGap(months, m.month, trackingSince) && (
                      <span className="mt-1 block text-sm text-ink-3">{GAP_NOTE}</span>
                    )}
                  </td>
                  <td className={cx(cell, "hidden text-right sm:table-cell")}>
                    {m.has_update ? <Money cents={m.appreciation_cents} /> : <span className="text-sm text-ink-3">sem atualização</span>}
                  </td>
                  <td className={cx(cell, "hidden text-right sm:table-cell")}>
                    <Money cents={m.proventos_cents} />
                  </td>
                  <td className={cx(cell, "text-right")}>
                    {m.salary_share_bps === null ? (
                      <span className="text-sm text-ink-3">sem salário</span>
                    ) : (
                      <span className="tabular">{formatPercent(m.salary_share_bps)}</span>
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
