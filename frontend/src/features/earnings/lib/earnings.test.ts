import { describe, expect, it } from "vitest";
import { formatBRL } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { established, milestones, month, starting } from "../testData";
import {
  cardState,
  currentMonthSalary,
  currentPaceText,
  formatWorkMinutes,
  followsUpdateGap,
  hasEarningsData,
  hasUpdateGap,
  latestMilestone,
  mascotEarnings,
  milestonesToCelebrate,
  monthShortLabel,
  monthTitle,
  negativeMessage,
  nextMilestoneInfo,
  previousMonth,
  paceText,
  readMonth,
  salaryComparison,
  totalDetail,
  workMinutesRows,
} from "./earnings";

const text = (parts: MoneyTextPart[] | null | undefined) =>
  parts ? parts.map((p) => (typeof p === "string" ? p : formatBRL(p.cents))).join("").replace(/\s/g, " ") : null;

describe("tempo de trabalho", () => {
  it("fala em minutos e horas, sem casas decimais", () => {
    expect(formatWorkMinutes(0)).toBe("menos de 1 min");
    expect(formatWorkMinutes(2)).toBe("2 min");
    expect(formatWorkMinutes(59)).toBe("59 min");
    expect(formatWorkMinutes(120)).toBe("2 h");
    expect(formatWorkMinutes(200)).toBe("3 h 20 min");
  });
});

describe("leitura do mês", () => {
  it("diz até que dia vai o mês corrente", () => {
    expect(monthTitle(month({ partial: true, through: "2026-10-17" }))).toBe("Salário de outubro (até 17/10)");
    expect(monthTitle(month({ month: "2026-09" }))).toBe("Salário de setembro");
  });

  it("o mês corrente vai até o último saldo digitado, não até hoje", () => {
    // Hoje é 17/10, mas o último saldo é de 13/10: o rendimento só vale até lá.
    const m = month({ partial: true, through: "2026-10-17", measured_through: "2026-10-13" });
    expect(monthTitle(m)).toBe("Salário de outubro (até 13/10)");
    expect(monthShortLabel(m)).toBe("out/2026 (até 13/10)");
  });

  it("mês sem atualização de saldo não é 'rendeu zero'", () => {
    expect(readMonth(month({ has_update: false }))).toBe("no_update");
    // Provento sem atualização de saldo ainda é ganho conhecido.
    expect(readMonth(month({ has_update: false, earned_cents: 500, proventos_cents: 500 }))).toBe("positive");
  });

  it("separa recuo, começo (até R$ 1) e ganho", () => {
    expect(readMonth(month({ earned_cents: -1 }))).toBe("negative");
    expect(readMonth(month({ earned_cents: 0 }))).toBe("starting");
    expect(readMonth(month({ earned_cents: 100 }))).toBe("starting");
    expect(readMonth(month({ earned_cents: 101 }))).toBe("positive");
  });
});

describe("estado do cartão", () => {
  it("sem ativos não há o que mostrar", () => {
    expect(hasEarningsData(starting({ tracking_since: null }))).toBe(false);
    expect(hasEarningsData(undefined)).toBe(false);
    expect(hasEarningsData({} as never)).toBe(false);
    expect(hasEarningsData(starting())).toBe(true);
  });

  it("recém-cadastrado (ganho zero, nenhum mês completo) é o estado de dados parciais", () => {
    expect(cardState(starting())).toBe("starting");
    expect(cardState(established())).toBe("full");
    // Ganho que os ativos já traziam do cadastro já é algo para mostrar.
    expect(cardState(starting({ total: { ...starting().total, earned_cents: 50_000, before_tracking_cents: 50_000 } }))).toBe("full");
  });
});

