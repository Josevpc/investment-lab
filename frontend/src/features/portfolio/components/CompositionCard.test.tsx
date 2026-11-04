import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { unprotectedMoney } from "@/test/privacy";
import type { PortfolioSummary } from "../types";
import { CompositionCard } from "./CompositionCard";

const summary = {
  by_type: [
    { asset_type: "acao", label: "Ações", assets_count: 2, current_cents: 600_000, invested_cents: 500_000, share_bps: 6000 },
    { asset_type: "fii", label: "Fundos imobiliários", assets_count: 1, current_cents: 400_000, invested_cents: 380_000, share_bps: 4000 },
  ],
  fii_segments: [
    { segment: "papel", label: "Papel", assets_count: 1, current_cents: 250_000, invested_cents: 240_000, proventos_cents: 12_345, share_bps: 6250 },
    { segment: "tijolo", label: "Tijolo", assets_count: 2, current_cents: 150_000, invested_cents: 140_000, proventos_cents: 0, share_bps: 3750 },
  ],
  untyped_count: 1,
  untyped_current_cents: 75_000,
} as PortfolioSummary;

describe("CompositionCard", () => {
  it("todo valor em reais passa por <Money>, para 'ocultar valores' funcionar", () => {
    const { container } = render(<CompositionCard summary={summary} />);
    expect(unprotectedMoney(container)).toEqual([]);
  });

  it("mostra os proventos, o total em FIIs e o valor sem tipo", () => {
    render(<CompositionCard summary={summary} />);
    const text = document.body.textContent?.replace(/\s/g, " ") ?? "";
    expect(text).toContain("proventos: R$ 123,45");
    expect(text).toContain("Total em FIIs: R$ 4.000,00");
    expect(text).toContain("proventos recebidos: R$ 123,45");
    expect(text).toMatch(/1 ativo de renda variável está sem tipo \(R\$ 750,00\)/);
    expect(screen.getByText("Papel")).toBeInTheDocument();
  });
});
