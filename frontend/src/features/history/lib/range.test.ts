import { describe, expect, it } from "vitest";
import { addMonths, rangeFromMonth, rangeStart } from "./range";

describe("rangeStart", () => {
  const now = new Date(2026, 9, 15); // 15/out/2026

  it("recua 6 meses, 1 ano e 5 anos", () => {
    expect(rangeStart("6m", now)).toBe("2026-04-15");
    expect(rangeStart("12m", now)).toBe("2025-10-15");
    expect(rangeStart("5y", now)).toBe("2021-10-15");
  });

  it("não filtra com 'tudo'", () => {
    expect(rangeStart("all", now)).toBeUndefined();
  });
});

describe("addMonths", () => {
  it("anda para frente e para trás atravessando o ano", () => {
    expect(addMonths("2026-10", 1)).toBe("2026-11");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-10", -23)).toBe("2024-11");
    expect(addMonths("2026-10", 0)).toBe("2026-10");
  });
});

describe("rangeFromMonth", () => {
  it("conta o mês atual: 6 meses são 6 colunas", () => {
    expect(rangeFromMonth("6m", "2026-11")).toBe("2026-06");
    expect(rangeFromMonth("12m", "2026-11")).toBe("2025-12");
    expect(rangeFromMonth("5y", "2026-11")).toBe("2021-12");
  });

  it("não filtra com 'tudo'", () => {
    expect(rangeFromMonth("all", "2026-11")).toBeUndefined();
  });
});
