import { describe, expect, it } from "vitest";
import type { ComparisonItem } from "../types";
import { ApiError } from "@/shared/lib/api";
import { adjustedTargetNote, fullyHeldNames, isAllHeldSplitError, targetShareOfPortfolio, targetStatus } from "./comparison";

const item = (patch: Partial<ComparisonItem>): ComparisonItem => ({
  class_id: 1,
  class_key: "rf",
  class_name: "Renda fixa",
  color: "#000",
  current_cents: 100,
  current_bps: 4000,
  target_bps: 5000,
  effective_target_bps: 5000,
  hold_status: "none",
  diff_cents: 0,
  held_assets: [],
  ...patch,
});

describe("targetStatus", () => {
  it("descreve acima, abaixo e na meta", () => {
    expect(targetStatus(item({ diff_cents: 10 }))).toBe("acima da meta");
    expect(targetStatus(item({ diff_cents: -10 }))).toBe("abaixo da meta");
    expect(targetStatus(item({}))).toBe("na meta");
  });

  it("parcialmente mantida continua com meta", () => {
    expect(targetStatus(item({ hold_status: "partial", diff_cents: -10 }))).toBe("abaixo da meta");
  });

  it("não fala de meta na categoria toda mantida", () => {
    expect(targetStatus(item({ hold_status: "all", diff_cents: null }))).toBeNull();
  });
});

describe("targetShareOfPortfolio", () => {
  it("sem mantidas, é a própria meta", () => {
    expect(targetShareOfPortfolio(item({}), { base_cents: 1000, total_cents: 1000 })).toBe(5000);
  });

  it("converte a meta ajustada para a carteira toda", () => {
    // 71,43% de R$ 700 (sem a mantida) = R$ 500 = 50% de R$ 1.000.
    expect(targetShareOfPortfolio(item({ effective_target_bps: 7143 }), { base_cents: 70000, total_cents: 100000 })).toBe(5000);
  });

  it("não tem meta na toda mantida", () => {
    expect(targetShareOfPortfolio(item({ hold_status: "all", effective_target_bps: 0 }), { base_cents: 1, total_cents: 2 })).toBeNull();
  });
});

describe("adjustedTargetNote", () => {
  const rv = item({ class_key: "rv", class_name: "Renda variável", hold_status: "all", target_bps: 3000, effective_target_bps: 0, diff_cents: null });
  const rf = item({ target_bps: 5000, effective_target_bps: 7143 });
  const cripto = item({ class_key: "cripto", class_name: "Cripto", hold_status: "partial", target_bps: 2000, effective_target_bps: 2857 });
  const items = [rf, rv, cripto];

  it("explica a meta reescalada e por quê", () => {
    expect(adjustedTargetNote(rf, items)).toBe("meta 50%, ajustada para 71,43% porque Renda variável está toda mantida");
    expect(adjustedTargetNote(cripto, items)).toBe("meta 20%, ajustada para 28,57% porque Renda variável está toda mantida");
  });

  it("não explica nada na mantida nem quando a meta não mudou", () => {
    expect(adjustedTargetNote(rv, items)).toBeNull();
    expect(adjustedTargetNote(item({}), [item({})])).toBeNull();
  });

  it("lista várias mantidas no plural", () => {
    const fii = { ...rv, class_key: "fii", class_name: "FIIs" };
    expect(adjustedTargetNote(rf, [rf, rv, fii])).toBe(
      "meta 50%, ajustada para 71,43% porque Renda variável e FIIs estão todas mantidas",
    );
    expect(fullyHeldNames([rf, rv, fii])).toEqual(["Renda variável", "FIIs"]);
  });
});

describe("isAllHeldSplitError", () => {
  const message = "Todos os ativos de todas as categorias estão em 'manter posição'. Desmarque algum ativo para dividir o aporte.";

  it("usa o código all_held quando o back-end manda", () => {
    expect(isAllHeldSplitError(new ApiError("qualquer texto", 422, { code: "all_held" }))).toBe(true);
    expect(isAllHeldSplitError(new ApiError(message, 422, { code: "outro" }))).toBe(false);
    expect(isAllHeldSplitError(new ApiError(message, 400, { code: "all_held" }))).toBe(false);
  });

  it("sem código, reconhece pelo texto e ignora outros erros", () => {
    expect(isAllHeldSplitError(new ApiError(message, 422))).toBe(true);
    expect(isAllHeldSplitError(new ApiError("Plano não encontrado.", 404))).toBe(false);
    expect(isAllHeldSplitError(new ApiError("Valor inválido.", 422))).toBe(false);
    expect(isAllHeldSplitError(new Error(message))).toBe(false);
  });
});
