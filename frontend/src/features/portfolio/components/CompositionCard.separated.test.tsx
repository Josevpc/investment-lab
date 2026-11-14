import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { unprotectedMoney } from "@/test/privacy";
import type { PortfolioSummary } from "../types";
import { CompositionCard } from "./CompositionCard";

const summary = {
  by_type: [],
  fii_segments: [],
  untyped_count: 0,
  untyped_current_cents: 0,
  by_class: [
    { class_id: 1, class_key: "renda_fixa", class_name: "Renda fixa", color: "#111111", current_cents: 600_000, invested_cents: 500_000, share_bps: 6000 },
    { class_id: 2, class_key: "fii", class_name: "FII", color: "#222222", current_cents: 400_000, invested_cents: 380_000, share_bps: 4000 },
  ],
  reserved_by_class: [{ class_key: "fii", reserved_cents: 100_000 }],
} as unknown as PortfolioSummary;

function renderCard(data: PortfolioSummary) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompositionCard summary={data} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("CompositionCard com dinheiro separado", () => {
  it("a barra da categoria tem o trecho tracejado e o texto 'R$ X separado'", () => {
    const { container } = renderCard(summary);
    const fii = screen.getByRole("img", { name: /FII: 45,45% do total, com parte separada, ainda não investida/ });
    expect(fii.querySelector("[data-part='separated']")?.className).toContain("separated-fill");
    expect(fii.querySelector("[data-part='invested']")).not.toBeNull();
    const item = fii.closest("li")!;
    expect(item.textContent?.replace(/\s/g, " ")).toContain("R$ 1.000,00 separado");
    // A categoria sem separado não ganha trecho tracejado.
    expect(screen.getByRole("img", { name: /Renda fixa: 54,55% do total$/ }).querySelector("[data-part='separated']")).toBeNull();
    expect(unprotectedMoney(container)).toEqual([]);
  });

  it("a legenda diz por extenso o que é o trecho hachurado", () => {
    renderCard(summary);
    expect(within(screen.getByRole("list", { name: "Legenda das barras" })).getByText("Separado (ainda não investido)")).toBeInTheDocument();
  });

  it("a tabela alternativa ganha a coluna Separado", () => {
    renderCard(summary);
    const table = screen.getByRole("table", { name: /dinheiro separado/ });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Categoria", "Investido", "Separado", "% do total"]);
    expect(within(within(table).getByRole("row", { name: /FII/ })).getAllByRole("cell").map((c) => c.textContent?.replace(/\s/g, " "))).toEqual([
      "R$ 4.000,00",
      "R$ 1.000,00",
      "45,45%",
    ]);
  });

  it("sem separado, não desenha nada (nem sem tipos de ativo)", () => {
    const { container } = renderCard({ ...summary, reserved_by_class: [] } as unknown as PortfolioSummary);
    expect(container).toBeEmptyDOMElement();
  });
});
