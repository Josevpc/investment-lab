import { describe, expect, it } from "vitest";
import type { Asset, GroupBreakdown } from "../types";
import { assetDistribution, groupDistribution, MAX_SLICES, MIN_SLICE_BPS } from "./distribution";

const asset = (id: number, name: string, current_cents: number, extra: Partial<Asset> = {}) =>
  ({
    id,
    name,
    institution_name: "Banco",
    class_name: "Renda Fixa",
    purpose: null,
    valuation_date: "2026-10-17",
    current_cents,
    ...extra,
  }) as Asset;

describe("assetDistribution", () => {
  it("ordena do maior para o menor e calcula a participação de cada ativo no total", () => {
    const d = assetDistribution([asset(1, "B", 25_000), asset(2, "A", 75_000)]);

    expect(d.totalCents).toBe(100_000);
    expect(d.slices.map((s) => [s.label, s.cents, s.bps])).toEqual([
      ["A", 75_000, 7_500],
      ["B", 25_000, 2_500],
    ]);
  });

  it("arredonda meio para cima, em pontos-base", () => {
    // 1/3 = 33,33% e 2/3 = 66,67%.
    const d = assetDistribution([asset(1, "A", 100), asset(2, "B", 200)]);
    expect(d.slices.map((s) => s.bps)).toEqual([6_667, 3_333]);
    // 0,5 pb sobe: 1 de 20.000 = 0,5 pb.
    expect(assetDistribution([asset(1, "A", 1), asset(2, "B", 19_999)]).rows.find((r) => r.asset.id === 1)?.bps).toBe(1);
  });

  it("desempata pelo nome, para a ordem não mudar de um carregamento para outro", () => {
    const d = assetDistribution([asset(1, "Zeta", 100), asset(2, "Alfa", 100)]);
    expect(d.slices.map((s) => s.label)).toEqual(["Alfa", "Zeta"]);
  });

  it("cada fatia ganha uma posição na paleta, na ordem, e a primeira é a maior", () => {
    const d = assetDistribution([asset(1, "A", 300), asset(2, "B", 200), asset(3, "C", 100)]);
    expect(d.slices.map((s) => s.slot)).toEqual([0, 1, 2]);
  });

  it("ativo sem saldo não vira fatia, mas continua na tabela com 0%", () => {
    const d = assetDistribution([asset(1, "A", 1_000), asset(2, "Zerado", 0)]);

    expect(d.slices.map((s) => s.label)).toEqual(["A"]);
    expect(d.rows.map((r) => [r.asset.name, r.bps])).toEqual([
      ["A", 10_000],
      ["Zerado", 0],
    ]);
  });

  it("com exatamente o máximo de fatias, mostra todas", () => {
    const assets = Array.from({ length: MAX_SLICES }, (_, i) => asset(i + 1, `Ativo ${i + 1}`, 1_000 - i));
    const d = assetDistribution(assets);

    expect(d.slices).toHaveLength(MAX_SLICES);
    expect(d.slices.some((s) => s.folded.length > 0)).toBe(false);
  });

  it("acima do máximo, os menores viram uma fatia \"Outros\" cinza, com os nomes", () => {
    const assets = Array.from({ length: MAX_SLICES + 2 }, (_, i) => asset(i + 1, `Ativo ${i + 1}`, 10_000 - i * 1_000));
    const d = assetDistribution(assets);

    expect(d.slices).toHaveLength(MAX_SLICES);
    const others = d.slices[d.slices.length - 1];
    expect(others.label).toBe("Outros");
    expect(others.slot).toBeNull(); // sem hue próprio: é o resto
    expect(others.folded).toEqual(["Ativo 6", "Ativo 7", "Ativo 8"]);
    // O valor de "Outros" é a soma dos três menores, não a soma de percentuais já arredondados.
    expect(others.cents).toBe(5_000 + 4_000 + 3_000);
    // As fatias individuais mantêm as posições 0..4.
    expect(d.slices.slice(0, -1).map((s) => s.slot)).toEqual([0, 1, 2, 3, 4]);
  });

  it("a tabela mantém todos os ativos, inclusive os que entraram em \"Outros\"", () => {
    const assets = Array.from({ length: MAX_SLICES + 2 }, (_, i) => asset(i + 1, `Ativo ${i + 1}`, 10_000 - i * 1_000));
    expect(assetDistribution(assets).rows).toHaveLength(MAX_SLICES + 2);
  });

  it("marca os ativos da reserva de emergência", () => {
    const d = assetDistribution([asset(1, "Tesouro Reserva", 500, { purpose: "reserva" }), asset(2, "CDB", 100)]);
    expect(d.slices.find((s) => s.label === "Tesouro Reserva")?.reserve).toBe(true);
    expect(d.slices.find((s) => s.label === "CDB")?.reserve).toBe(false);
  });

  it("diz até que dia valem os saldos: o mais recente entre os ativos", () => {
    const d = assetDistribution([asset(1, "A", 1, { valuation_date: "2026-10-10" }), asset(2, "B", 1, { valuation_date: "2026-10-21" })]);
    expect(d.asOf).toBe("2026-10-21");
  });

  describe("fatias finas demais", () => {
    it("ativo que arredonda para 0 pb não vira fatia própria: a tabela mostra 0%, a pizza não tem fatia", () => {
      // 1 de 1.000.000 = 0,01 pb, que arredonda para 0.
      const d = assetDistribution([asset(1, "Grande", 999_999), asset(2, "Migalha", 1)]);

      expect(d.slices.map((s) => s.label)).toEqual(["Grande"]);
      expect(d.slices.some((s) => s.bps === 0)).toBe(false);
      expect(d.rows.map((r) => [r.asset.name, r.bps])).toEqual([
        ["Grande", 10_000],
        ["Migalha", 0],
      ]);
    });

    it("abaixo de MIN_SLICE_BPS o ativo vai para \"Outros\" e para a lista dos reunidos", () => {
      // Pequeno = 1% do total, abaixo do mínimo.
      const d = assetDistribution([asset(1, "A", 60_000), asset(2, "B", 39_000), asset(3, "Pequeno", 1_000)]);

      expect(MIN_SLICE_BPS).toBeGreaterThan(100);
      expect(d.slices.map((s) => s.label)).toEqual(["A", "B", "Outros"]);
      const others = d.slices[2];
      expect(others.folded).toEqual(["Pequeno"]);
      expect(others.cents).toBe(1_000);
      expect(others.bps).toBe(100); // o percentual escrito é o real
      expect(others.slot).toBeNull();
    });

    it("um ativo exatamente no mínimo continua com fatia própria", () => {
      const cents = MIN_SLICE_BPS; // de 10.000: exatamente MIN_SLICE_BPS pb
      const d = assetDistribution([asset(1, "A", 10_000 - cents), asset(2, "No limite", cents)]);
      expect(d.slices.map((s) => s.label)).toEqual(["A", "No limite"]);
    });

    it("\"Outros\" com 0 pb não entra nas fatias, mas a tabela mantém todos os ativos com os mesmos pb", () => {
      const d = assetDistribution([asset(1, "A", 600_000), asset(2, "B", 399_998), asset(3, "Mig 1", 1), asset(4, "Mig 2", 1)]);

      expect(d.slices.map((s) => s.label)).toEqual(["A", "B"]);
      expect(d.slices.every((s) => s.bps > 0)).toBe(true);
      expect(d.rows.map((r) => [r.asset.name, r.bps])).toEqual([
        ["A", 6_000],
        ["B", 4_000],
        ["Mig 1", 0],
        ["Mig 2", 0],
      ]);
    });

    it("as posições na paleta continuam sequenciais depois de reagrupar", () => {
      const assets = [
        asset(1, "A", 400_000),
        asset(2, "B", 300_000),
        asset(3, "C", 200_000),
        asset(4, "D", 99_000),
        asset(5, "Fina", 1_000),
      ];
      const d = assetDistribution(assets);
      expect(d.slices.map((s) => s.slot)).toEqual([0, 1, 2, 3, null]);
    });

    it("com muitos ativos, os finos e os que passam do máximo se juntam numa só \"Outros\"", () => {
      const big = Array.from({ length: MAX_SLICES }, (_, i) => asset(i + 1, `Ativo ${i + 1}`, 100_000 - i * 1_000));
      const d = assetDistribution([...big, asset(99, "Fino", 1_000)]);

      expect(d.slices).toHaveLength(MAX_SLICES);
      expect(d.slices.at(-1)?.folded).toEqual(["Ativo 6", "Fino"]);
      expect(d.slices.map((s) => s.slot)).toEqual([0, 1, 2, 3, 4, null]);
    });
  });

  describe("valor de desenho (plotCents)", () => {
    const drawnShare = (slices: { plotCents: number }[], i: number) => slices[i].plotCents / slices.reduce((sum, s) => sum + s.plotCents, 0);

    it("sem \"Outros\", é igual ao valor real em todas as fatias", () => {
      const d = assetDistribution([asset(1, "A", 75_000), asset(2, "B", 25_000)]);
      expect(d.slices.map((s) => [s.cents, s.plotCents])).toEqual([
        [75_000, 75_000],
        [25_000, 25_000],
      ]);
    });

    it("\"Outros\" estreito é elevado ao mínimo visual, e as fatias grandes não mudam", () => {
      // "Outros" vale 1% de verdade, mas é desenhado com MIN_SLICE_BPS do que aparece na pizza.
      const d = assetDistribution([asset(1, "A", 60_000), asset(2, "B", 39_000), asset(3, "Pequeno", 1_000)]);

      expect(d.slices.map((s) => s.plotCents).slice(0, 2)).toEqual([60_000, 39_000]);
      expect(d.slices[2].cents).toBe(1_000); // o valor real não muda
      expect(d.slices[2].bps).toBe(100);
      expect(drawnShare(d.slices, 2)).toBeGreaterThanOrEqual(MIN_SLICE_BPS / 10_000);
      // E sobra só o necessário: não infla além do mínimo (3% de 99.000 + P = P => P = 3.062 centavos, arredondado para cima).
      expect(d.slices[2].plotCents).toBe(3_062);
    });

    it("\"Outros\" que já passa do mínimo fica como está", () => {
      const assets = Array.from({ length: MAX_SLICES + 2 }, (_, i) => asset(i + 1, `Ativo ${i + 1}`, 10_000 - i * 1_000));
      const d = assetDistribution(assets);
      expect(d.slices.map((s) => s.plotCents)).toEqual(d.slices.map((s) => s.cents));
    });

    it("quando só sobra \"Outros\", não há o que elevar: o desenho é o valor real", () => {
      // 40 ativos de 2,5% cada: todos abaixo do mínimo, então só existe a fatia reunida.
      const d = assetDistribution(Array.from({ length: 40 }, (_, i) => asset(i + 1, `Fino ${i + 1}`, 100)));
      expect(d.slices).toHaveLength(1);
      expect(d.slices[0].plotCents).toBe(d.slices[0].cents);
    });

    it("o desenho de \"Outros\" nunca passa do total da carteira", () => {
      const d = assetDistribution([asset(1, "A", 600_000), asset(2, "B", 399_000), asset(3, "Fino", 1_000)]);
      const others = d.slices[2];
      expect(others.plotCents).toBeGreaterThan(others.cents);
      expect(others.plotCents).toBeLessThanOrEqual(d.totalCents);
    });
  });

  it("sem ativos ou sem nenhum saldo, não há fatias nem total", () => {
    expect(assetDistribution([])).toEqual({ totalCents: 0, slices: [], rows: [], asOf: null });
    const zero = assetDistribution([asset(1, "A", 0)]);
    expect(zero.totalCents).toBe(0);
    expect(zero.slices).toEqual([]);
    expect(zero.rows).toHaveLength(1);
  });
});

