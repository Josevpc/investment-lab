import { describe, expect, it } from "vitest";
import { nextStep } from "./nextStep";

const base = { month: "2026-10", assetsCount: 3, hasContribution: true, snapshotDates: ["2026-09-30"] };

describe("nextStep", () => {
  it("convida a cadastrar a primeira posição quando não há ativos", () => {
    const step = nextStep({ ...base, assetsCount: 0, hasContribution: false, snapshotDates: [] });
    expect(step.kind).toBe("register");
    expect(step.to).toBe("/carteira/ativos?novo=1");
  });

  it("pede o aporte do mês antes do fechamento", () => {
    const step = nextStep({ ...base, hasContribution: false });
    expect(step.kind).toBe("contribution");
    expect(step.title).toBe("Defina o aporte de outubro");
  });

  it("lembra de aportar o que falta do plano antes de pedir o fechamento", () => {
    const step = nextStep({ ...base, plan: { remainingCents: 4_000, largestClass: "Renda Variável" } });
    expect(step.kind).toBe("invest");
    // O valor vai como parte separada, para a tela desenhar com <Money> (respeita "ocultar valores").
    expect(step.title).toEqual(["Faltam ", { cents: 4_000 }, " para completar o aporte de outubro"]);
    expect(step.text).toContain("Renda Variável");
    expect(step.to).toBe("/carteira/movimentacoes?novo=aporte"); // abre o formulário de aporte
  });

  it("com todos os ativos mantidos e sem aporte definido, orienta a desmarcar algum ou usar a reserva", () => {
    const step = nextStep({ ...base, hasContribution: false, allHeld: true });
    expect(step.kind).toBe("held");
    expect(step.title).toBe('Todos os ativos estão em "Manter posição"');
    expect(step.text).toMatch(/desligue "Manter posição" em algum ativo.*reserva/);
    expect(step.to).toBe("/carteira/ativos");
  });

  it("com todos os ativos mantidos e o plano só com categorias mantidas, trata como cumprido", () => {
    expect(nextStep({ ...base, allHeld: true, plan: { remainingCents: 0, largestClass: null } }).kind).toBe("close");
  });

  it("com todos os ativos mantidos, o que falta é só a reserva e o texto diz isso", () => {
    const step = nextStep({ ...base, allHeld: true, plan: { remainingCents: 9_750, largestClass: "Reserva de emergência" } });
    expect(step.kind).toBe("invest");
    expect(step.text).toMatch(/^Todos os ativos estão em "Manter posição": o que falta é só a reserva/);
  });

  it("sem saber o que está mantido, pede os aportes sem mostrar um valor que pode estar errado", () => {
    const step = nextStep({ ...base, plan: { remainingCents: 4_000, largestClass: "Renda Variável", amountUnknown: true } });
    expect(step.kind).toBe("invest");
    expect(step.title).toBe("Registre os aportes do mês");
    expect(step.title).not.toMatch(/R\$/);
  });

  it("com o plano cumprido, segue para o fechamento", () => {
    expect(nextStep({ ...base, plan: { remainingCents: 0, largestClass: null } }).kind).toBe("close");
  });

  it("pede o fechamento quando não há snapshot no mês", () => {
    const step = nextStep(base);
    expect(step.kind).toBe("close");
    expect(step.title).toBe("Feche outubro");
    expect(step.to).toBe("/carteira/fechamento");
  });

  it("não trata o snapshot de outro mês como fechamento do mês atual", () => {
    expect(nextStep({ ...base, snapshotDates: ["2025-10-31"] }).kind).toBe("close");
  });

  it("indica o desempenho quando o mês já está fechado", () => {
    const step = nextStep({ ...base, snapshotDates: ["2026-09-30", "2026-10-31"] });
    expect(step.kind).toBe("done");
    expect(step.title).toBe("Outubro fechado");
  });
});
