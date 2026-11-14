import { describe, expect, it } from "vitest";
import type { Asset, AssetClass } from "@/features/portfolio";
import type { Account, Reservation } from "../types";
import { entryProblem, transferProblem } from "./entries";
import {
  eligibleReserved,
  groupReservations,
  purchaseSplit,
  purchaseSuccessWithReserved,
  releaseProblem,
  reserveEffect,
  reserveProblem,
  reserveSuccess,
  validReserveClasses,
} from "./reserve";
import { freeCents, reservedCents } from "./split";

const cls = (id: number, key: string, archived = false) => ({ id, key, name: key.toUpperCase(), color: "#000", archived }) as AssetClass;
const asset = (key: string, extra: Partial<Asset> = {}) => ({ class_key: key, archived: false, hold_only: false, purpose: null, ...extra }) as Asset;

function reservation(id: number, extra: Partial<Reservation> = {}): Reservation {
  return {
    id,
    account_id: 1,
    class_id: 3,
    class_name: "FII",
    date: "2026-10-05",
    amount_cents: 30_000,
    used_cents: 0,
    released_cents: 0,
    remaining_cents: 30_000,
    deletable: true,
    ...extra,
  };
}

const text = (parts: readonly (string | { cents: number })[]) => parts.map((p) => (typeof p === "string" ? p : `[${p.cents}]`)).join("");

describe("caixa livre e separado", () => {
  it("sem os campos novos, tudo é livre e nada está separado", () => {
    expect(reservedCents({})).toBe(0);
    expect(freeCents({ balance_cents: 50_000 })).toBe(50_000);
  });

  it("usa o que a API manda; sem o livre, deduz do total", () => {
    expect(freeCents({ balance_cents: 50_000, reserved_cents: 20_000, free_cents: 30_000 })).toBe(30_000);
    expect(freeCents({ balance_cents: 50_000, reserved_cents: 20_000 })).toBe(30_000);
  });
});

describe("categorias válidas para separar", () => {
  it("tira arquivadas e as que só têm ativos em manter posição ou a reserva", () => {
    const classes = [cls(1, "fii"), cls(2, "acoes"), cls(3, "rf"), cls(4, "etf"), cls(5, "cripto", true)];
    const assets = [
      asset("fii"),
      asset("acoes", { hold_only: true }),
      asset("rf", { purpose: "reserva" }),
      asset("rf", { archived: true }),
      asset("etf", { hold_only: true }),
      asset("etf"),
    ];
    expect(validReserveClasses(classes, assets).map((c) => c.key)).toEqual(["fii", "etf"]);
  });

  it("categoria sem ativos ainda vale", () => {
    expect(validReserveClasses([cls(1, "fii")], []).map((c) => c.key)).toEqual(["fii"]);
  });
});

describe("separar: problema e efeito", () => {
  const base = { classId: 3, cents: 10_000, date: "2026-11-10", today: "2026-11-12", openingDate: "2026-10-01", freeCents: 40_000, deposit: false };

  it("pede categoria, valor e data válidos", () => {
    expect(reserveProblem({ ...base, classId: null })).toBe("Escolha a categoria.");
    expect(reserveProblem({ ...base, cents: null })).toBe("Informe um valor maior que zero.");
    expect(reserveProblem({ ...base, cents: 0 })).toBe("Informe um valor maior que zero.");
    expect(reserveProblem({ ...base, date: "2026-11-13" })).toBe("A data não pode ser no futuro.");
    expect(reserveProblem({ ...base, date: "2026-09-30" })).toContain("a partir de 01/10/2026");
    expect(reserveProblem(base)).toBeNull();
  });

  it("acima do caixa livre só passa com o depósito", () => {
    expect(reserveProblem({ ...base, cents: 40_001 })).toContain("O caixa livre não cobre");
    expect(reserveProblem({ ...base, cents: 40_001, deposit: true })).toBeNull();
    expect(reserveProblem({ ...base, cents: 40_000 })).toBeNull();
  });

  it("sem depósito o total não muda; com depósito o valor inteiro entra", () => {
    const input = { cents: 10_000, balanceCents: 50_000, freeCents: 40_000, reservedCents: 0 };
    expect(reserveEffect({ ...input, deposit: false })).toEqual({ deposited: 0, freeAfter: 30_000, reservedAfter: 10_000, totalAfter: 50_000 });
    expect(reserveEffect({ ...input, deposit: true })).toEqual({ deposited: 10_000, freeAfter: 40_000, reservedAfter: 10_000, totalAfter: 60_000 });
  });

  it("a mensagem de sucesso diz o que foi feito e o que vem a seguir", () => {
    const message = text(reserveSuccess({ cents: 10_000, className: "FII", date: "2026-11-10", deposited: 0, freeAfter: 30_000 }));
    expect(message).toBe(
      "[10000] separados para FII (10/11/2026). Caixa livre: [30000]. O dinheiro continua na conta, ainda não investido. Quando comprar um ativo de FII com o caixa desta conta, o valor sai do separado primeiro.",
    );
    expect(text(reserveSuccess({ cents: 10_000, className: "FII", date: "2026-11-10", deposited: 10_000, freeAfter: 40_000 }))).toMatch(
      /^Depositados \[10000\] e separados para FII/,
    );
  });
});

