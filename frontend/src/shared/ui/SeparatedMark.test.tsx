import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { unprotectedMoney } from "@/test/privacy";
import { ChartLegend } from "./ChartLegend";
import { SeparatedSwatch } from "./SeparatedMark";
import { WealthTooltip } from "./WealthTooltip";

describe("Legenda do gráfico", () => {
  it("lista cada série com o nome por escrito, e a amostra fica fora da árvore de acessibilidade", () => {
    render(
      <ChartLegend
        items={[
          { key: "a", label: "Patrimônio", swatch: <span /> },
          { key: "s", label: "Separado (ainda não investido)", swatch: <SeparatedSwatch /> },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Legenda do gráfico" });
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Patrimônio", "Separado (ainda não investido)"]);
    expect(list.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("a amostra do separado é hachurada e tem contorno tracejado", () => {
    const { container } = render(<SeparatedSwatch />);
    expect(container.querySelector("pattern")).not.toBeNull();
    expect(container.querySelector("rect[stroke-dasharray]")).not.toBeNull();
  });
});

describe("Dica do gráfico de patrimônio", () => {
  const normalize = (text: string | null) => (text ?? "").replace(/\s/g, " ");

  it("sem separado, mostra só o patrimônio e o investido", () => {
    const { container } = render(
      <WealthTooltip active payload={[{ payload: { date: "2026-10-31", total: 1_000_000, invested: 900_000, separated: 0 } }]} />,
    );
    const text = normalize(container.textContent);
    expect(text).toContain("31/10/2026");
    expect(text).toContain("Patrimônio R$ 10.000,00");
    expect(text).toContain("Investido R$ 9.000,00");
    expect(text).not.toContain("Separado");
    expect(text).not.toContain("Total");
  });

  it("com separado, soma na mesma linha: Patrimônio, Separado e Total", () => {
    const { container } = render(
      <WealthTooltip active payload={[{ payload: { date: "2026-10-31", total: 1_000_000, separated: 80_000 } }]} />,
    );
    expect(normalize(container.textContent)).toContain("Patrimônio R$ 10.000,00 · Separado R$ 800,00 · Total R$ 10.800,00");
    expect(unprotectedMoney(container)).toEqual([]);
  });

  it("inativa, não desenha nada", () => {
    const { container } = render(<WealthTooltip active={false} payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
