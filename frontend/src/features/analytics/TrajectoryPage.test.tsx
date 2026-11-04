import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrajectoryPage } from "./TrajectoryPage";
import type { Trajectory } from "./types";

const cls = (key: string, name: string) => ({ key, name, color: "#000", target_bps: 5000, effective_target_bps: 0, hold_status: "all" as const });
const point = (month: number) => ({
  month,
  total_cents: 100_000,
  values_cents: { rf: 60_000, rv: 40_000 },
  shares_bps: { rf: 6000, rv: 4000 },
  base_shares_bps: {},
});

const allHeld: Trajectory = {
  plan_id: 1,
  plan_name: "Plano padrão",
  mode: "rebalance",
  months: 24,
  monthly_contribution_cents: 0,
  contribution_source: "last_contribution",
  tolerance_bps: 100,
  months_to_target: null,
  start_gap_bps: 0,
  end_gap_bps: 0,
  all_held: true,
  classes: [cls("rf", "Renda fixa"), cls("rv", "Renda variável")],
  points: [point(0), point(24)],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TrajectoryPage: tudo mantido", () => {
  it("avisa que não há aportes na simulação, leva à Carteira e não mostra desvio 0 como se estivesse na meta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/analytics/trajectory")
          ? new Response(JSON.stringify(allHeld), { status: 200 })
          : new Response(JSON.stringify({ detail: "não usado" }), { status: 404 }),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TrajectoryPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent('Com todos os ativos em "Manter posição", a simulação não tem aportes.');
    expect(screen.getByRole("link", { name: "Ir para os ativos na Carteira" })).toHaveAttribute("href", "/carteira/ativos");
    expect(screen.queryByText("0,0 p.p.")).not.toBeInTheDocument();
    expect(screen.getAllByText("Sem meta para comparar: todas as categorias estão mantidas")).toHaveLength(2);
    expect(screen.queryByText(/a meta das outras sobe/)).not.toBeInTheDocument();
    // O campo mostra 0,00: a dica não pode dizer que veio do último aporte.
    expect(screen.getByText("Não usado: todos os ativos estão mantidos.")).toBeInTheDocument();
    expect(screen.queryByText(/Pré-preenchido com o último aporte/)).not.toBeInTheDocument();
    // Valores em reais das frases ficam em <Money> (modo ocultar valores).
    const caption = screen.getByText(/Linhas cheias/);
    const copy = caption.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".money").forEach((m) => m.remove());
    expect(copy.textContent).not.toMatch(/R\$/);
  });
});