describe("tom do mês negativo", () => {
  const dip = established({ current_month: month({ partial: true, through: "2026-10-17", earned_cents: -12_345 }) });

  it("mês que recuou lembra o que já rendeu desde o início", () => {
    expect(text(negativeMessage(dip))).toBe(
      "Mês de oscilação: seus investimentos recuaram R$ 123,45. Faz parte; desde o início seu dinheiro já rendeu R$ 1.200,00.",
    );
  });

  it("se o total também está abaixo, explica sem alarme", () => {
    const below = { ...dip, total: { ...dip.total, earned_cents: -5_000 } };
    expect(text(negativeMessage(below))).toBe(
      "Por enquanto seus investimentos estão R$ 50,00 abaixo do que você investiu. Oscilações são comuns, sobretudo em renda variável; acompanhe ao longo dos meses.",
    );
  });

  it("mês positivo não tem mensagem de recuo", () => {
    expect(negativeMessage(established())).toBeNull();
  });
});

describe("o mês corrente, acompanhado durante o mês", () => {
  const live = { partial: true, through: "2026-10-17", measured_through: "2026-10-17", earned_cents: 30_000, salary_share_bps: 600, work_minutes: 792 } as const;

  it("compara o rendimento até agora com o salário, em % e em tempo de trabalho", () => {
    expect(currentMonthSalary(established())).toEqual({ month: "outubro", through: "17/10", share: "6%", work: "13 h 12 min" });
  });

  it("usa a data do último saldo digitado", () => {
    const current = month({ ...live, measured_through: "2026-10-13" });
    expect(currentMonthSalary(established({ current_month: current }))?.through).toBe("13/10");
  });

  it("sem salário, sem atualização, sem ganho de verdade ou em queda, não há o que comparar", () => {
    expect(currentMonthSalary(established({ salary: null }))).toBeNull();
    expect(currentMonthSalary(established({ current_month: month({ ...live, has_update: false }) }))).toBeNull();
    // Até R$ 1,00 é "o dinheiro começou a trabalhar": não vira "equivale a 1 min do seu trabalho".
    expect(currentMonthSalary(established({ current_month: month({ ...live, earned_cents: 100 }) }))).toBeNull();
    expect(currentMonthSalary(established({ current_month: month({ ...live, earned_cents: -500, salary_share_bps: -10, work_minutes: null }) }))).toBeNull();
    expect(currentMonthSalary(established({ current_month: month({ ...live, salary_share_bps: null }) }))).toBeNull();
  });

  it("sem tempo de trabalho calculado, mostra só a parte do salário", () => {
    const current = month({ ...live, work_minutes: null });
    expect(currentMonthSalary(established({ current_month: current }))?.work).toBeNull();
  });

  it("o ritmo do mês diz até que dia vale", () => {
    expect(text(currentPaceText(established().current_month))).toBe("Em outubro, até 17/10: ≈ R$ 17,65 por dia");
  });

  it("o ritmo do mês trata centavos, oscilação e mês sem atualização", () => {
    const at = (per_day_cents: number | null) => month({ partial: true, through: "2026-10-17", measured_through: "2026-10-17", per_day_cents });
    expect(text(currentPaceText(at(0)))).toBe("Em outubro, até 17/10: centavos por dia");
    expect(text(currentPaceText(at(-40)))).toBe("Em outubro, até 17/10: oscilação, sem ganho médio por dia");
    expect(currentPaceText(at(null))).toBeNull();
  });
});

