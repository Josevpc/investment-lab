import { describe, expect, it } from "vitest";
import { ApiError } from "@/shared/lib/api";
import { formatBRL } from "@/shared/lib/format";
import type { Account, Entry } from "../types";
import {
  apiAmount,
  cashEffect,
  cashErrorHint,
  deleteMessage,
  describeEntry,
  differenceWords,
  matchesText,
  MAX_CENTS,
  entryProblem,
  entrySuccess,
  lockedReason,
  openingProblem,
  periodStart,
  signOf,
  transferProblem,
  type EntryNames,
} from "./entries";

const names: EntryNames = {
  asset: (id) => ({ 7: "HGLG11" })[id],
  account: (id) => ({ 2: "Banco Inter" })[id],
};

function entry(over: Partial<Entry>): Entry {
  return {
    id: 1,
    account_id: 1,
    date: "2026-10-10",
    kind: "deposito",
    amount_cents: 10_000,
    asset_id: null,
    movement_id: null,
    transfer_id: null,
    counterpart_account_id: null,
    balance_cents: 10_000,
    deletable: true,
    ...over,
  };
}

const account: Account = {
  id: 1,
  name: "XP",
  institution_id: 1,
  archived: false,
  cash_enabled: true,
  opening_date: "2026-10-01",
  balance_cents: 50_000,
};

describe("sinais", () => {
  it("escreve o sinal, não só a cor", () => {
    expect(signOf(100)).toBe("+");
    expect(signOf(-100)).toBe("−");
    expect(signOf(0)).toBe("");
  });

  it("depósito entra, retirada e taxa saem; ajuste segue o sentido escolhido", () => {
    expect(cashEffect("deposito", 500)).toBe(500);
    expect(cashEffect("retirada", 500)).toBe(-500);
    expect(cashEffect("taxa", 500)).toBe(-500);
    expect(cashEffect("ajuste", 500, "in")).toBe(500);
    expect(cashEffect("ajuste", 500, "out")).toBe(-500);
  });

  it("manda à API o valor positivo para depósito, retirada e taxa e com sinal para o ajuste", () => {
    expect(apiAmount("retirada", 500)).toBe(500);
    expect(apiAmount("taxa", 500)).toBe(500);
    expect(apiAmount("ajuste", 500, "out")).toBe(-500);
  });
});

describe("descrição dos lançamentos", () => {
  it("diz de onde veio o dinheiro", () => {
    expect(describeEntry(entry({ kind: "compra", amount_cents: -100, asset_id: 7, movement_id: 3 }), names)).toBe("Compra de HGLG11");
    expect(describeEntry(entry({ kind: "provento", asset_id: 7, movement_id: 3 }), names)).toBe("Pago por HGLG11");
    expect(describeEntry(entry({ kind: "deposito", asset_id: 7, movement_id: 3 }), names)).toBe("Dinheiro novo do aporte em HGLG11");
    expect(describeEntry(entry({ kind: "deposito", asset_id: 7 }), names)).toBe("Dinheiro novo para a compra de HGLG11");
    expect(describeEntry(entry({ kind: "deposito" }), names)).toBe("Dinheiro novo na conta");
    expect(describeEntry(entry({ kind: "ajuste", amount_cents: -5 }), names)).toBe("Correção: faltava no caixa");
  });

  it("nomeia a outra conta da transferência, nos dois sentidos", () => {
    const out = entry({ kind: "transferencia", amount_cents: -100, counterpart_account_id: 2, transfer_id: "t" });
    expect(describeEntry(out, names)).toBe("Para Banco Inter");
    expect(describeEntry({ ...out, amount_cents: 100 }, names)).toBe("De Banco Inter");
  });

  it("explica por que não dá para excluir e o que fazer no lugar", () => {
    expect(lockedReason(entry({}))).toBeNull();
    expect(lockedReason(entry({ deletable: false, movement_id: 3 }))).toContain("desfaça o movimento em Movimentações");
    expect(lockedReason(entry({ deletable: false, kind: "saldo_inicial" }))).toContain("não tem outros lançamentos");
  });
});

describe("confirmação de exclusão", () => {
  it("diz o efeito no caixa e no capital aportado", () => {
    expect(deleteMessage(entry({}), "XP", names)).toBe(
      `Excluir o depósito de ${formatBRL(10_000)} de 10/10/2026? O valor sai do caixa e do capital aportado de XP.`,
    );
    expect(deleteMessage(entry({ kind: "retirada", amount_cents: -2_000 }), "XP", names)).toContain("volta ao caixa e ao capital aportado");
    expect(deleteMessage(entry({ kind: "ajuste", amount_cents: -50 }), "XP", names)).toContain(`O caixa de XP aumenta ${formatBRL(50)}`);
  });

  it("na transferência, avisa que os dois lados saem", () => {
    const message = deleteMessage(entry({ kind: "transferencia", amount_cents: -100, counterpart_account_id: 2 }), "XP", names);
    expect(message).toContain("Os dois lados saem: o valor volta para XP e sai de Banco Inter.");
  });

  it("no saldo inicial, avisa que o caixa fica desativado", () => {
    expect(deleteMessage(entry({ kind: "saldo_inicial" }), "XP", names)).toContain("fica desativado");
  });
});

