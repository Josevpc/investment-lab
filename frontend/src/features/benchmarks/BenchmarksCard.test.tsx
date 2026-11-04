import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BenchmarksCard } from "./BenchmarksCard";
import type { BenchmarkStatus, RefreshResult } from "./types";

function status(overrides: Partial<BenchmarkStatus> = {}): BenchmarkStatus {
  return {
    source: "Banco Central (SGS) e B3",
    updated_at: "2026-10-17T08:30:00",
    stale: false,
    series: [{ series: "cdi", label: "CDI", months: 24, covered_from: "2024-10", covered_through: "2026-09" }],
    daily_days: 500,
    daily_through: "2026-10-16",
    index_days: 480,
    index_through: "2026-10-16",
    ...overrides,
  };
}

function renderCard(current: BenchmarkStatus, refresh?: Omit<RefreshResult, "status">) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/benchmarks/refresh") && init?.method === "POST") {
        return new Response(JSON.stringify({ ...refresh, status: current }), { status: 200 });
      }
      return new Response(JSON.stringify(current), { status: 200 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BenchmarksCard />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Índices de referência em Configurações", () => {
  it("mostra quantos dias do Ibovespa estão guardados e até quando", async () => {
    renderCard(status());
    expect(await screen.findByText("480 dias, até 16/10/2026")).toBeInTheDocument();
  });

  it("diz quando o Ibovespa ainda não foi baixado", async () => {
    renderCard(status({ index_days: 0, index_through: null }));
    const line = (await screen.findByText(/Ibovespa \(para comparar/)).closest("p")!;
    expect(line).toHaveTextContent("ainda não baixado");
  });

  it("falha só do Ibovespa: mantém o sucesso e mostra o motivo como aviso", async () => {
    const user = userEvent.setup();
    renderCard(status(), { ok: true, rows_saved: 12, errors: ["Ibovespa: serviço fora do ar"] });

    await user.click(await screen.findByRole("button", { name: "Atualizar agora" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Atualizado: 12 valores gravados.");
    expect(screen.getByText(/Ibovespa: serviço fora do ar\. O restante foi salvo/)).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível atualizar/)).not.toBeInTheDocument();
  });
});