describe("minutos de trabalho por mês (gráfico)", () => {
  const ok = { has_update: true, earned_cents: 45_000, salary_share_bps: 900, work_minutes: 200 } as const;

  it("um ponto por mês, do mais antigo ao mais novo, com os minutos que a API calculou", () => {
    const rows = workMinutesRows([month({ month: "2026-08", ...ok }), month({ month: "2026-09", ...ok, work_minutes: 224 })]);
    expect(rows.map((r) => [r.month, r.minutes, r.reason])).toEqual([
      ["2026-08", 200, null],
      ["2026-09", 224, null],
    ]);
  });

  it("o mês corrente vem marcado como em andamento, com o dia até onde vale", () => {
    const [row] = workMinutesRows([month({ month: "2026-10", ...ok, partial: true, through: "2026-10-24", measured_through: "2026-10-20" })]);
    expect(row.partial).toBe(true);
    expect(row.label).toBe("out/2026 (até 20/10)");
    expect(row.axis).toBe("out/26");
  });

  it("explica por que um mês não tem barra: sem atualização, sem salário ou sem ganho", () => {
    const rows = workMinutesRows([
      month({ month: "2026-07", has_update: false, earned_cents: 0, work_minutes: null }),
      month({ month: "2026-08", ...ok, salary_share_bps: null, work_minutes: null }),
      month({ month: "2026-09", ...ok, earned_cents: -500, salary_share_bps: -10, work_minutes: null }),
    ]);
    expect(rows.map((r) => [r.minutes, r.reason])).toEqual([
      [null, "sem atualização de saldo"],
      [null, "sem salário registrado"],
      [null, "sem ganho no mês"],
    ]);
  });

  it("guarda quanto o mês rendeu em reais, para a tabela", () => {
    expect(workMinutesRows([month({ month: "2026-09", ...ok })])[0].earnedCents).toBe(45_000);
  });
});

describe("total, ritmo e salário", () => {
  it("detalha o ganho que já existia antes do cadastro", () => {
    expect(text(totalDetail(established()))).toBe("Inclui R$ 200,00 que seus ativos já tinham rendido antes do cadastro.");
    expect(totalDetail(starting())).toBeNull();
  });

  it("o ritmo diz o valor por dia e de onde vem a média", () => {
    const pace = paceText(established().pace!);
    expect(text(pace.main)).toBe("≈ R$ 15,00 por dia, mesmo enquanto você dorme");
    expect(pace.basis).toBe("Média de jul/2026 a set/2026, pelas atualizações de saldo.");
    expect(text(paceText({ per_day_cents: -10, basis_months: 1, from_month: "2026-09", to_month: "2026-09" }).main)).toContain(
      "oscilação",
    );
  });

  it("compara com o salário em % e em tempo de trabalho", () => {
    expect(salaryComparison(established())).toEqual({ kind: "ok", month: "setembro", share: "9%", work: "3 h 20 min" });
    expect(salaryComparison(established({ salary: null }))).toEqual({ kind: "no_salary" });
    expect(salaryComparison(established({ vs_salary: null }))).toEqual({ kind: "waiting" });
    expect(
      salaryComparison(established({ vs_salary: { month: "2026-09", earned_cents: -10, share_bps: 0, work_minutes: null } })).kind,
    ).toBe("dip");
    // Saldo igual (ganho exatamente zero) não é oscilação.
    expect(
      salaryComparison(established({ vs_salary: { month: "2026-09", earned_cents: 0, share_bps: 0, work_minutes: null } })),
    ).toEqual({ kind: "flat", month: "setembro" });
  });
});