describe("validação antes de enviar", () => {
  const base = { today: "2026-10-20", account };

  it("pede valor maior que zero", () => {
    expect(entryProblem({ ...base, kind: "deposito", cents: null, date: "2026-10-20" })).toBe("Informe um valor maior que zero.");
    expect(entryProblem({ ...base, kind: "deposito", cents: 0, date: "2026-10-20" })).toBe("Informe um valor maior que zero.");
  });

  it("recusa data no futuro ou antes do saldo inicial", () => {
    expect(entryProblem({ ...base, kind: "deposito", cents: 1, date: "2026-10-21" })).toBe("A data não pode ser no futuro.");
    expect(entryProblem({ ...base, kind: "deposito", cents: 1, date: "2026-09-30" })).toContain("a partir de 01/10/2026");
  });

  it("recusa saída maior que o caixa, mas aceita depósito de qualquer valor", () => {
    expect(entryProblem({ ...base, kind: "retirada", cents: 50_001, date: "2026-10-20" })).toBe("É mais do que há no caixa hoje.");
    expect(entryProblem({ ...base, kind: "ajuste", cents: 50_001, direction: "out", date: "2026-10-20" })).not.toBeNull();
    expect(entryProblem({ ...base, kind: "retirada", cents: 50_000, date: "2026-10-20" })).toBeNull();
    expect(entryProblem({ ...base, kind: "deposito", cents: 900_000, date: "2026-10-20" })).toBeNull();
  });

  it("transferência: contas diferentes, datas dentro do caixa das duas e valor dentro do caixa da origem", () => {
    const other = { ...account, id: 2, name: "Inter", opening_date: "2026-10-15", balance_cents: 0 };
    const t = { today: "2026-10-20", date: "2026-10-20", cents: 1_000 };
    expect(transferProblem({ ...t, from: undefined, to: other })).toBe("Escolha a conta de origem.");
    expect(transferProblem({ ...t, from: account, to: account })).toBe("Escolha contas diferentes.");
    expect(transferProblem({ ...t, from: account, to: other, date: "2026-10-10" })).toContain("A conta de destino (Inter)");
    expect(transferProblem({ ...t, from: other, to: account })).toBe("É mais do que há no caixa de hoje da conta de origem.");
    expect(transferProblem({ ...t, from: account, to: other })).toBeNull();
  });

  it("saldo inicial pode ser zero, mas precisa ser informado", () => {
    expect(openingProblem(null, "2026-10-20", "2026-10-20")).toContain("pode ser 0,00");
    expect(openingProblem(0, "2026-10-20", "2026-10-20")).toBeNull();
  });
});

describe("mensagens", () => {
  it("o sucesso diz o que foi feito, o caixa de hoje e o que vem a seguir", () => {
    const parts = entrySuccess("deposito", 10_000, "2026-10-20", 60_000);
    expect(parts).toContainEqual({ cents: 10_000 });
    expect(parts).toContainEqual({ cents: 60_000 });
    expect(parts.at(-1)).toContain("Comprar ativo com o caixa");
  });

  it("diferença da conciliação em palavras", () => {
    expect(differenceWords(1)).toBe("a mais no extrato do que no app");
    expect(differenceWords(-1)).toBe("a menos no extrato do que no app");
    expect(differenceWords(0)).toBe("O caixa confere com o extrato.");
  });

  it("erro do back-end vira próximo passo", () => {
    expect(cashErrorHint(new ApiError("Caixa insuficiente em XP: faltam R$ 10,00 em 20/10/2026.", 422, { shortfall_cents: 1_000 }))).toContain(
      "Registre antes o depósito",
    );
    expect(cashErrorHint(new ApiError("A conta XP só tem caixa a partir de 01/10/2026 (saldo inicial); o lançamento é de 30/09/2026.", 422))).toContain(
      "a partir do saldo inicial",
    );
    expect(cashErrorHint(new ApiError("A conta ainda tem ativos. Mova-os para outra conta ou arquive-os antes.", 409))).toContain("Carteira → Ativos");
    expect(cashErrorHint(new Error("qualquer"))).toBeNull();
  });
});

describe("limites e conferência", () => {
  it("barra valores acima do teto do back-end", () => {
    const base = { today: "2026-10-20", date: "2026-10-20", account };
    expect(entryProblem({ ...base, kind: "deposito", cents: MAX_CENTS + 1 })).toBe("O valor máximo aceito é R$ 100 bilhões.");
    expect(entryProblem({ ...base, kind: "deposito", cents: MAX_CENTS })).toBeNull();
    expect(openingProblem(MAX_CENTS + 1, "2026-10-20", "2026-10-20")).toContain("R$ 100 bilhões");
  });

  it("conferido numa data passada diz a data e não fala do saldo de hoje", () => {
    expect(matchesText("2026-10-20", "2026-10-20")).toBe("O caixa confere com o extrato. Nada a ajustar.");
    expect(matchesText("2026-09-30", "2026-10-20")).toContain("conferia com o extrato em 30/09/2026");
  });
});

describe("período do extrato", () => {
  it("conta meses para trás sem passar por Date", () => {
    expect(periodStart("mes", "2026-10-20")).toBe("2026-10-01");
    expect(periodStart("3m", "2026-02-10")).toBe("2025-12-01");
    expect(periodStart("12m", "2026-10-20")).toBe("2025-11-01");
    expect(periodStart("tudo", "2026-10-20")).toBeUndefined();
  });
});
