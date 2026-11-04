import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Performance } from "@/features/analytics";
import { PerformanceTab } from "./PerformanceTab";

// O gráfico depende de medidas de tela que o jsdom não tem; a tabela cobre os mesmos números.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

const classes = [
  { id: 1, key: "renda_fixa", name: "Renda fixa", color: "#000", archived: false },
  { id: 2, key: "fii", name: "FII", color: "#000", archived: false },
  { id: 3, key: "acoes", name: "Ações/ETF", color: "#000", archived: false },
];

const performance = (scope: string, label: string): Performance => ({
  scope,
  scope_label: label,
  include_reserve: false,
  observations_count: 2,
  points: [
    { date: "2026-08-31", value_cents: 1_000_000, flows_cents: 0, portfolio_bps: 0, cdi_bps: 0, ibovespa_bps: 0 },
    { date: "2026-09-30", value_cents: 1_100_000, flows_cents: 0, portfolio_bps: 1000, cdi_bps: 90, ibovespa_bps: 320 },
  ],
  summary: {
    start_date: "2026-08-31",
    end_date: "2026-09-30",
    portfolio_bps: 1000,
    cdi_bps: 90,
    vs_cdi_bps: 910,
    ibovespa_bps: 320,
    vs_ibovespa_bps: 680,
    flows_cents: 0,
  },
  method: "Retorno ponderado pelo tempo.",
  warnings: [],
  stale_assets: [],
  benchmark_source: "Banco Central (SGS)",
  benchmark_updated_at: "2026-10-01T09:00:00",
  cdi_covered_through: "2026-09-30",
  ibovespa_covered_through: "2026-09-30",
  ibovespa_source: "B3 (Ibovespa)",
});

function renderTab(groups: unknown) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes("/asset-classes")) return json(classes);
      if (url.includes("/asset-groups")) return json(groups);
      const scope = new URL(url, "http://x").searchParams.get("scope") ?? "total";
      return json(performance(scope, scope.startsWith("group:") ? "Grupo Renda variável" : "Carteira total"));
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PerformanceTab range="all" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const rendaVariavel = { id: 9, name: "Renda variável", color: "#8a6bbf", archived: false, class_ids: [2, 3] };

describe("Desempenho: escopo por grupo", () => {
  it("lista o grupo no escopo, consulta group:<id>, liga o Ibovespa (tem bolsa) e explica o agrupamento", async () => {
    const user = userEvent.setup();
    const calls = renderTab([rendaVariavel]);

    const scope = await screen.findByRole("combobox", { name: /Escopo/ });
    await screen.findByRole("option", { name: "Grupo Renda variável" });
    await user.selectOptions(scope, "group:9");

    expect(await screen.findByText(/soma das categorias FII, Ações\/ETF que fazem parte dele hoje, inclusive nos meses passados/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Ibovespa" })).toBeChecked();
    expect(calls.some((url) => new URL(url, "http://x").searchParams.get("scope") === "group:9")).toBe(true);
  });

  it("um grupo só de renda fixa abre sem o Ibovespa", async () => {
    const user = userEvent.setup();
    renderTab([{ id: 4, name: "Seguros", color: "#000", archived: false, class_ids: [1] }]);

    const scope = await screen.findByRole("combobox", { name: /Escopo/ });
    await screen.findByRole("option", { name: "Grupo Seguros" });
    await user.selectOptions(scope, "group:4");
    expect(screen.getByRole("checkbox", { name: "Ibovespa" })).not.toBeChecked();
  });

  it("sem grupos, o seletor é o de sempre (categorias soltas, sem agrupamentos)", async () => {
    renderTab([]);
    await screen.findByRole("option", { name: "Renda fixa" });
    expect(screen.queryByRole("group", { name: "Grupos de categorias" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^Grupo / })).not.toBeInTheDocument();
  });
});
