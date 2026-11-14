import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PerformanceTab } from "./PerformanceTab";

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

function renderTab(hasSeparated?: boolean) {
  // A nota independe do cálculo: basta o cabeçalho da tela, então as consultas podem responder vazio.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <PerformanceTab range="all" hasSeparated={hasSeparated} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Histórico > Desempenho com dinheiro separado", () => {
  const note = "O dinheiro separado não entra na rentabilidade nem na comparação com o CDI até ser investido.";

  it("avisa que o separado fica fora da rentabilidade e do CDI", () => {
    renderTab(true);
    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it("sem separado, a nota não aparece", () => {
    renderTab();
    expect(screen.queryByText(note)).not.toBeInTheDocument();
  });
});
