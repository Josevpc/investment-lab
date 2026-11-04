import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickUpdateTab } from "./QuickUpdateTab";

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <QuickUpdateTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("QuickUpdateTab", () => {
  it("enquanto os ativos carregam, avisa que está carregando", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderTab();
    expect(screen.getByRole("status")).toHaveTextContent("Carregando...");
  });

  it("se os ativos não carregam, mostra o erro em vez de uma lista vazia", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Falhou ao ler os ativos." }), { status: 500 })));
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent("Falhou ao ler os ativos.");
  });

  it("com os ativos, mostra a lista para atualizar, agrupada por instituição", async () => {
    const asset = {
      id: 1,
      name: "CDB",
      class_key: "renda_fixa",
      class_name: "Renda Fixa",
      institution_id: 3,
      institution_name: "Banco",
      quantity: null,
      balance_is_net: false,
      invested_cents: 1_000,
      current_cents: 1_100,
      valuation_date: "2026-10-17",
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([asset]), { status: 200 })));
    renderTab();

    expect(await screen.findByRole("heading", { name: "Banco", level: 3 })).toBeInTheDocument();
    expect(screen.getByLabelText("Saldo atual de CDB")).toBeInTheDocument();
  });
});
