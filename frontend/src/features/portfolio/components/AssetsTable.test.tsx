import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { unprotectedMoney } from "@/test/privacy";
import type { Asset } from "../types";
import { AssetsTable } from "./AssetsTable";

const asset = (patch: Partial<Asset>): Asset => ({
  id: 1,
  name: "ITUB4",
  ticker: "ITUB4",
  class_key: "rv",
  class_name: "Renda Variável",
  institution_id: 1,
  institution_name: "XP",
  indexer: null,
  rate_bps: null,
  maturity_date: null,
  quantity: null,
  archived: false,
  hold_only: false,
  balance_is_net: false,
  purpose: null,
  asset_type: "acao",
  fii_segment: null,
  account_id: null,
  invested_cents: 100_000,
  current_cents: 120_000,
  gain_cents: 20_000,
  return_bps: 2000,
  proventos_cents: 5_000,
  total_return_bps: 2500,
  valuation_date: "2026-10-31",
  is_new_investment: false,
  initial_contribution_cents: null,
  initial_contribution_date: null,
  ...patch,
});

describe("AssetsTable", () => {
  it("os cabeçalhos têm o mesmo respiro lateral das células: '% da categoria' não encosta em 'Rendimento'", () => {
    render(<AssetsTable assets={[asset({})]} onOpen={() => {}} shareOf={1_000_000} />);
    const share = screen.getByRole("columnheader", { name: "% da categoria" });
    const gain = screen.getByRole("columnheader", { name: "Rendimento" });
    expect(share.className).toContain("pr-3");
    expect(gain.className).toContain("pr-3");
    expect(share.className).toContain("text-right");
  });

  it("valores em reais passam por <Money>", () => {
    const { container } = render(<AssetsTable assets={[asset({})]} onOpen={() => {}} />);
    expect(unprotectedMoney(container)).toEqual([]);
    expect(within(screen.getByRole("row", { name: /ITUB4/ })).getAllByText(/R\$/).length).toBeGreaterThan(2);
  });

  it("o código do ativo usa o cinza do tema (legível no escuro)", () => {
    render(<AssetsTable assets={[asset({ name: "Itaú" })]} onOpen={() => {}} />);
    const ticker = screen.getByText("ITUB4", { selector: "span" });
    expect(ticker.className).toContain("text-ink-3");
  });
});