describe("marcos", () => {
  it("o próximo marco de % do salário fala do melhor mês completo, a mesma base da barra", () => {
    // Melhor mês completo: setembro, 9% do salário. Outubro (parcial) aparece à parte e rotulado.
    const info = nextMilestoneInfo(established())!;
    expect(info.milestone.key).toBe("share_10");
    expect(info.progressBps).toBe(6_000);
    expect(text(info.detail)).toBe("seu melhor mês até agora chegou a 9% do seu salário; a meta é 10%.");
    expect(text(info.detail)).not.toContain("faltam");
    expect(info.currentMonth).toBe("Outubro até agora: 6% do seu salário (conta quando o mês fechar).");
  });

  it("sem mês completo, diz que ainda não há base para comparar", () => {
    const e = established({ months: [established().current_month] });
    expect(text(nextMilestoneInfo(e)!.detail)).toBe("ainda não há mês completo para comparar; a meta é 10% do seu salário em um mês.");
  });

  it("sem salário, orienta a registrar em vez de inventar um valor", () => {
    const noSalary = established({ salary: null, months: established().months.map((m) => ({ ...m, salary_share_bps: null })) });
    expect(text(nextMilestoneInfo(noSalary)!.detail)).toContain("Registre o salário");
  });

  it("o próximo marco acumulado conta desde o início do acompanhamento", () => {
    const e = established({ next_milestone: { key: "total_10000", progress_bps: 1_000 } });
    expect(text(nextMilestoneInfo(e)!.detail)).toBe("faltam R$ 9.000,00");
    expect(nextMilestoneInfo(e)!.currentMonth).toBeNull();
  });

  it("o primeiro salário explica quando chega", () => {
    expect(text(nextMilestoneInfo(starting())!.detail)).toContain("primeiro mês");
    expect(nextMilestoneInfo(starting({ next_milestone: null }))).toBeNull();
  });

  it("a conquista mais recente é a do mês mais novo; no mesmo mês, o primeiro salário vem antes, e depois o de maior nível", () => {
    const list = milestones({ first_salary: "2026-07", share_1: "2026-07", share_5: "2026-09", total_100: "2026-09" });
    expect(latestMilestone(list)?.key).toBe("total_100");
    expect(latestMilestone(list, ["2026-07"])?.key).toBe("first_salary");
    expect(latestMilestone(milestones({ share_1: "2026-07", share_5: "2026-07" }), ["2026-07"])?.key).toBe("share_5");
    expect(latestMilestone(list, ["2026-10"])).toBeNull();
  });

  it("o mês anterior atravessa a virada do ano", () => {
    expect(previousMonth("2026-10")).toBe("2026-09");
    expect(previousMonth("2027-01")).toBe("2026-12");
  });
});

describe("o que celebrar", () => {
  // Forma real: o primeiro salário e o % do salário chegam com o mês completo anterior.
  const firstSalaryInSeptember = () =>
    established({
      milestones: milestones({ first_salary: "2026-09", share_1: "2026-09", share_5: "2026-09" }),
      next_milestone: { key: "share_10", progress_bps: 9_000 },
    });

  it("na primeira carga (nada lembrado), marca tudo como visto e não celebra", () => {
    const result = milestonesToCelebrate(firstSalaryInSeptember(), null);
    expect(result.celebration).toBeNull();
    expect(result.changed).toBe(true);
    expect(result.seen.sort()).toEqual(["first_salary", "share_1", "share_5"]);
  });

  it("a lista lembrada passa a existir mesmo vazia, para o próximo marco ser celebrado", () => {
    const result = milestonesToCelebrate(starting(), null);
    expect(result).toMatchObject({ celebration: null, seen: [], changed: true });
  });

  it("o primeiro salário de setembro, visto em outubro, é celebrado (antes dos outros marcos do mesmo mês)", () => {
    const result = milestonesToCelebrate(firstSalaryInSeptember(), []);
    expect(result.celebration?.title).toBe("Primeiro salário do seu dinheiro!");
    expect(result.celebration?.text.replace(/\s/g, " ")).toBe(
      "Em setembro, seus investimentos renderam R$ 450,00 para você (9% do seu salário), sem contar os aportes.",
    );
    expect(result.celebration?.highlight).toBe("Próximo marco: 10% do seu salário");
    expect(result.celebration?.next).toEqual({ label: "Ver conquistas", to: "/metas#salario-do-dinheiro" });
  });

  it("celebra um marco uma vez só", () => {
    const first = milestonesToCelebrate(firstSalaryInSeptember(), []);
    const again = milestonesToCelebrate(firstSalaryInSeptember(), first.seen);
    expect(again.celebration).toBeNull();
    expect(again.changed).toBe(false);
  });

  it("um % do salário novo do mês anterior diz o mês da conquista e o próximo marco", () => {
    const result = milestonesToCelebrate(firstSalaryInSeptember(), ["first_salary", "share_1"]);
    expect(result.celebration?.title).toBe("Seu dinheiro ganhou 5% do seu salário em um mês!");
    expect(result.celebration?.text).toContain("Em setembro");
  });

  it("o acumulado pode chegar no mês corrente", () => {
    const result = milestonesToCelebrate(established(), ["first_salary", "share_1", "share_5", "total_100"]);
    expect(result.celebration?.title.replace(/\s/g, " ")).toBe("Seu dinheiro já rendeu R$ 1.000,00!");
  });

  it("marco de mais de um mês atrás (ex.: depois de restaurar um backup) não solta confete", () => {
    const e = established({ milestones: milestones({ share_25: "2026-08" }) });
    expect(milestonesToCelebrate(e, []).celebration).toBeNull();
  });

  it("sem celebração enquanto o total está abaixo do investido", () => {
    const e = firstSalaryInSeptember();
    expect(milestonesToCelebrate({ ...e, total: { ...e.total, earned_cents: -1 } }, []).celebration).toBeNull();
  });
});

