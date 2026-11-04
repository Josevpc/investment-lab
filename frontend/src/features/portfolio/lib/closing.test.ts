import { describe, expect, it } from "vitest";
import type { Asset } from "../types";
import { previewClosing } from "./closing";

const cdb = { invested_cents: 100_000, current_cents: 108_000 } as Asset;

describe("previewClosing", () => {
  it("separa o aporte do rendimento", () => {
    const preview = previewClosing(cdb, { contribution: "500", balance: "1.595,00", investedOverride: null });
    expect(preview.valid).toBe(true);
    expect(preview.contributionCents).toBe(50_000);
    expect(preview.investedCents).toBe(150_000); // 1.000 + aporte de 500
    expect(preview.gainCents).toBe(9_500); // 1.595 - 1.500
    expect(preview.changed).toBe(true);
  });

  it("sem aporte o investido não muda e só o saldo conta", () => {
    const preview = previewClosing(cdb, { contribution: "", balance: "1.100,00", investedOverride: null });
    expect(preview.investedCents).toBe(100_000);
    expect(preview.gainCents).toBe(10_000);
    expect(preview.changed).toBe(true);
  });

  it("não considera alterado quando nada foi mexido", () => {
    const preview = previewClosing(cdb, { contribution: "", balance: "1.080,00", investedOverride: null });
    expect(preview.changed).toBe(false);
    expect(preview.gainCents).toBe(8_000);
  });

  it("permite corrigir o investido e ainda somar o aporte", () => {
    const preview = previewClosing(cdb, { contribution: "100", balance: "1.080,00", investedOverride: "900" });
    expect(preview.investedOverrideCents).toBe(90_000);
    expect(preview.investedCents).toBe(100_000); // 900 corrigido + 100 de aporte
    expect(preview.gainCents).toBe(8_000);
  });

  it("mostra rendimento negativo quando o saldo ficou abaixo do investido", () => {
    expect(previewClosing(cdb, { contribution: "", balance: "900,00", investedOverride: null }).gainCents).toBe(-10_000);
  });

  it("recusa valores inválidos", () => {
    expect(previewClosing(cdb, { contribution: "abc", balance: "1", investedOverride: null }).valid).toBe(false);
    expect(previewClosing(cdb, { contribution: "", balance: "", investedOverride: null }).valid).toBe(false);
    expect(previewClosing(cdb, { contribution: "", balance: "1", investedOverride: "x" }).valid).toBe(false);
  });

  it("o dia do aporte vale quando informado e não pode ser depois do saldo", () => {
    const input = { contribution: "100", balance: "1.102,00", investedOverride: null, contributionDate: "2026-10-15" };
    const ok = previewClosing(cdb, input, "2026-10-31");
    expect(ok.valid).toBe(true);
    expect(ok.contributionDate).toBe("2026-10-15");
    expect(previewClosing(cdb, { ...input, contributionDate: "2026-11-02" }, "2026-10-31").valid).toBe(false);
  });

  it("sem dia informado o aporte fica sem data própria (vale a data do saldo)", () => {
    const preview = previewClosing(cdb, { contribution: "100", balance: "1.102,00", investedOverride: null }, "2026-10-31");
    expect(preview.contributionDate).toBeNull();
  });
});
