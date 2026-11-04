import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { unprotectedMoney } from "@/test/privacy";
import { GroupDistribution } from "./GroupDistribution";

const rows = [
  { key: "g1", label: "Renda variável", color: "#8a6bbf", bps: 6000, currentCents: 60_000, investedCents: 50_000 },
  { key: "none", label: "Sem grupo", color: null, bps: 4000, currentCents: 40_000, investedCents: 40_000 },
] as Parameters<typeof GroupDistribution>[0]["rows"];

describe("GroupDistribution", () => {
  it("as barras são a barra seixo do produto, com nome e percentual por escrito", () => {
    render(<GroupDistribution rows={rows} investmentsCents={100_000} />);
    const bar = screen.getByRole("img", { name: "Renda variável: 60% dos investimentos" });
    expect(bar.querySelector("[data-fill]")).toHaveStyle({ width: "60%" });
    expect(screen.getByRole("img", { name: "Sem grupo: 40% dos investimentos" })).toBeInTheDocument();
  });

  it("usa só os tokens do tema (nada da paleta antiga) e os valores passam por <Money>", () => {
    const { container } = render(<GroupDistribution rows={rows} investmentsCents={100_000} />);
    expect(container.innerHTML).not.toMatch(/slate-|blue-|divide-|border/);
    expect(unprotectedMoney(container)).toEqual([]);
  });
});
