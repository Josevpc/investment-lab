import { describe, expect, it } from "vitest";
import { calculateContribution } from "./calculate";

describe("calculateContribution", () => {
  it("aplica o percentual ao salário", () => {
    expect(calculateContribution(800_000, 750)).toBe(60_000); // 7,5% de R$ 8.000
    expect(calculateContribution(800_000, 500)).toBe(40_000);
    expect(calculateContribution(800_000, 1_000)).toBe(80_000);
  });

  it("arredonda meio centavo para cima, como o back-end", () => {
    expect(calculateContribution(1, 5_000)).toBe(1);
    expect(calculateContribution(3, 1_000)).toBe(0);
    expect(calculateContribution(5, 1_000)).toBe(1);
  });

  it("retorna zero sem salário ou percentual", () => {
    expect(calculateContribution(0, 1_000)).toBe(0);
    expect(calculateContribution(800_000, 0)).toBe(0);
  });
});