describe("fala do mascote sobre o rendimento", () => {
  it("com marco do mês anterior (forma real), comemora com uma fala que vale fora do mês", () => {
    const e = established({ milestones: milestones({ share_1: "2026-09", share_5: "2026-09" }) });
    expect(mascotEarnings(e)).toEqual({ festa: true, parts: ["Seu dinheiro já ganhou 5% do seu salário em um mês!"] });
    const first = established({ milestones: milestones({ first_salary: "2026-09", share_1: "2026-09" }) });
    expect(mascotEarnings(first)).toEqual({ festa: true, parts: ["Primeiro salário do seu dinheiro conquistado!"] });
  });

  it("com acumulado neste mês, comemora com o valor em <Money>", () => {
    expect(text(mascotEarnings(established())!.parts)).toBe("Seu dinheiro já rendeu R$ 1.000,00 desde o início!");
  });

  it("mês positivo sem marco recente: o dinheiro trabalhou R$ X", () => {
    const e = established({ milestones: milestones({ share_5: "2026-07" }) });
    const result = mascotEarnings(e)!;
    expect(result.festa).toBe(false);
    expect(text(result.parts)).toBe("Seu dinheiro trabalhou R$ 300,00 para você este mês.");
  });

  it("mês negativo, total abaixo do investido, sem dados ou só centavos não mudam nada", () => {
    const old = milestones({ share_5: "2026-07" });
    expect(mascotEarnings(established({ milestones: old, current_month: month({ earned_cents: -500 }) }))).toBeNull();
    const e = established();
    expect(mascotEarnings({ ...e, total: { ...e.total, earned_cents: -1 } })).toBeNull();
    expect(mascotEarnings(starting())).toBeNull();
    expect(mascotEarnings(undefined)).toBeNull();
  });
});

describe("lacuna de atualização de saldo", () => {
  it("marca o mês com atualização que vem logo depois de um mês sem ela", () => {
    const e = established();
    expect(followsUpdateGap(e.months, "2026-09", e.tracking_since)).toBe(true);
    expect(followsUpdateGap(e.months, "2026-10", e.tracking_since)).toBe(false);
    expect(followsUpdateGap(e.months, "2026-07", e.tracking_since)).toBe(false);
    expect(followsUpdateGap(e.months, "2026-08", e.tracking_since)).toBe(false); // ele mesmo não teve atualização
    expect(hasUpdateGap(e)).toBe(true);
  });

  it("o mês do cadastro (sem atualização) não é lacuna", () => {
    const months = [month({ month: "2026-08", has_update: false }), month({ month: "2026-09", earned_cents: 500 })];
    expect(followsUpdateGap(months, "2026-09", "2026-08-31")).toBe(false);
    expect(followsUpdateGap(months, "2026-09", "2026-07-05")).toBe(true);
  });

  it("sem lacuna, nada a avisar", () => {
    const e = established();
    expect(hasUpdateGap({ ...e, months: e.months.filter((m) => m.month !== "2026-08") })).toBe(false);
  });
});
