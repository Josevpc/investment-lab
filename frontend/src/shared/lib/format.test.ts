import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  formatDateTime,
  bpsToInput,
  centsToInput,
  currentMonth,
  greeting,
  isValidMonth,
  formatBRL,
  formatDate,
  formatDayMonth,
  formatMonth,
  formatMonthList,
  formatPercent,
  formatPointsDiff,
  formatTickDate,
  parseMoneyToCents,
  parsePercentToBps,
} from "./format";

// O Intl usa espaço não separável entre "R$" e o número.
const normalize = (text: string) => text.replace(/ /g, " ");

describe("formatação", () => {
  it("formata reais a partir de centavos", () => {
    expect(normalize(formatBRL(123456))).toBe("R$ 1.234,56");
    expect(normalize(formatBRL(0))).toBe("R$ 0,00");
  });

  it("rótulo de eixo com dia, para datas do mesmo mês não se repetirem", () => {
    expect(formatTickDate("2026-10-31")).toBe("31/10/26");
    expect(formatTickDate("2026-10-03")).not.toBe(formatTickDate("2026-10-31"));
  });

  it("formata percentuais e diferenças", () => {
    expect(formatPercent(750)).toBe("7,5%");
    expect(formatPercent(10000)).toBe("100%");
    expect(formatPointsDiff(350)).toBe("+3,5 p.p.");
    expect(formatPointsDiff(-100)).toBe("-1 p.p.");
  });

  it("formata mês e data sem deslocar o fuso", () => {
    expect(formatMonth("2026-10")).toBe("out/2026");
    expect(formatDate("2026-01-31")).toBe("31/01/2026");
    expect(formatDayMonth("2026-10-02")).toBe("02/10");
    expect(currentMonth(new Date(2026, 0, 5))).toBe("2026-01");
  });

  it("formata data e hora lendo os campos, sem deslocar o dia", () => {
    expect(formatDateTime("2026-10-31T23:59:09")).toBe("31/10/2026 23:59");
    expect(formatDateTime("2026-01-01T00:05:00")).toBe("01/01/2026 00:05");
  });

  it("soma dias a uma data virando mês e ano", () => {
    expect(addDaysISO("2026-11-05", 7)).toBe("2026-11-12");
    expect(addDaysISO("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDaysISO("2028-02-25", 7)).toBe("2028-03-03");
  });

  it("resume listas de meses, juntando sequências de 3 ou mais em faixa", () => {
    expect(formatMonthList([])).toBe("");
    expect(formatMonthList(["2026-01"])).toBe("jan/2026");
    expect(formatMonthList(["2026-01", "2026-02"])).toBe("jan/2026 e fev/2026");
    expect(formatMonthList(["2026-01", "2026-02", "2026-03"])).toBe("jan/2026 a mar/2026");
    // A virada de ano conta como mês vizinho.
    expect(formatMonthList(["2025-11", "2025-12", "2026-01", "2026-03", "2026-05"])).toBe(
      "nov/2025 a jan/2026, mar/2026 e mai/2026",
    );
  });
});

describe("parse de entrada do usuário", () => {
  it("lê valores monetários em formato brasileiro", () => {
    expect(parseMoneyToCents("1.234,56")).toBe(123456);
    expect(parseMoneyToCents("R$ 8.000")).toBe(800000);
    expect(parseMoneyToCents("800")).toBe(80000);
    expect(parseMoneyToCents("12,5")).toBe(1250);
    expect(parseMoneyToCents("1234.5")).toBe(123450);
  });

  it("rejeita entradas inválidas", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("-5")).toBeNull();
    expect(parseMoneyToCents("1,234")).toBeNull();
  });

  it("lê percentuais", () => {
    expect(parsePercentToBps("7,5")).toBe(750);
    expect(parsePercentToBps("10%")).toBe(1000);
    expect(parsePercentToBps("0.25")).toBe(25);
    expect(parsePercentToBps("x")).toBeNull();
  });

  it("converte de volta para texto editável", () => {
    expect(centsToInput(123450)).toBe("1234,50");
    expect(bpsToInput(750)).toBe("7,5");
  });
});

describe("isValidMonth", () => {
  it("só aceita mês completo e válido", () => {
    expect(isValidMonth("2026-10")).toBe(true);
    expect(isValidMonth("2026-01")).toBe(true);
    for (const partial of ["", "2026", "2026-", "2026-1", "2026-0", "2026-13", "2026-00", "26-10", "2026-10-01"]) {
      expect(isValidMonth(partial), partial).toBe(false);
    }
  });
});

describe("greeting", () => {
  it("troca a saudação pela hora e inclui o nome quando informado", () => {
    expect(greeting(new Date(2026, 9, 17, 8))).toBe("Bom dia");
    expect(greeting(new Date(2026, 9, 17, 14), "José")).toBe("Boa tarde, José");
    expect(greeting(new Date(2026, 9, 17, 21), "  Ana  ")).toBe("Boa noite, Ana");
    expect(greeting(new Date(2026, 9, 17, 2), "")).toBe("Boa noite");
  });
});
