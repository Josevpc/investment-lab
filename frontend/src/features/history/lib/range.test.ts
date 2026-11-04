import { describe, expect, it } from "vitest";
import { rangeStart } from "./range";

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
