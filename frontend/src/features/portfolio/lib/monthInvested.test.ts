import { describe, expect, it } from "vitest";
import { investedDetail } from "./monthInvested";

describe("investedDetail", () => {
  it("separa aportes de ativos novos e cita os nomes", () => {
    expect(
      investedDetail({
        registered_cents: 90_000,
        new_assets_cents: 150_000,
        new_assets: [
          { asset_id: 1, asset_name: "CDB X", amount_cents: 100_000 },
          { asset_id: 2, asset_name: "Tesouro IPCA", amount_cents: 50_000 },
        ],
      }),
    ).toEqual([{ cents: 90_000 }, " em aportes + ", { cents: 150_000 }, " em ativos novos (CDB X e Tesouro IPCA)"]);
  });

  it("um ativo novo fica no singular", () => {
    const parts = investedDetail({ registered_cents: 0, new_assets_cents: 100, new_assets: [{ asset_id: 1, asset_name: "CDB X", amount_cents: 100 }] });
    expect(parts?.at(-1)).toBe(" em ativo novo (CDB X)");
  });

  it("sem ativo novo no mês, não há o que detalhar", () => {
    expect(investedDetail({ registered_cents: 90_000, new_assets_cents: 0, new_assets: [] })).toBeNull();
  });
});
