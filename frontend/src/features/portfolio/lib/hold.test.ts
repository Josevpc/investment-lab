import { describe, expect, it } from "vitest";
import { classHoldStatus, holdChangeNotice } from "./hold";

const a = (id: number, hold_only: boolean, extra: Partial<{ class_key: string; archived: boolean; purpose: "reserva" | null }> = {}) => ({
  id,
  class_key: "rv",
  hold_only,
  archived: false,
  purpose: null,
  ...extra,
});

describe("classHoldStatus", () => {
  it("toda mantida, parcial e nenhuma", () => {
    expect(classHoldStatus([a(1, true), a(2, true)], "rv")).toBe("all");
    expect(classHoldStatus([a(1, true), a(2, false)], "rv")).toBe("partial");
    expect(classHoldStatus([a(1, false)], "rv")).toBe("none");
  });

  it("sem ativos não é mantida; arquivados e reserva não contam", () => {
    expect(classHoldStatus([], "rv")).toBe("none");
    expect(classHoldStatus([a(1, true), a(2, false, { archived: true })], "rv")).toBe("all");
    expect(classHoldStatus([a(1, true), a(2, false, { purpose: "reserva" })], "rv")).toBe("all");
    expect(classHoldStatus([a(1, true, { class_key: "rf" })], "rv")).toBe("none");
  });
});

describe("holdChangeNotice", () => {
  const draft = (id: number | null, hold_only: boolean) => ({ id, class_key: "rv", hold_only, archived: false, purpose: null });

  it("novo ativo numa categoria toda mantida avisa que ela volta a receber aportes", () => {
    expect(holdChangeNotice([a(1, true)], draft(null, false), "Renda variável")).toMatch(/^Renda variável está toda mantida hoje\. .*volta a receber/);
  });

  it("novo ativo já marcado como mantido não muda nada", () => {
    expect(holdChangeNotice([a(1, true)], draft(null, true), "Renda variável")).toBeNull();
  });

  it("marcar o último ativo que recebia avisa que a meta fica suspensa", () => {
    expect(holdChangeNotice([a(1, true), a(2, false)], draft(2, true), "Renda variável")).toMatch(/meta dela fica suspensa/);
  });

  it("parcial continua parcial: sem aviso", () => {
    expect(holdChangeNotice([a(1, false), a(2, false)], draft(2, true), "Renda variável")).toBeNull();
  });
});
