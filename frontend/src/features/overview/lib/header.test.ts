import { describe, expect, it } from "vitest";
import { daysBefore, evolutionTitle, hello, longDate } from "./header";

describe("longDate", () => {
  it("escreve a data por extenso, em português", () => {
    expect(longDate(new Date(2026, 10, 1))).toBe("domingo, 1 de novembro de 2026");
    expect(longDate(new Date(2026, 0, 31))).toBe("sábado, 31 de janeiro de 2026");
  });
});

describe("hello", () => {
  it("cumprimenta pelo nome e, sem nome, só diz olá", () => {
    expect(hello("José")).toBe("Olá, José");
    expect(hello("  Maria  ")).toBe("Olá, Maria");
    expect(hello("")).toBe("Olá");
    expect(hello()).toBe("Olá");
  });
});

describe("evolutionTitle", () => {
  it("diz o período escolhido", () => {
    expect(evolutionTitle("12m")).toBe("Evolução nos últimos 12 meses");
    expect(evolutionTitle("6m")).toBe("Evolução nos últimos 6 meses");
    expect(evolutionTitle("5y")).toBe("Evolução nos últimos 5 anos");
    expect(evolutionTitle("all")).toBe("Evolução em todo o período");
  });
});

describe("daysBefore", () => {
  it("volta dias passando por virada de mês e de ano", () => {
    expect(daysBefore("2026-11-01", 30)).toBe("2026-10-02");
    expect(daysBefore("2026-01-10", 30)).toBe("2025-12-11");
    expect(daysBefore("2026-03-05", 7)).toBe("2026-02-26");
  });
});
