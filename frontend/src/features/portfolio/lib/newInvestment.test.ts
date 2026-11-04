import { describe, expect, it } from "vitest";
import type { Asset, Movement } from "../types";
import { assetSavedMessage, createdText, newOptionLabel, uncountDone, uncountMessage, updateInputFrom } from "./newInvestment";

const nb = (text: string) => text.replace(/\u00a0/g, " ");
const flat = (parts: (string | { cents: number })[]) => parts.map((p) => (typeof p === "string" ? p : `[${p.cents}]`)).join("");

function asset(extra: Partial<Asset> = {}): Asset {
  return {
    id: 7,
    name: "CDB Banco X",
    ticker: null,
    class_key: "renda_fixa",
    class_name: "Renda Fixa",
    institution_id: 10,
    institution_name: "XP",
    account_id: 3,
    indexer: "CDI",
    rate_bps: 11_000,
    maturity_date: "2028-01-03",
    quantity: null,
    archived: false,
    hold_only: true,
    balance_is_net: false,
    purpose: null,
    asset_type: null,
    fii_segment: null,
    invested_cents: 100_000,
    current_cents: 100_500,
    gain_cents: 500,
    return_bps: 50,
    proventos_cents: 0,
    total_return_bps: 50,
    valuation_date: "2026-10-20",
    is_new_investment: false,
    initial_contribution_cents: null,
    initial_contribution_date: null,
    ...extra,
  };
}

const asNew = asset({ is_new_investment: true, initial_contribution_cents: 100_000, initial_contribution_date: "2026-10-05" });

describe("rótulo da opção Novo", () => {
  it("cita o mês da data; sem data conhecida, o mês do cadastro", () => {
    expect(newOptionLabel("2026-10-31")).toBe("Novo: estou aplicando esse dinheiro agora (conta como aporte de outubro)");
    expect(newOptionLabel(null)).toBe("Novo: estou aplicando esse dinheiro agora (conta como aporte do mês do cadastro)");
  });
});

describe("mensagem depois de editar", () => {
  it("sem trocar novo/antigo, só confirma", () => {
    expect(flat(assetSavedMessage(asset(), asset()))).toBe("Alterações em CDB Banco X salvas.");
  });

  it("antigo virou novo: o valor do cadastro conta como aporte do mês", () => {
    expect(flat(assetSavedMessage(asset(), asNew))).toBe("Alterações em CDB Banco X salvas. [100000] agora conta como aporte de outubro.");
  });

  it("novo virou antigo: o valor sai do aporte e o saldo não muda", () => {
    expect(flat(assetSavedMessage(asNew, asset()))).toBe(
      "Alterações em CDB Banco X salvas. [100000] deixou de contar como aporte de outubro; o saldo não mudou.",
    );
  });
});

describe("comemoração do cadastro", () => {
  it("novo diz quanto conta como aporte e de que mês", () => {
    expect(nb(createdText(asNew))).toBe("CDB Banco X entrou na carteira e R$ 1.000,00 contam como aporte de outubro.");
  });

  it("antigo diz que não conta como aporte", () => {
    expect(createdText(asset())).toContain("Como já existia, não conta como aporte.");
  });
});

describe("não contar como aporte", () => {
  const movement: Movement = {
    id: 9,
    date: "2026-10-05",
    kind: "aporte",
    asset_id: 7,
    asset_name: "CDB Banco X",
    related_asset_id: null,
    related_asset_name: null,
    amount_cents: 100_000,
    cost_cents: null,
    initial: true,
    note: null,
    in_balance: false,
  };

  it("a confirmação diz que o saldo não muda e como voltar atrás", () => {
    const text = nb(uncountMessage(movement));
    expect(text).toContain("Não contar R$ 1.000,00 de CDB Banco X como aporte de outubro (05/10/2026)?");
    expect(text).toContain("o saldo não muda");
    expect(text).toContain('edite o ativo e marque "Novo"');
    expect(nb(uncountDone(movement))).toBe("R$ 1.000,00 de CDB Banco X não conta mais como aporte de outubro. O saldo do ativo não mudou.");
  });

  it("o PUT leva o cadastro inteiro, mantém a conta e muda só o pedido", () => {
    expect(updateInputFrom(asset(), { is_new_investment: false })).toEqual({
      name: "CDB Banco X",
      class_key: "renda_fixa",
      institution_id: 10,
      account_id: null,
      ticker: null,
      indexer: "CDI",
      rate_bps: 11_000,
      maturity_date: "2028-01-03",
      quantity: null,
      purpose: null,
      asset_type: null,
      fii_segment: null,
      hold_only: true,
      balance_is_net: false,
      archived: false,
      is_new_investment: false,
    });
  });
});
