import { describe, expect, it } from "vitest";
import { offGoalSavedNote } from "./offGoal";

describe("offGoalSavedNote", () => {
  it("avisa que o aporte marcado não conta no plano", () => {
    expect(offGoalSavedNote([{ contribution_cents: 2500, off_goal: true }])).toContain("fora da meta do mês");
  });

  it("não diz nada quando nenhum aporte foi marcado", () => {
    expect(offGoalSavedNote([{ contribution_cents: 2500 }, { contribution_cents: 0, off_goal: true }])).toBe("");
  });
});
