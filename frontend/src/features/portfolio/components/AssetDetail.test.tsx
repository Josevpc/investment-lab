import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Asset } from "../types";
import { AssetDetail } from "./AssetDetail";

const base = {
  id: 1,
  name: "CDB Banco X",
  ticker: null,
  class_key: "renda_fixa",
  class_name: "Renda Fixa",
  institution_id: 10,
  institution_name: "XP",
  account_id: 10,
  indexer: "CDI",
  rate_bps: 11_000,
  maturity_date: null,
  quantity: null,
  archived: false,
  hold_only: false,
  balance_is_net: false,
  tax_exempt: false,
  purpose: null,
  asset_type: null,
  fii_segment: null,
  invested_cents: 100_000,
  current_cents: 105_000,
  gain_cents: 5_000,
  return_bps: 500,
  proventos_cents: 0,
  total_return_bps: 500,
  valuation_date: "2026-10-17",
  is_new_investment: false,
  initial_contribution_cents: null,
  initial_contribution_date: null,
} satisfies Asset;

function renderDetail(extra: Partial<Asset> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AssetDetail asset={{ ...base, ...extra }} onEdit={() => {}} />
    </QueryClientProvider>,
  );
}

const taxRow = () => screen.getByText("Imposto de renda").parentElement!;

describe("AssetDetail: imposto de renda na renda fixa", () => {
  it("isento: selo Isento de IR", () => {
    renderDetail({ tax_exempt: true });
    expect(within(taxRow()).getByText("Isento de IR")).toBeInTheDocument();
  });

  it("tributado com saldo bruto", () => {
    renderDetail();
    expect(taxRow()).toHaveTextContent("Tributado, saldo bruto");
  });

  it("tributado com saldo líquido", () => {
    renderDetail({ balance_is_net: true });
    expect(taxRow()).toHaveTextContent("Tributado, saldo líquido de IR");
  });

  it("fora da renda fixa não fala de imposto de renda", () => {
    renderDetail({ class_key: "renda_variavel", class_name: "Renda Variável", indexer: null, rate_bps: null });
    expect(screen.queryByText("Imposto de renda")).not.toBeInTheDocument();
  });
});
