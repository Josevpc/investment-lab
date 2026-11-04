import { describe, expect, it } from "vitest";
import { joinNames, savedPlanMessage } from "./messages";

describe("joinNames", () => {
  it("junta como em português", () => {
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A e B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B e C");
  });
});

describe("savedPlanMessage", () => {
  it("confirma e diz o que vem a seguir", () => {
    expect(savedPlanMessage(true)).toBe("Metas salvas. A divisão do próximo aporte já segue este plano.");
    expect(savedPlanMessage(false)).toMatch(/clique em Ativar/);
  });
});