describe("compra: de onde sai o dinheiro", () => {
  it("só conta o separado da categoria e já existente na data da compra", () => {
    const list = [
      reservation(1, { remaining_cents: 20_000 }),
      reservation(2, { class_name: "Ações", remaining_cents: 5_000 }),
      reservation(3, { date: "2026-11-20", remaining_cents: 7_000 }),
    ];
    expect(eligibleReserved(list, "FII", "2026-11-12")).toBe(20_000);
    expect(eligibleReserved(list, "FII", "2026-11-25")).toBe(27_000);
    expect(eligibleReserved(list, undefined, "2026-11-12")).toBe(0);
  });

  it("gasta primeiro o separado e completa com o caixa livre", () => {
    expect(purchaseSplit(50_000, 20_000)).toEqual({ fromReserved: 20_000, fromFree: 30_000 });
    expect(purchaseSplit(10_000, 20_000)).toEqual({ fromReserved: 10_000, fromFree: 0 });
    expect(purchaseSplit(10_000, 0)).toEqual({ fromReserved: 0, fromFree: 10_000 });
  });

  it("a mensagem de sucesso traz o que saiu de cada lado e o que ainda sobra separado", () => {
    const base = { cents: 50_000, assetName: "HGLG11", className: "FII", date: "2026-11-12", fromReserved: 20_000, fromFree: 30_000, depositCents: 0, cashBalance: 40_000 };
    expect(text(purchaseSuccessWithReserved({ ...base, reservedLeft: 15_000 }))).toMatch(
      /^Compra registrada\. \[20000\] saíram do separado e \[30000\] do caixa livre\. Ainda há \[15000\] separados para FII\./,
    );
    expect(text(purchaseSuccessWithReserved({ ...base, reservedLeft: 0 }))).not.toContain("Ainda há");
  });
});

describe("liberar e agrupar", () => {
  it("não deixa liberar mais que o restante", () => {
    expect(releaseProblem(null, 10_000)).toBe("Informe um valor maior que zero.");
    expect(releaseProblem(10_001, 10_000)).toContain("O máximo que dá para liberar é R$");
    expect(releaseProblem(10_000, 10_000)).toBeNull();
  });

  it("agrupa por categoria, com as que têm restante primeiro e as só encerradas no fim", () => {
    const groups = groupReservations({
      by_class: [{ class_id: 3, class_name: "FII", color: "#5e8a57", remaining_cents: 30_000 }],
      reservations: [reservation(1), reservation(2, { class_id: 9, class_name: "Cripto", remaining_cents: 0 }), reservation(3, { date: "2026-10-20" })],
    });
    expect(groups.map((g) => [g.className, g.items.map((r) => r.id), g.color])).toEqual([
      ["FII", [1, 3], "#5e8a57"],
      ["Cripto", [2], null],
    ]);
  });
});

describe("o separado não sai por retirada, taxa nem transferência", () => {
  const account: Account = {
    id: 1,
    name: "XP",
    institution_id: 1,
    archived: false,
    cash_enabled: true,
    opening_date: "2026-10-01",
    balance_cents: 50_000,
    reserved_cents: 20_000,
    free_cents: 30_000,
  };

  it("retirada limitada ao caixa livre, com o motivo", () => {
    const input = { kind: "retirada" as const, date: "2026-11-10", today: "2026-11-12", account };
    expect(entryProblem({ ...input, cents: 30_000 })).toBeNull();
    expect(entryProblem({ ...input, cents: 30_001 })).toContain("caixa livre");
    // Sem separado, a mensagem de sempre.
    expect(entryProblem({ ...input, cents: 50_001, account: { ...account, reserved_cents: 0, free_cents: 50_000 } })).toBe(
      "É mais do que há no caixa hoje.",
    );
  });

  it("depósito não é limitado pelo caixa", () => {
    expect(entryProblem({ kind: "deposito", cents: 90_000, date: "2026-11-10", today: "2026-11-12", account })).toBeNull();
  });

  it("transferência limitada ao caixa livre da origem", () => {
    const to = { ...account, id: 2, name: "Inter", reserved_cents: 0, free_cents: 0, balance_cents: 0 };
    const input = { from: account, to, date: "2026-11-10", today: "2026-11-12" };
    expect(transferProblem({ ...input, cents: 30_000 })).toBeNull();
    expect(transferProblem({ ...input, cents: 30_001 })).toContain("caixa livre da conta de origem");
  });
});
