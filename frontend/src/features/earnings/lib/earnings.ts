import type { Celebration } from "@/shared/lib/celebrate";
import { formatBRL, formatDate, formatMonth, formatPercent, monthName } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import type { Earnings, EarningsMonth, EarningsPace, Milestone } from "../types";

/** Até R$ 1,00 o ganho é real, mas dizer "rendeu R$ 0,40" soaria irônico: falamos que o dinheiro começou a trabalhar. */
export const SMALL_GAIN_CENTS = 100;

export const ACHIEVEMENTS_HREF = "/metas#salario-do-dinheiro";

/** Há o que mostrar: ativos cadastrados e uma resposta no formato esperado. */
export function hasEarningsData(e: Earnings | undefined | null): e is Earnings {
  return Boolean(e && e.tracking_since && e.current_month && e.total && Array.isArray(e.milestones) && Array.isArray(e.months));
}

/** 2 -> "2 min"; 200 -> "3 h 20 min"; 120 -> "2 h". */
export function formatWorkMinutes(minutes: number): string {
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * "17/10": até que dia o rendimento do mês vale. É o último saldo digitado, que pode ser antes de hoje
 * (quem atualiza toda semana vê "até 13/10" numa sexta, 17); sem atualização, cai para a data de hoje.
 */
function measuredDay(m: EarningsMonth): string {
  return formatDate(m.measured_through ?? m.through).slice(0, 5);
}

/** "Salário de outubro (até 17/10)" no mês corrente; "Salário de setembro" nos completos. */
export function monthTitle(m: EarningsMonth): string {
  const name = monthName(m.month);
  if (m.partial) return `Salário de ${name} (até ${measuredDay(m)})`;
  return `Salário de ${name}`;
}

/** "out/2026" ou "out/2026 (até 17/10)", para tabelas. */
export function monthShortLabel(m: EarningsMonth): string {
  if (m.partial) return `${formatMonth(m.month)} (até ${measuredDay(m)})`;
  return formatMonth(m.month);
}

/**
 * Como ler um mês. O rendimento cai no mês em que o saldo foi atualizado, então um mês sem atualização
 * (e sem provento) não "rendeu zero": simplesmente ainda não se sabe.
 */
export type MonthReading = "no_update" | "negative" | "starting" | "positive";

export function readMonth(m: EarningsMonth): MonthReading {
  if (!m.has_update && m.earned_cents === 0) return "no_update";
  if (m.earned_cents < 0) return "negative";
  if (m.earned_cents <= SMALL_GAIN_CENTS) return "starting";
  return "positive";
}

/**
 * "starting": o caso de quem acabou de cadastrar a carteira (nenhum mês completo e ganho de centavos).
 * Em vez de zeros, o cartão explica quando o primeiro salário aparece.
 */
export function cardState(e: Earnings): "starting" | "full" {
  const small = (cents: number) => cents >= 0 && cents <= SMALL_GAIN_CENTS;
  if (e.last_complete_month === null && small(e.total.earned_cents) && small(e.current_month.earned_cents)) return "starting";
  return "full";
}

/** Tom respeitoso para o mês que recuou: nada de alarme, e o contexto do que já rendeu. */
export function negativeMessage(e: Earnings): MoneyTextPart[] | null {
  const current = e.current_month;
  if (readMonth(current) !== "negative") return null;
  const total = e.total.earned_cents;
  if (total < 0) {
    return [
      "Por enquanto seus investimentos estão ",
      { cents: -total },
      " abaixo do que você investiu. Oscilações são comuns, sobretudo em renda variável; acompanhe ao longo dos meses.",
    ];
  }
  if (total <= SMALL_GAIN_CENTS) {
    return [
      "Mês de oscilação: seus investimentos recuaram ",
      { cents: -current.earned_cents },
      ". Faz parte; o rendimento se vê ao longo dos meses.",
    ];
  }
  return [
    "Mês de oscilação: seus investimentos recuaram ",
    { cents: -current.earned_cents },
    ". Faz parte; desde o início seu dinheiro já rendeu ",
    { cents: total },
    ".",
  ];
}

export interface CurrentMonthSalary {
  month: string;
  /** "17/10": até que dia vale. */
  through: string;
  share: string;
  work: string | null;
}

/**
 * O mês em andamento contra o salário, para acompanhar durante o mês (e não só depois de fechado).
 * Só quando já há um ganho de verdade: mês parado, em queda ou com centavos não gera comparação.
 */
export function currentMonthSalary(e: Earnings): CurrentMonthSalary | null {
  const m = e.current_month;
  if (!e.salary || !m.has_update || readMonth(m) !== "positive" || m.salary_share_bps == null) return null;
  return {
    month: monthName(m.month),
    through: measuredDay(m),
    share: formatPercent(m.salary_share_bps),
    work: m.work_minutes == null ? null : formatWorkMinutes(m.work_minutes),
  };
}

/** O ritmo por dia do mês em andamento, até o último saldo digitado. */
export function currentPaceText(m: EarningsMonth): MoneyTextPart[] | null {
  if (m.per_day_cents == null) return null;
  const prefix = `Em ${monthName(m.month)}, até ${measuredDay(m)}: `;
  if (m.per_day_cents > 0) return [`${prefix}≈ `, { cents: m.per_day_cents }, " por dia"];
  if (m.per_day_cents === 0) return [`${prefix}centavos por dia`];
  return [`${prefix}oscilação, sem ganho médio por dia`];
}

export interface WorkMinutesRow {
  month: string;
  /** "out/2026" ou "out/2026 (até 20/10)": para a tabela e o tooltip. */
  label: string;
  /** "out/26": para o eixo. */
  axis: string;
  /** Minutos de trabalho equivalentes ao que o dinheiro rendeu no mês; null quando não há o que medir. */
  minutes: number | null;
  partial: boolean;
  /** "20/10": até que dia vale o mês em andamento (null nos completos). */
  throughLabel: string | null;
  earnedCents: number;
  /** Por que o mês não tem barra (null quando tem). */
  reason: string | null;
}

/** Um ponto por mês para o gráfico de minutos de trabalho. Mês sem barra diz o motivo, nunca vira "zero". */
export function workMinutesRows(months: readonly EarningsMonth[]): WorkMinutesRow[] {
  return months.map((m) => {
    let reason: string | null = null;
    if (readMonth(m) === "no_update") reason = "sem atualização de saldo";
    else if (m.salary_share_bps == null) reason = "sem salário registrado";
    else if (m.earned_cents <= 0 || m.work_minutes == null) reason = "sem ganho no mês";
    return {
      month: m.month,
      label: monthShortLabel(m),
      axis: formatMonth(m.month).replace("/20", "/"),
      minutes: reason === null ? m.work_minutes : null,
      partial: m.partial,
      throughLabel: m.partial ? measuredDay(m) : null,
      earnedCents: m.earned_cents,
      reason,
    };
  });
}

/** Detalhe do total: o ganho que os ativos já traziam antes de entrarem no app. */
export function totalDetail(e: Earnings): MoneyTextPart[] | null {
  if (e.total.before_tracking_cents <= 0) return null;
  return ["Inclui ", { cents: e.total.before_tracking_cents }, " que seus ativos já tinham rendido antes do cadastro."];
}

/** O ritmo médio por dia, com a base do cálculo dita em palavras. */
export function paceText(pace: EarningsPace): { main: MoneyTextPart[]; basis: string } {
  const range = pace.from_month === pace.to_month ? formatMonth(pace.to_month) : `${formatMonth(pace.from_month)} a ${formatMonth(pace.to_month)}`;
  const basis = `Média de ${range}, pelas atualizações de saldo.`;
  if (pace.per_day_cents > 0) return { main: ["≈ ", { cents: pace.per_day_cents }, " por dia, mesmo enquanto você dorme"], basis };
  if (pace.per_day_cents === 0) return { main: ["Seu dinheiro começou a trabalhar: por enquanto, centavos por mês"], basis };
  return { main: ["Período de oscilação: ainda sem ganho médio por dia"], basis };
}

export type SalaryComparison =
  | { kind: "no_salary" }
  | { kind: "waiting" }
  | { kind: "flat"; month: string }
  | { kind: "dip"; month: string }
  | { kind: "ok"; month: string; share: string; work: string | null };

/** Quanto o rendimento do último mês completo representa do salário, e em tempo de trabalho. */
export function salaryComparison(e: Earnings): SalaryComparison {
  if (!e.salary) return { kind: "no_salary" };
  const vs = e.vs_salary;
  if (!vs) return { kind: "waiting" };
  if (vs.earned_cents === 0) return { kind: "flat", month: monthName(vs.month) };
  if (vs.earned_cents < 0) return { kind: "dip", month: vs.month };
  return {
    kind: "ok",
    month: monthName(vs.month),
    share: formatPercent(vs.share_bps),
    work: vs.work_minutes === null ? null : formatWorkMinutes(vs.work_minutes),
  };
}

/** Nome do marco, para a escada de conquistas. */
export function milestoneParts(m: Milestone): MoneyTextPart[] {
  if (m.kind === "monthly_share") return [`${formatPercent(m.threshold ?? 0)} do seu salário em um mês`];
  if (m.kind === "total_amount") return [{ cents: m.threshold ?? 0 }, " rendidos desde o início"];
  return ["Primeiro salário do seu dinheiro"];
}

/** Nome curto, para "Próximo marco: ...". */
export function milestoneShortName(m: Milestone): string {
  if (m.kind === "monthly_share") return `${formatPercent(m.threshold ?? 0)} do seu salário`;
  if (m.kind === "total_amount") return `${formatBRL(m.threshold ?? 0)} rendidos no total`;
  return "o primeiro salário do seu dinheiro";
}

/**
 * A conquista mais recente (opcionalmente só as dos meses indicados). No mesmo mês, o primeiro salário vem
 * antes de tudo (é a conquista que inaugura as outras); fora ele, vale a de maior nível, que vem depois na lista.
 */
export function latestMilestone(milestones: readonly Milestone[], inMonths?: readonly string[]): Milestone | null {
  let latest: Milestone | null = null;
  for (const m of milestones) {
    if (!m.achieved_month || (inMonths && !inMonths.includes(m.achieved_month))) continue;
    if (!latest || m.achieved_month > (latest.achieved_month ?? "")) latest = m;
    else if (m.achieved_month === latest.achieved_month && latest.kind !== "first") latest = m;
  }
  return latest;
}

/** "2026-10" -> "2026-09"; "2027-01" -> "2026-12". */
export function previousMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Meses em que uma conquista ainda é "nova". Os marcos de % do salário e o primeiro salário só são medidos
 * em meses completos, então chegam com o mês anterior; o acumulado pode chegar no corrente. Mais antigo que
 * isso (ex.: depois de restaurar um backup) não solta confete.
 */
function recentMonths(e: Earnings): string[] {
  return [e.current_month.month, previousMonth(e.current_month.month)];
}

/** A maior fatia do salário que um mês completo já rendeu (bps), ou null sem mês completo com salário. */
export function bestCompleteShare(months: readonly EarningsMonth[]): number | null {
  let best: number | null = null;
  for (const m of months) {
    if (m.partial || m.salary_share_bps === null) continue;
    if (best === null || m.salary_share_bps > best) best = m.salary_share_bps;
  }
  return best;
}

export interface NextMilestoneInfo {
  milestone: Milestone;
  progressBps: number;
  /** Onde a pessoa está em relação ao marco, na mesma base da barra. */
  detail: MoneyTextPart[];
  /** O mês corrente, à parte e rotulado (só nos marcos de % do salário). */
  currentMonth: string | null;
}

/**
 * O próximo degrau da escada. Nos marcos de % do salário a API mede o progresso pelo melhor mês completo,
 * então o texto fala do melhor mês (não de "faltam R$ X" no mês corrente, que contradiria a barra).
 * Nos marcos acumulados, "faltam R$ X" desde o início do acompanhamento.
 */
export function nextMilestoneInfo(e: Earnings): NextMilestoneInfo | null {
  if (!e.next_milestone) return null;
  const milestone = e.milestones.find((m) => m.key === e.next_milestone?.key);
  if (!milestone) return null;
  const progressBps = e.next_milestone.progress_bps;
  let detail: MoneyTextPart[];
  let currentMonth: string | null = null;
  if (milestone.kind === "total_amount") {
    detail = ["faltam ", { cents: Math.max((milestone.threshold ?? 0) - e.total.since_tracking_cents, 0) }];
  } else if (milestone.kind === "monthly_share") {
    const target = formatPercent(milestone.threshold ?? 0);
    const best = bestCompleteShare(e.months);
    if (best !== null) {
      detail = [`seu melhor mês até agora chegou a ${formatPercent(Math.max(best, 0))} do seu salário; a meta é ${target}.`];
    } else if (e.salary) {
      detail = [`ainda não há mês completo para comparar; a meta é ${target} do seu salário em um mês.`];
    } else {
      detail = ["Registre o salário no aporte do mês para medir este marco."];
    }
    const current = e.current_month;
    if (current.partial && current.salary_share_bps !== null && current.salary_share_bps > 0) {
      currentMonth = `${capitalize(monthName(current.month))} até agora: ${formatPercent(current.salary_share_bps)} do seu salário (conta quando o mês fechar).`;
    }
  } else {
    detail = ["Chega no primeiro mês em que seus investimentos renderem, pelas atualizações de saldo."];
  }
  return { milestone, progressBps, detail, currentMonth };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const GAP_NOTE = "inclui meses sem atualização de saldo";

/**
 * O rendimento cai no mês em que o saldo foi digitado: um mês com atualização logo depois de meses sem
 * ela concentra o rendimento de todos eles. O mês em que o acompanhamento começou não conta como lacuna.
 */
export function followsUpdateGap(months: readonly EarningsMonth[], month: string, trackingSince: string | null): boolean {
  const index = months.findIndex((m) => m.month === month);
  if (index <= 0 || !months[index].has_update) return false;
  const previous = months[index - 1];
  if (previous.has_update) return false;
  // O mês do cadastro não é lacuna: o ganho dele (antes do cadastro) fica fora do salário.
  return trackingSince === null || previous.month > trackingSince.slice(0, 7);
}

/** Algum mês da lista vem depois de uma lacuna de atualização. */
export function hasUpdateGap(e: Earnings): boolean {
  return e.months.some((m) => followsUpdateGap(e.months, m.month, e.tracking_since));
}

function monthOf(e: Earnings, month: string): EarningsMonth | undefined {
  return e.months.find((m) => m.month === month) ?? (e.last_complete_month?.month === month ? e.last_complete_month : undefined);
}

/** O aviso festivo de um marco: o que aconteceu (no mês da conquista) e qual é o próximo. */
export function milestoneCelebration(m: Milestone, e: Earnings): Celebration {
  const next = e.next_milestone ? e.milestones.find((x) => x.key === e.next_milestone?.key) : undefined;
  const highlight = next ? `Próximo marco: ${milestoneShortName(next)}` : "Você conquistou todos os marcos do salário do seu dinheiro.";
  const action = { label: "Ver conquistas", to: ACHIEVEMENTS_HREF };

  if (m.kind === "total_amount") {
    return {
      title: `Seu dinheiro já rendeu ${formatBRL(m.threshold ?? 0)}!`,
      text: `Desde o início do acompanhamento, seus investimentos já renderam ${formatBRL(e.total.since_tracking_cents)} para você, sem contar os aportes.`,
      highlight,
      next: action,
    };
  }
  const month = m.achieved_month ? monthOf(e, m.achieved_month) : undefined;
  const name = m.achieved_month ? monthName(m.achieved_month) : "um mês";
  const share = month?.salary_share_bps ? ` (${formatPercent(month.salary_share_bps)} do seu salário)` : "";
  const earned = month ? `seus investimentos renderam ${formatBRL(month.earned_cents)} para você${share}` : "seus investimentos renderam para você";
  if (m.kind === "monthly_share") {
    return {
      title: `Seu dinheiro ganhou ${formatPercent(m.threshold ?? 0)} do seu salário em um mês!`,
      text: `Em ${name}, ${earned}, sem contar os aportes.`,
      highlight,
      next: action,
    };
  }
  return {
    title: "Primeiro salário do seu dinheiro!",
    text: `Em ${name}, ${earned}, sem contar os aportes.`,
    highlight,
    next: action,
  };
}

/**
 * Quais marcos celebrar agora: os ainda não vistos, atingidos no mês corrente ou no anterior; um aviso por vez.
 * `seen === null` é a primeira carga (nada lembrado): todos os já atingidos viram "vistos", sem festa,
 * e a lista passa a existir (mesmo vazia) para que o próximo marco seja celebrado.
 */
export function milestonesToCelebrate(
  e: Earnings,
  seen: readonly string[] | null,
): { celebration: Celebration | null; seen: string[]; changed: boolean } {
  const known = new Set(seen ?? []);
  const achieved = e.milestones.filter((m) => m.achieved_month);
  const recent = recentMonths(e);
  const fresh = achieved.filter((m) => !known.has(m.key) && recent.includes(m.achieved_month ?? ""));
  achieved.forEach((m) => known.add(m.key));
  const changed = seen === null || known.size !== seen.length;
  // Sem festa na primeira carga nem enquanto os investimentos estão abaixo do investido.
  const pick = seen === null || e.total.earned_cents < 0 ? null : latestMilestone(fresh);
  return { celebration: pick ? milestoneCelebration(pick, e) : null, seen: [...known], changed };
}

/** O que o mascote fala sobre o rendimento: uma conquista recente (festa) ou o quanto o dinheiro trabalhou. */
export interface MascotEarnings {
  /** Um marco atingido neste mês ou no anterior: o mascote comemora. */
  festa: boolean;
  parts: MoneyTextPart[];
}

export function mascotEarnings(e: Earnings | undefined | null): MascotEarnings | null {
  if (!hasEarningsData(e)) return null;
  // Abaixo do investido não há festa; um mês que recuou também não muda nada no mascote.
  if (e.total.earned_cents < 0) return null;
  const milestone = latestMilestone(e.milestones, recentMonths(e));
  if (milestone) {
    if (milestone.kind === "monthly_share") {
      return { festa: true, parts: [`Seu dinheiro já ganhou ${formatPercent(milestone.threshold ?? 0)} do seu salário em um mês!`] };
    }
    if (milestone.kind === "total_amount") {
      return { festa: true, parts: ["Seu dinheiro já rendeu ", { cents: milestone.threshold ?? 0 }, " desde o início!"] };
    }
    return { festa: true, parts: ["Primeiro salário do seu dinheiro conquistado!"] };
  }
  const current = e.current_month;
  if (readMonth(current) === "positive") {
    return { festa: false, parts: ["Seu dinheiro trabalhou ", { cents: current.earned_cents }, " para você este mês."] };
  }
  return null;
}
