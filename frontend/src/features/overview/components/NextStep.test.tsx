import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentMonth } from "@/shared/lib/format";
import { NextStepBanner, NextStepCard } from "./NextStep";

const month = currentMonth();

// Plano do mês: Renda Variável R$ 97,34, Ações/ETF R$ 83,26, Cripto R$ 209,40 e reserva R$ 97,50.
const contribution = {
  id: 1,
  month,
  salary_cents: 650_000,
  percent_bps: 750,
  calculated_cents: 48_750,
  final_cents: 48_750,
  overridden: false,
  reserve_cents: 9_750,
  mode: "rebalance",
  plan_name: "Plano padrão",
  plan: [
    { class_key: "rv", class_name: "Renda Variável", color: "#000", amount_cents: 9_734 },
    { class_key: "etf", class_name: "Ações/ETF", color: "#111", amount_cents: 8_326 },
    { class_key: "cripto", class_name: "Criptomoedas", color: "#222", amount_cents: 20_940 },
  ],
  created_at: null,
};

const item = (class_key: string, hold_status: string) => ({
  class_id: class_key.length,
  class_key,
  class_name: class_key,
  color: "#000",
  current_cents: 100,
  current_bps: 2500,
  target_bps: 2500,
  effective_target_bps: hold_status === "all" ? 0 : 2500,
  hold_status,
  diff_cents: hold_status === "all" ? null : 0,
  held_assets: [],
});

function renderCard(comparison: Response | (() => Response), contributions: unknown[] = [contribution], banner = false, path = "/") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.endsWith("/portfolio/summary")) return json({ assets_count: 5 });
      if (url.endsWith("/contributions")) return json(contributions);
      if (url.endsWith("/snapshots")) return json([]);
      if (url.includes("/portfolio/month-summary")) {
        return json({ month, by_class: [{ class_key: "cripto", class_name: "Criptomoedas", color: "#222", amount_cents: 12_000, goal_cents: 12_000 }], reserve_cents: 0, reserve_goal_cents: 0, off_goal_cents: 0, total_cents: 12_000, proventos_cents: 0 });
      }
      if (url.endsWith("/allocation/comparison")) return typeof comparison === "function" ? comparison() : comparison.clone();
      return new Response(JSON.stringify({ detail: "não usado" }), { status: 404 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        {banner ? <NextStepBanner /> : <NextStepCard />}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const comparisonOf = (...items: ReturnType<typeof item>[]) =>
  new Response(JSON.stringify({ plan_id: 1, plan_name: "Plano padrão", total_cents: 1, base_cents: 1, items }), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NextStepCard: categorias mantidas", () => {
  it("o que falta não conta a categoria toda mantida (bate com o acompanhamento do plano)", async () => {
    renderCard(comparisonOf(item("rv", "partial"), item("etf", "all"), item("cripto", "none")));
    // R$ 97,34 + R$ 89,40 (cripto: 209,40 − 120,00) + R$ 97,50 (reserva); Ações/ETF fica de fora.
    expect(await screen.findByRole("heading", { name: /Faltam R\$\s284,24 para completar o aporte de/ })).toBeInTheDocument();
  });

  it("o valor do que falta fica dentro de <Money>, para o modo ocultar valores esconder", async () => {
    renderCard(comparisonOf(item("rv", "partial"), item("etf", "all"), item("cripto", "none")));
    const heading = await screen.findByRole("heading", { name: /Faltam/ });
    const copy = heading.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".money").forEach((m) => m.remove());
    expect(copy.textContent).not.toMatch(/R\$/);
  });

  it("com tudo mantido e sem aporte definido, orienta a desmarcar algum ativo", async () => {
    renderCard(comparisonOf(item("rv", "all"), item("etf", "all"), item("cripto", "all")), []);
    expect(await screen.findByRole("heading", { name: 'Todos os ativos estão em "Manter posição"' })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ir para os ativos/ })).toHaveAttribute("href", "/carteira/ativos");
  });

  it("se a situação dos mantidos falhar, não mostra um valor que pode estar errado", async () => {
    renderCard(() => new Response(JSON.stringify({ detail: "falhou" }), { status: 500 }));
    expect(await screen.findByRole("heading", { name: "Registre os aportes do mês" })).toBeInTheDocument();
    expect(screen.queryByText(/Faltam R\$/)).not.toBeInTheDocument();
  });

  it("no passo de aportar, o botão principal é em tinta e há o atalho 'Ver a divisão'", async () => {
    renderCard(comparisonOf(item("rv", "partial"), item("etf", "all"), item("cripto", "none")));
    const action = await screen.findByRole("link", { name: /Registrar aportes/ });
    expect(action).toHaveClass("bg-ink");
    expect(action).toHaveAttribute("href", "/carteira/movimentacoes?novo=aporte");
    expect(screen.getByRole("link", { name: "Ver a divisão" })).toHaveAttribute("href", "/aporte");
  });
});

describe("NextStepBanner (telas fora da Visão geral)", () => {
  it("o botão é secundário: a ação principal da tela continua sendo a única em tinta", async () => {
    renderCard(comparisonOf(item("rv", "partial"), item("etf", "all"), item("cripto", "none")), [contribution], true, "/historico");
    const action = await screen.findByRole("link", { name: /Registrar aportes/ });
    expect(action).toHaveClass("bg-raise");
    expect(action).not.toHaveClass("bg-ink");
  });
});
