import { describe, expect, it } from "vitest";
import type { Asset } from "../types";
import { daysBetween, lastBalanceDate, staleAssets } from "./staleBalances";

const asset = (patch: Partial<Asset>): Asset => ({ id: 1, name: "CDB", archived: false, valuation_date: "2026-10-30", ...patch }) as Asset;

describe("daysBetween", () => {
  it("conta dias inteiros, também na virada de mês e de ano", () => {
    expect(daysBetween("2026-10-20", "2026-10-30")).toBe(10);
    expect(daysBetween("2026-12-28", "2027-01-03")).toBe(6);
    expect(daysBetween("2026-10-30", "2026-10-30")).toBe(0);
  });

  it("não sofre com a mudança de horário de verão", () => {
    expect(daysBetween("2018-11-01", "2018-11-05")).toBe(4);
    expect(daysBetween("2019-02-10", "2019-02-20")).toBe(10);
  });
});

describe("staleAssets", () => {
  const today = "2026-10-30";

  it("só avisa de saldo com mais de 10 dias (10 ainda está em dia)", () => {
    const list = staleAssets(
      [asset({ id: 1, name: "A", valuation_date: "2026-10-20" }), asset({ id: 2, name: "B", valuation_date: "2026-10-19" })],
      today,
    );
    expect(list.map((e) => e.asset.name)).toEqual(["B"]);
    expect(list[0].days).toBe(11);
  });

  it("ordena do mais atrasado ao mais recente e desempata pelo nome", () => {
    const list = staleAssets(
      [
        asset({ id: 1, name: "Zeta", valuation_date: "2026-10-01" }),
        asset({ id: 2, name: "Alfa", valuation_date: "2026-10-01" }),
        asset({ id: 3, name: "Beta", valuation_date: "2026-09-01" }),
      ],
      today,
    );
    expect(list.map((e) => e.asset.name)).toEqual(["Beta", "Alfa", "Zeta"]);
  });

  it("ignora ativo arquivado", () => {
    expect(staleAssets([asset({ archived: true, valuation_date: "2026-01-01" })], today)).toEqual([]);
  });
});

describe("lastBalanceDate", () => {
  it("é a data mais recente entre os ativos ativos", () => {
    expect(
      lastBalanceDate([
        asset({ valuation_date: "2026-10-05" }),
        asset({ id: 2, valuation_date: "2026-10-28" }),
        asset({ id: 3, archived: true, valuation_date: "2026-10-30" }),
      ]),
    ).toBe("2026-10-28");
  });

  it("é null sem ativos", () => {
    expect(lastBalanceDate([])).toBeNull();
  });
});
