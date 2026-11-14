import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Evolution } from "@/features/history";
import type { PortfolioSummary } from "@/features/portfolio";
import { unprotectedMoney } from "@/test/privacy";
import { PatrimonyCard } from "./PatrimonyCard";

// O gráfico depende de medidas de tela que o jsdom não tem; a legenda, o nome e a tabela cobrem o resto.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

const normalize = (text: string | null) => (text ?? "").replace(/\s/g, " ");

const evolution = (separated: number): Evolution => ({
  classes: [],
  summary: null,
  points: [
    { date: "2026-09-30", total_cents: 1_000_000, invested_cents: 900_000, by_class: {}, reserve_cents: 0 },
    { date: "2026-10-31", total_cents: 1_100_000, invested_cents: 950_000, by_class: {}, reserve_cents: 0, reserved_cents: separated },
  ],
});

const portfolio = (patch: Partial<PortfolioSummary> = {}) =>
  ({
    total_current_cents: 1_100_000,
    total_invested_cents: 950_000,
    return_bps: 1578,
    assets_count: 3,
    cash_cents: 0,
    ...patch,
  }) as PortfolioSummary;

function renderCard(total: PortfolioSummary, separated: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/history/evolution")) return new Response(JSON.stringify(evolution(separated)), { status: 200 });
      return new Response(JSON.stringify({ total_cents: 0 }), { status: 200 });
    }),
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <PatrimonyCard total={total} range="12m" onRangeChange={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Cartão de patrimônio da Visão geral", () => {
  it("sem separado, continua 'Patrimônio atual' e sem faixa, legenda ou coluna extra", async () => {
    renderCard(portfolio(), 0);
    const legend = await screen.findByRole("list", { name: "Legenda do gráfico" });
    expect(within(legend).queryByText(/Separado/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Patrimônio atual" })).toBeInTheDocument();
    expect(screen.queryByText(/inclui .* separado/)).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Separado" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Linha do patrimônio/ }).getAttribute("aria-label")).not.toMatch(/Separado/);
  });

  it("com separado, vira 'Patrimônio total' com a conta explicada e o separado também nas partes do gráfico", async () => {
    const { container } = renderCard(portfolio({ reserved_cents: 80_000, net_worth_cents: 1_180_000, free_cash_cents: 20_000, cash_cents: 100_000 }), 80_000);

    const title = screen.getByRole("heading", { name: "Patrimônio total" });
    const card = title.closest("section")!;
    expect(normalize(card.textContent)).toContain("R$ 11.800,00");
    expect(normalize(card.textContent)).toContain("inclui R$ 800,00 separado, ainda não investido");
    // Fora do total fica só o caixa sem destino.
    expect(normalize(card.textContent)).toContain("Fora desse total, R$ 200,00 em caixa nas contas, sem destino e ainda não investidos.");

    const legend = await screen.findByRole("list", { name: "Legenda do gráfico" });
    expect(within(legend).getByText("Separado (ainda não investido)")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /faixa hachurada "Separado \(ainda não investido\)" por cima do patrimônio/ })).toBeInTheDocument();

    const table = screen.getByRole("table", { name: /dinheiro separado/ });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Data", "Patrimônio", "Investido", "Separado"]);
    expect(normalize(within(within(table).getByRole("row", { name: /31\/10\/2026/ })).getAllByRole("cell").at(-1)!.textContent)).toBe("R$ 800,00");
    expect(unprotectedMoney(container)).toEqual([]);
  });

  it("numa API anterior ao separado, soma o separado como 0 e mostra o caixa todo", async () => {
    renderCard(portfolio({ cash_cents: 50_000 }), 0);
    const card = screen.getByRole("heading", { name: "Patrimônio atual" }).closest("section")!;
    expect(normalize(card.textContent)).toContain("R$ 11.000,00");
    expect(normalize(card.textContent)).toContain("Fora desse total, R$ 500,00 em caixa nas contas, ainda não investidos.");
    await screen.findByRole("list", { name: "Legenda do gráfico" });
  });
});
