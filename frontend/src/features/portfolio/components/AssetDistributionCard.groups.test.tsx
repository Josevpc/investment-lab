import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset, PortfolioSummary } from "../types";
import { AssetDistributionCard } from "./AssetDistributionCard";

// O gráfico depende de medidas de tela que o jsdom não tem; a legenda e a tabela cobrem os mesmos números.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

const asset = (id: number, name: string, current_cents: number, extra: Partial<Asset> = {}) =>
  ({ id, name, institution_name: "Banco", class_name: "Renda Fixa", purpose: null, valuation_date: "2026-10-17", current_cents, ...extra }) as Asset;

const assets = [asset(1, "CDB", 40_000), asset(2, "VGHF11", 30_000), asset(3, "PETR4", 20_000), asset(4, "Tesouro Reserva", 10_000, { purpose: "reserva" })];

const summary = (patch: Partial<PortfolioSummary>) =>
  ({
    assets_count: 4,
    total_current_cents: 100_000,
    total_invested_cents: 90_000,
    investments_current_cents: 90_000,
    reserve_current_cents: 10_000,
    reserve_invested_cents: 10_000,
    by_class: [],
    by_type: [],
    fii_segments: [],
    by_institution: [],
    ...patch,
  }) as PortfolioSummary;

function renderCard(portfolio: PortfolioSummary) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/portfolio/summary") ? portfolio : assets), { status: 200 })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AssetDistributionCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Distribuição da carteira: por ativo ou por grupo", () => {
  it("sem grupos, não oferece a escolha", async () => {
    renderCard(summary({ by_group: [] }));
    expect(await screen.findByRole("heading", { name: "Distribuição da carteira por ativo" })).toBeInTheDocument();
    await screen.findByRole("list", { name: /Legenda/ });
    expect(screen.queryByRole("group", { name: "Distribuir por" })).not.toBeInTheDocument();
  });

  it("com grupos, alterna para a visão por grupo com \"Sem grupo\", sem a reserva, e tabela alternativa", async () => {
    renderCard(
      summary({
        by_group: [{ group_id: 9, name: "Renda variável", color: "#8a6bbf", current_cents: 50_000, invested_cents: 40_000, share_bps: 5556 }],
      }),
    );

    const choice = await screen.findByRole("group", { name: "Distribuir por" });
    expect(within(choice).getByRole("button", { name: "Ativo" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(choice).getByRole("button", { name: "Grupo" }));

    expect(screen.getByRole("heading", { name: "Distribuição da carteira por grupo" })).toBeInTheDocument();
    expect(screen.getByText(/Não inclui a reserva de emergência/)).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Participação de cada grupo nos investimentos" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.replace(/\s+/g, " "))).toEqual([
      expect.stringMatching(/Renda variável.*55,56%.*R\$ 500,00/),
      expect.stringMatching(/Sem grupo.*44,44%.*R\$ 400,00/),
    ]);

    const table = screen.getByRole("table");
    expect(within(table).getByRole("row", { name: /Sem grupo/ })).toHaveTextContent(/R\$\s400,00/);
    expect(within(table).getByRole("row", { name: /Total dos investimentos/ })).toHaveTextContent(/R\$\s900,00/);

    await userEvent.click(within(choice).getByRole("button", { name: "Ativo" }));
    expect(await screen.findByRole("heading", { name: "Distribuição da carteira por ativo" })).toBeInTheDocument();
  });
});