describe("groupDistribution", () => {
  const group = (group_id: number, name: string, current_cents: number, invested_cents: number, share_bps: number): GroupBreakdown => ({
    group_id,
    name,
    color: "#123456",
    current_cents,
    invested_cents,
    share_bps,
  });

  it("ordena do maior para o menor e põe o que sobrou em \"Sem grupo\"", () => {
    const rows = groupDistribution([group(1, "Renda fixa", 20_000, 18_000, 2000), group(2, "Renda variável", 60_000, 50_000, 6000)], {
      currentCents: 100_000,
      investedCents: 90_000,
    });
    expect(rows.map((r) => [r.label, r.currentCents, r.investedCents, r.bps])).toEqual([
      ["Renda variável", 60_000, 50_000, 6000],
      ["Renda fixa", 20_000, 18_000, 2000],
      ["Sem grupo", 20_000, 22_000, 2000],
    ]);
    expect(rows.at(-1)).toMatchObject({ grouped: false, color: null });
  });

  it("sem sobra, não inventa a linha \"Sem grupo\"", () => {
    const rows = groupDistribution([group(1, "Tudo", 10_000, 9_000, 10_000)], { currentCents: 10_000, investedCents: 9_000 });
    expect(rows.map((r) => r.label)).toEqual(["Tudo"]);
  });
});
