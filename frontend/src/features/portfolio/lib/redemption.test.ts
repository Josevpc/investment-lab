import { describe, expect, it } from "vitest";
import type { Asset } from "../types";
import { checkRedemption, redemptionCostCents, redemptionDoneParts, redemptionPreview } from "./redemption";

const asset = (over: Partial<Asset> = {}): Asset =>
  ({
    id: 2,
    name: "Cofrinho",
    invested_cents: 71_391,
    current_cents: 80_391,
    valuation_date: "2026-10-15",
    ...over,
  }) as Asset;

/** Junta a frase com os valores já formatados (o espaço do Intl vira espaço comum). */
const text = (parts: readonly (string | { cents: number })[]) =>
  parts.map((p) => (typeof p === "string" ? p : `R$ ${(p.cents / 100).toFixed(2).replace(".", ",")}`)).join("");

describe("redemptionCostCents", () => {
  it("é a proporção do investido, arredondada meio para cima", () => {
    // 71.391 x 10.000 / 80.391 = 8.880,47 -> 8.880; 2,5 sobe para 3
    expect(redemptionCostCents(71_391, 80_391, 10_000)).toBe(8_880);
    expect(redemptionCostCents(5, 2, 1)).toBe(3);
    // meio exato sobe: 3 x 1 / 2 = 1,5 -> 2
    expect(redemptionCostCents(3, 2, 1)).toBe(2);
  });

  it("resgatar tudo leva todo o investido", () => {
    expect(redemptionCostCents(71_391, 80_391, 80_391)).toBe(71_391);
  });

  it("não perde precisão com valores grandes (BigInt)", () => {
    // 9 x 10^12 x 9 x 10^12 passa de 2^53; o resultado exato é metade do investido.
    const inv = 9_000_000_000_000;
    expect(redemptionCostCents(inv, inv * 2, inv)).toBe(inv / 2);
  });

  it("sem saldo ou sem valor, não há prévia", () => {
    expect(redemptionCostCents(100, 0, 10)).toBeNull();
    expect(redemptionCostCents(100, 100, 0)).toBeNull();
  });
});

describe("checkRedemption", () => {
  const base = { asset: asset(), amountText: "100", cents: 10_000, date: "2026-10-20", today: "2026-10-31", alreadyInBalance: false };

  it("valores e datas corretos liberam o registro", () => {
    expect(checkRedemption(base)).toEqual({ amountError: null, dateError: null, blocker: null });
  });

  it("diz o que falta, na ordem: ativo, valor, data", () => {
    expect(checkRedemption({ ...base, asset: undefined }).blocker).toBe("Escolha o ativo do resgate.");
    expect(checkRedemption({ ...base, amountText: "", cents: null }).blocker).toBe("Informe o valor resgatado.");
    expect(checkRedemption({ ...base, date: "" }).blocker).toBe("Informe a data do resgate.");
  });

  it("valor inválido, zero ou maior que o saldo trava e explica no campo", () => {
    expect(checkRedemption({ ...base, amountText: "abc", cents: null }).amountError).toBe("Valor inválido.");
    expect(checkRedemption({ ...base, amountText: "0", cents: 0 }).amountError).toBe("O valor precisa ser maior que zero.");
    const big = checkRedemption({ ...base, amountText: "900", cents: 90_000 });
    expect(big.amountError).toContain("Maior que o saldo registrado de Cofrinho");
    expect(big.blocker).toBe("Corrija o valor indicado acima.");
  });

  it("modo normal: a data não vem antes do último saldo nem no futuro", () => {
    expect(checkRedemption({ ...base, date: "2026-10-10" }).dateError).toContain("Antes do último saldo");
    expect(checkRedemption({ ...base, date: "2026-10-15" }).dateError).toBeNull();
    expect(checkRedemption({ ...base, date: "2026-11-01" }).dateError).toBe("Não pode ser no futuro.");
  });

  it("modo já está no saldo: a data é a do saldo ou antes, e o valor não é limitado pelo saldo", () => {
    const inBalance = { ...base, alreadyInBalance: true };
    expect(checkRedemption({ ...inBalance, date: "2026-10-20" }).dateError).toContain("15/10/2026");
    expect(checkRedemption({ ...inBalance, date: "2026-10-12" }).dateError).toBeNull();
    expect(checkRedemption({ ...inBalance, date: "2026-10-12", amountText: "900", cents: 90_000 }).amountError).toBeNull();
  });
});

describe("redemptionPreview", () => {
  it("mostra de quanto para quanto vão o saldo e o investido", () => {
    const out = text(redemptionPreview(asset(), 10_000, false));
    expect(out).toBe(
      "Saldo de Cofrinho: de R$ 803,91 para R$ 703,91. Investido: de R$ 713,91 para R$ 625,11 (sai a mesma proporção do rendimento, então não aparece como prejuízo).",
    );
  });

  it("no modo já está no saldo, o saldo fica como está e não promete número de investido", () => {
    const out = text(redemptionPreview(asset(), 10_000, true));
    expect(out).toContain("fica no último valor registrado");
    expect(out).not.toContain("digitou");
    expect(out).toContain("o servidor confere se há um saldo digitado nessa data ou depois");
  });
});

describe("redemptionDoneParts", () => {
  const input = {
    assetName: "Cofrinho",
    amountCents: 10_000,
    date: "2026-10-20",
    alreadyInBalance: false,
    creditedAccount: null,
    onReserve: false,
    reserve: null,
  };

  it("diz o que foi feito e que não é prejuízo", () => {
    const out = text(redemptionDoneParts(input));
    expect(out).toContain("Resgate de R$ 100,00 de Cofrinho registrado em 20/10/2026.");
    expect(out).toContain("não é prejuízo");
    expect(out).toContain("linha Resgates do acumulado do ano aparece a partir do próximo fechamento");
    expect(out).not.toContain("passa a mostrar");
  });

  it("reserva abaixo da meta: diz quanto falta e que o próximo aporte sugere repor", () => {
    const out = text(
      redemptionDoneParts({
        ...input,
        onReserve: true,
        reserve: { goal_cents: 1_000_000, balance_cents: 700_000, remaining_cents: 300_000, reached: false },
      }),
    );
    expect(out).toContain("A reserva está R$ 3000,00 abaixo da meta de R$ 10000,00.");
    expect(out).toContain("O próximo aporte já sugere repor");
  });

  it("reserva ainda completa ou sem meta não promete reposição", () => {
    const reached = text(
      redemptionDoneParts({ ...input, onReserve: true, reserve: { goal_cents: 500_000, balance_cents: 600_000, remaining_cents: 0, reached: true } }),
    );
    expect(reached).toContain("continua completa");
    const noGoal = text(
      redemptionDoneParts({ ...input, onReserve: true, reserve: { goal_cents: 0, balance_cents: 600_000, remaining_cents: 0, reached: false } }),
    );
    expect(noGoal).toContain("Defina a meta da reserva");
    expect(noGoal).not.toContain("sugere repor");
  });

  it("menciona o caixa creditado e o saldo mantido", () => {
    const out = text(redemptionDoneParts({ ...input, creditedAccount: "Mercado Pago", alreadyInBalance: true }));
    expect(out).toContain("O valor entrou no caixa de Mercado Pago.");
    expect(out).toContain("O saldo registrado foi mantido");
  });
});
